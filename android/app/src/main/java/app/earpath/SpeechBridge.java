package app.earpath;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * On-device speech recognition (Vosk small models). The APK may ship both the
 * English and Chinese models (bilingual debug builds); prepare(lang) /
 * start(grammarJson, lang) select which one is loaded, so switching language in
 * the UI swaps models without reinstalling.
 *
 * JS sees `window.AndroidASR` with prepare(lang) / start(grammarJson, lang) /
 * stop(); results come back through `window.__asr.event({...})`.
 */
public class SpeechBridge {

    interface Host {
        boolean hasMicPermission();
        void requestMicPermission();
    }

    private static final String TAG = "earpath-asr";
    private static final String MODEL_DIR = "asr-model";
    private static final String MODEL_VERSION = "v1";
    private static final int RATE = 16000;

    private final Context context;
    private final WebView web;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());

    private volatile Model model;
    private volatile String loadedLang;
    private Thread worker;
    private volatile boolean running;
    private volatile AudioRecord audio;
    private volatile String lastPartial = "";
    private boolean preparing;
    private String preparingLang;
    private int loadSeq;
    private String pendingGrammar;
    private String pendingLang;

    SpeechBridge(Context context, WebView web, Host host) {
        this.context = context.getApplicationContext();
        this.web = web;
        this.host = host;
    }

    private static String normalizeLang(String lang) {
        return "zh".equals(lang) ? "zh" : "en";
    }

    /** Load one language's model in the background; safe to call repeatedly. */
    @JavascriptInterface
    public void prepare(String lang) {
        final String target = normalizeLang(lang);
        if (model != null && target.equals(loadedLang)) {
            emitState("ready");
            return;
        }
        if (preparing && target.equals(preparingLang)) return;

        preparing = true;
        preparingLang = target;
        final int seq = ++loadSeq;
        emitState("preparing");

        new Thread(() -> {
            try {
                LibVosk.setLogLevel(LogLevel.WARNINGS);
                stopInternal();

                // Assets are keyed by language; the unpacked copy is too, so a
                // Chinese session can never reuse the English model.
                File dir = new File(context.getFilesDir(), "asr-" + target + "-" + MODEL_VERSION);
                File marker = new File(dir, ".ready");
                if (!marker.exists()) {
                    Log.d(TAG, "unpacking model into " + dir);
                    if (dir.exists()) deleteTree(dir);
                    dir.mkdirs();
                    copyAsset(MODEL_DIR + "/" + target, dir);
                    if (!marker.createNewFile()) throw new IOException("cannot write model marker");
                }

                Model loaded = new Model(dir.getAbsolutePath());
                synchronized (this) {
                    if (seq != loadSeq) {
                        loaded.close();
                        return;
                    }
                    if (model != null) model.close();
                    model = loaded;
                    loadedLang = target;
                }
                preparing = false;
                preparingLang = null;
                emitState("ready");

                String g = pendingGrammar;
                String l = pendingLang;
                pendingGrammar = null;
                pendingLang = null;
                if (g != null) start(g, l);
            } catch (Throwable t) {
                if (seq != loadSeq) return;
                preparing = false;
                preparingLang = null;
                Log.e(TAG, "model failed", t);
                emitError("model", String.valueOf(t.getMessage()));
            }
        }, "asr-prepare").start();
    }

    @JavascriptInterface
    public void start(String grammarJson, String lang) {
        final String target = normalizeLang(lang);
        if (host == null || !host.hasMicPermission()) {
            pendingGrammar = grammarJson;
            pendingLang = target;
            emitError("permission", "microphone permission not granted");
            main.post(() -> host.requestMicPermission());
            return;
        }
        if (model == null || !target.equals(loadedLang)) {
            pendingGrammar = grammarJson;
            pendingLang = target;
            prepare(target);
            return;
        }

        stopInternal();
        final String grammar = grammarJson == null || grammarJson.isEmpty() ? null : grammarJson;
        running = true;
        worker = new Thread(() -> captureLoop(grammar), "asr-capture");
        worker.start();
    }

    @JavascriptInterface
    public void stop() {
        stopInternal();
        emitState("idle");
    }

    /** Called by the activity once the user answers the system permission dialog. */
    void onPermissionResult(boolean granted) {
        if (!granted) {
            pendingGrammar = null;
            pendingLang = null;
            emitError("permission", "microphone permission denied");
            return;
        }
        String g = pendingGrammar;
        String l = pendingLang;
        pendingGrammar = null;
        pendingLang = null;
        if (g != null) start(g, l);
    }

    /**
     * Hands the model over to the native screen-off engine: stop capturing and
     * free the recogniser. The page reloads it (from the unpacked copy) when it
     * becomes visible again.
     */
    void suspend() {
        stopInternal();
        loadSeq++;
        preparing = false;
        preparingLang = null;
        pendingGrammar = null;
        pendingLang = null;
        synchronized (this) {
            if (model != null) { model.close(); model = null; }
            loadedLang = null;
        }
    }

    void shutdown() {
        stopInternal();
        synchronized (this) {
            if (model != null) { model.close(); model = null; }
            loadedLang = null;
        }
    }

    // ── capture ──────────────────────────────────────────────────────────────

    private void captureLoop(String grammar) {
        AudioRecord record = null;
        Recognizer rec = null;
        try {
            // A fresh recogniser per listening window: no leftover audio or
            // grammar from the previous question can bleed in.
            rec = new Recognizer(model, RATE);
            if (grammar != null) rec.setGrammar(grammar);

            int min = AudioRecord.getMinBufferSize(RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int size = Math.max(min, 8192);
            record = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size * 2);
            audio = record;
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                emitError("audio", "microphone unavailable");
                return;
            }
            record.startRecording();
            lastPartial = "";
            emitState("listening");

            byte[] buffer = new byte[size];
            while (running) {
                int n = record.read(buffer, 0, buffer.length);
                if (n <= 0) continue;
                if (rec.acceptWaveForm(buffer, n)) {
                    String text = field(rec.getResult(), "text");
                    if (!text.isEmpty()) emit("final", text);
                    lastPartial = "";
                } else {
                    String partial = field(rec.getPartialResult(), "partial");
                    if (!partial.isEmpty() && !partial.equals(lastPartial)) {
                        lastPartial = partial;
                        emit("partial", partial);
                    }
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "capture failed", t);
            if (running) emitError("audio", String.valueOf(t.getMessage()));
        } finally {
            running = false;
            if (rec != null) { try { rec.close(); } catch (Exception ignored) { } }
            if (record != null) {
                try { record.stop(); } catch (Exception ignored) { }
                record.release();
            }
            if (audio == record) audio = null;
            emitState("idle");
        }
    }

    private void stopInternal() {
        running = false;
        AudioRecord record = audio;
        if (record != null) {
            try { record.stop(); } catch (Exception ignored) { }
        }
        Thread t = worker;
        worker = null;
        if (t != null && t != Thread.currentThread()) {
            try { t.join(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }

    // ── plumbing ─────────────────────────────────────────────────────────────

    private void emitState(String value) {
        try {
            JSONObject o = new JSONObject().put("type", "state").put("value", value);
            post(o.toString());
        } catch (Exception ignored) { }
    }

    private void emitError(String code, String detail) {
        try {
            JSONObject o = new JSONObject().put("type", "error").put("code", code);
            if (detail != null) o.put("detail", detail);
            post(o.toString());
        } catch (Exception ignored) { }
    }

    private void emit(String type, String text) {
        try {
            JSONObject o = new JSONObject().put("type", type).put("text", text);
            post(o.toString());
        } catch (Exception ignored) { }
    }

    private void post(String json) {
        main.post(() -> {
            if (web != null) {
                web.evaluateJavascript("window.__asr&&window.__asr.event(" + json + ")", null);
            }
        });
    }

    private static String field(String json, String key) {
        try {
            return new JSONObject(json).optString(key, "");
        } catch (Exception e) {
            return "";
        }
    }

    private void copyAsset(String path, File out) throws IOException {
        String[] children = context.getAssets().list(path);
        if (children != null && children.length > 0) {
            if (!out.exists() && !out.mkdirs()) throw new IOException("mkdir failed: " + out);
            for (String child : children) copyAsset(path + "/" + child, new File(out, child));
            return;
        }
        File parent = out.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("mkdir failed: " + parent);
        try (InputStream in = context.getAssets().open(path);
             OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
    }

    private static void deleteTree(File file) {
        File[] kids = file.listFiles();
        if (kids != null) for (File kid : kids) deleteTree(kid);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}

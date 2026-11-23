package app.earpath;

import android.content.Context;
import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import org.json.JSONArray;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The practice loop, in native code, for screen-off sessions.
 *
 * Chromium suspends a hidden WebView: its timers stop, its AudioContext is
 * frozen and its page cannot schedule the next question. The service therefore
 * runs this engine instead while the screen is locked. It takes a queue built
 * by js/screenoff.js — audio as MIDI event lists, options, aliases and the
 * correct answer — and owns playback (AudioTrack synthesis), recognition
 * (Vosk), grading and spoken feedback (TTS). Results are handed back to the
 * page when it becomes visible again.
 */
public class NativePractice {

    interface Listener {
        /** Questions answered so far, correct answers, and a short status line. */
        void onProgress(int answered, int correct);
        void onFinished(String reason);
    }

    private static final String TAG = "earpath-native";
    private static final String MODEL_DIR = "asr-model";
    private static final String MODEL_VERSION = "v1";
    private static final int MIC_RATE = 16000;
    private static final int OUT_RATE = 44100;

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    private volatile boolean running;
    private Thread worker;
    private volatile AudioRecord mic;
    private volatile AudioTrack track;
    private volatile Model model;
    private JSONObject session;

    private String lang = "en";
    private float volume = 0.9f;
    private int idleMinutes = 10;
    private JSONObject commands = new JSONObject();

    private final JSONArray results = new JSONArray();
    private volatile String stopReason;
    private volatile long lastIntentAt;
    private int answeredCount;
    private int correctCount;

    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private volatile CountDownLatch ttsDone;

    NativePractice(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    void start(String json) {
        stop();
        try {
            session = new JSONObject(json);
            lang = "zh".equals(session.optString("lang")) ? "zh" : "en";
            volume = (float) Math.max(0, Math.min(1, session.optDouble("volume", 0.9)));
            idleMinutes = Math.max(1, session.optInt("idleMinutes", 10));
            commands = session.optJSONObject("commands");
            if (commands == null) commands = new JSONObject();
        } catch (Exception e) {
            Log.e(TAG, "bad session payload", e);
            return;
        }

        stopReason = null;
        answeredCount = 0;
        correctCount = 0;
        synchronized (results) { while (results.length() > 0) results.remove(0); }
        lastIntentAt = System.currentTimeMillis();
        running = true;
        worker = new Thread(this::runLoop, "native-practice");
        worker.start();
    }

    void stop() {
        running = false;
        AudioRecord r = mic;
        if (r != null) {
            try { r.stop(); } catch (Exception ignored) { }
        }
        AudioTrack t = track;
        if (t != null) {
            try { t.pause(); t.flush(); t.stop(); } catch (Exception ignored) { }
        }
        CountDownLatch latch = ttsDone;
        if (latch != null) latch.countDown();
        if (tts != null) {
            try { tts.stop(); } catch (Exception ignored) { }
        }
        Thread w = worker;
        worker = null;
        if (w != null && w != Thread.currentThread()) {
            try { w.join(2000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        closeModel();
        shutdownTts();
    }

    String resultsJson() {
        try {
            JSONObject o = new JSONObject();
            JSONArray copy;
            synchronized (results) { copy = new JSONArray(results.toString()); }
            o.put("results", copy);
            String reason = stopReason == null ? "resume" : stopReason;
            o.put("reason", reason);
            // Voice mode should switch itself off only when the native session
            // ended on its own (stop command, idle timeout or an error).
            o.put("stopped", "command".equals(reason) || "idle".equals(reason) || "error".equals(reason));
            return o.toString();
        } catch (Exception e) {
            return "{\"results\":[],\"stopped\":false}";
        }
    }

    // ── main loop ─────────────────────────────────────────────────────────────

    private void runLoop() {
        try {
            initTts();
            model = loadModel();
            if (!running) return;

            JSONArray qs = session.getJSONArray("questions");
            int total = qs.length();
            if (total == 0) { stopReason = "error"; return; }
            listener.onProgress(0, 0);

            for (int i = 0; running; i++) {
                JSONObject q = qs.getJSONObject(i % total);
                runQuestion(q);
            }
        } catch (Throwable t) {
            if (running) {
                Log.e(TAG, "native practice failed", t);
                stopReason = "error";
            }
        } finally {
            running = false;
            closeModel();
            shutdownTts();
            if (listener != null) listener.onFinished(stopReason == null ? "resume" : stopReason);
        }
    }

    /**
     * Plays one question, listens for an answer, grades it and speaks the
     * result. After a miss it keeps the microphone open for a short window so
     * option names can be auditioned, exactly like tapping the buttons.
     */
    private void runQuestion(JSONObject q) throws Exception {
        JSONArray opts = q.optJSONArray("options");
        if (opts == null || opts.length() == 0) return;
        String answerId = String.valueOf(q.get("answerId"));
        JSONArray questionEvents = q.optJSONArray("events");
        String grammar = buildGrammar(opts);

        boolean answered = false;
        boolean correct = false;
        String answeredId = null;
        int answerIndex = -1;

        while (running) {
            if (!playEvents(questionEvents)) return;

            String text = listen(grammar, 0);
            if (!running) return;
            if (text.isEmpty()) continue;                    // timeout / idle
            Intent intent = parse(text, opts);
            if (intent == null) continue;

            lastIntentAt = System.currentTimeMillis();

            if (intent.command != null) {
                switch (intent.command) {
                    case "replay":
                        continue;
                    case "next":
                        return;
                    case "names":
                        speak(namedAnswer(q, answerId, answeredId, answered));
                        continue;
                    case "stop":
                        stopReason = "command";
                        running = false;
                        return;
                    default:
                        continue;
                }
            }

            if (intent.option < 0) continue;

            if (answered) {
                // Post-answer audition: name an option, hear it.
                JSONArray ev = optionEvents(opts, intent.option);
                if (ev != null) playEvents(ev);
                continue;
            }

            answered = true;
            answerIndex = intent.option;
            answeredId = optionId(opts, intent.option);
            correct = answeredId != null && answeredId.equals(answerId);
            answeredCount++;
            if (correct) correctCount++;
            recordResult(q, correct, answeredId);
            if (listener != null) listener.onProgress(answeredCount, correctCount);
            speak(resultSentence(q, answerId, answeredId, answerIndex, correct));
            if (!running) return;
            break;
        }

        if (!answered) return;

        if (correct) {
            sleep(900);
            return;
        }

        // A miss: leave room to listen to each option before moving on.
        long until = System.currentTimeMillis() + 4000;
        while (running && System.currentTimeMillis() < until) {
            long left = Math.max(250, until - System.currentTimeMillis());
            String text = listen(grammar, Math.min(1500, left));
            if (!running) return;
            if (text.isEmpty()) continue;
            Intent intent = parse(text, opts);
            if (intent == null) continue;
            lastIntentAt = System.currentTimeMillis();
            if (intent.command != null) {
                if ("next".equals(intent.command)) return;
                if ("stop".equals(intent.command)) { stopReason = "command"; running = false; return; }
                if ("names".equals(intent.command)) {
                    speak(namedAnswer(q, answerId, answeredId, true));
                    until = System.currentTimeMillis() + 2500;
                    continue;
                }
                if ("replay".equals(intent.command)) {
                    if (!playEvents(questionEvents)) return;
                    until = System.currentTimeMillis() + 2500;
                    continue;
                }
            }
            if (intent.option >= 0) {
                JSONArray ev = optionEvents(opts, intent.option);
                if (ev != null) playEvents(ev);
                until = System.currentTimeMillis() + 2500;
            }
        }
    }

    // ── recognition ───────────────────────────────────────────────────────────

    /** Returns the final text, "" on timeout/idle, or null when stopped. */
    private String listen(String grammar, long timeoutMs) {
        Recognizer rec = null;
        AudioRecord record = null;
        try {
            rec = new Recognizer(model, MIC_RATE);
            if (grammar != null) rec.setGrammar(grammar);

            int min = AudioRecord.getMinBufferSize(MIC_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int size = Math.max(min, 8192);
            record = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    MIC_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size * 2);
            mic = record;
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "microphone unavailable");
                stopReason = "error";
                running = false;
                return null;
            }
            record.startRecording();

            long deadline = timeoutMs > 0 ? System.currentTimeMillis() + timeoutMs : 0;
            long lastIdleCheck = 0;
            byte[] buffer = new byte[size];
            while (running) {
                int n = record.read(buffer, 0, buffer.length);
                if (n <= 0) continue;
                if (rec.acceptWaveForm(buffer, n)) {
                    String text = field(rec.getResult(), "text").trim();
                    if (!text.isEmpty()) return text;
                }
                long now = System.currentTimeMillis();
                if (now - lastIdleCheck > 500) {
                    lastIdleCheck = now;
                    if (idleExpired()) {
                        stopReason = "idle";
                        running = false;
                        return null;
                    }
                }
                if (deadline > 0 && now >= deadline) return "";
            }
            return null;
        } catch (Throwable t) {
            if (running) {
                Log.e(TAG, "listen failed", t);
                stopReason = "error";
                running = false;
            }
            return null;
        } finally {
            mic = null;
            if (record != null) {
                try { record.stop(); } catch (Exception ignored) { }
                try { record.release(); } catch (Exception ignored) { }
            }
            if (rec != null) {
                try { rec.close(); } catch (Exception ignored) { }
            }
        }
    }

    private boolean idleExpired() {
        return System.currentTimeMillis() - lastIntentAt > idleMinutes * 60000L;
    }

    // ── parsing ───────────────────────────────────────────────────────────────

    private static final class Intent {
        String command;
        int option = -1;
    }

    private Intent parse(String raw, JSONArray opts) {
        String norm = normalize(raw);
        if (norm.isEmpty()) return null;

        // 1. commands
        for (Iterator<String> it = commands.keys(); it.hasNext();) {
            String name = it.next();
            JSONArray phrases = commands.optJSONArray(name);
            if (phrases == null) continue;
            for (int i = 0; i < phrases.length(); i++) {
                String p = normalize(phrases.optString(i));
                if (p.isEmpty()) continue;
                if ("zh".equals(lang) ? norm.contains(p) : norm.equals(p)) {
                    Intent intent = new Intent();
                    intent.command = name;
                    return intent;
                }
            }
        }

        // 2. explicit button number ("option three", "选项三", "第三个")
        Integer explicit = explicitIndex(norm, opts.length());
        if (explicit != null) {
            Intent intent = new Intent();
            intent.option = explicit - 1;
            return intent;
        }

        // 3. option names
        int alias = aliasIndex(norm, opts);
        if (alias >= 0) {
            Intent intent = new Intent();
            intent.option = alias;
            return intent;
        }

        // 4. a bare number ("five", "三")
        Integer bare = bareIndex(norm, opts.length());
        if (bare != null) {
            Intent intent = new Intent();
            intent.option = bare - 1;
            return intent;
        }
        return null;
    }

    private int aliasIndex(String norm, JSONArray opts) {
        // Exact matches win and must be unique.
        List<Integer> exact = new ArrayList<>();
        for (int i = 0; i < opts.length(); i++) {
            JSONArray aliases = opts.optJSONObject(i).optJSONArray("aliases");
            if (aliases == null) continue;
            for (int j = 0; j < aliases.length(); j++) {
                if (norm.equals(normalize(aliases.optString(j)))) {
                    if (!exact.contains(i)) exact.add(i);
                    break;
                }
            }
        }
        if (exact.size() == 1) return exact.get(0);
        if (exact.size() > 1) return -1;

        if (!"zh".equals(lang)) return -1;

        // Chinese has no word boundaries: "五度" has to find "纯五度", and
        // "我觉得是纯五度" has to find it too. Longest overlap wins.
        int best = -1;
        double bestScore = 0;
        double second = 0;
        for (int i = 0; i < opts.length(); i++) {
            JSONArray aliases = opts.optJSONObject(i).optJSONArray("aliases");
            if (aliases == null) continue;
            for (int j = 0; j < aliases.length(); j++) {
                String alias = normalize(aliases.optString(j));
                if (alias.length() < 2) continue;
                boolean overlap = norm.contains(alias)
                        || (norm.length() >= 2 && alias.contains(norm));
                if (!overlap) continue;
                double score = (double) Math.min(norm.length(), alias.length())
                        / Math.max(norm.length(), alias.length());
                if (score > bestScore) {
                    if (best >= 0 && best != i) second = Math.max(second, bestScore);
                    bestScore = score;
                    best = i;
                } else if (i != best) {
                    second = Math.max(second, score);
                }
            }
        }
        if (best >= 0 && bestScore - second >= 0.15) return best;
        return -1;
    }

    private Integer explicitIndex(String norm, int count) {
        if ("zh".equals(lang)) {
            Matcher m = Pattern
                    .compile("(?:选项|第)([0-9零〇一二两三四五六七八九十百]+)(?:个|项|号)?$")
                    .matcher(norm);
            if (!m.find()) m = Pattern.compile("([0-9零〇一二两三四五六七八九十百]+)号$").matcher(norm);
            if (!m.find()) return null;
            Integer n = zhNumber(m.group(1));
            return n != null && n >= 1 && n <= count ? n : null;
        }
        Matcher m = Pattern.compile("^(?:option|number|choice)\\s+(.+)$").matcher(norm);
        if (!m.find()) return null;
        Integer n = numberWords(m.group(1));
        return n != null && n >= 1 && n <= count ? n : null;
    }

    private Integer bareIndex(String norm, int count) {
        Integer n;
        if ("zh".equals(lang)) {
            n = norm.matches("[0-9零〇一二两三四五六七八九十百]+") ? zhNumber(norm) : null;
        } else {
            n = norm.split(" ").length <= 3 ? numberWords(norm) : null;
        }
        return n != null && n >= 1 && n <= count ? n : null;
    }

    private String normalize(String text) {
        String s = text == null ? "" : text.toLowerCase(Locale.ROOT).trim();
        if ("zh".equals(lang)) {
            s = s.replace("♯", "升").replace("#", "升").replace("♭", "降");
            s = s.replaceAll("[，。！？、；：\"“”‘’（）【】《》〈〉,.;:!?()\\[\\]{}·•\\-—….\\s]", "");
            s = s.replace("合弦", "和弦").replace("唇", "纯");
            return s;
        }
        return s.replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    // ── answer names ──────────────────────────────────────────────────────────

    private String optionId(JSONArray opts, int index) {
        try {
            return String.valueOf(opts.getJSONObject(index).get("id"));
        } catch (Exception e) {
            return null;
        }
    }

    private String speechOf(JSONArray opts, String id) {
        for (int i = 0; i < opts.length(); i++) {
            JSONObject o = opts.optJSONObject(i);
            if (o != null && id != null && id.equals(String.valueOf(o.opt("id")))) {
                return o.optString("speech", id);
            }
        }
        return id;
    }

    private String resultSentence(JSONObject q, String answerId, String pickedId,
                                  int pickedIndex, boolean correct) {
        JSONArray opts = q.optJSONArray("options");
        String answer = speechOf(opts, answerId);
        String picked = pickedId != null ? speechOf(opts, pickedId)
                : (pickedIndex >= 0 && opts != null ? speechOf(opts, optionId(opts, pickedIndex)) : "");
        if ("zh".equals(lang)) {
            return correct ? "正确。" : "还不对。正确答案是" + answer + "——你选了" + picked + "。";
        }
        return correct ? "Correct." : "Not quite. It was " + answer + " — you chose " + picked + ".";
    }

    private String namedAnswer(JSONObject q, String answerId, String pickedId, boolean answered) {
        JSONArray opts = q.optJSONArray("options");
        String answer = speechOf(opts, answerId);
        if (!answered || pickedId == null) {
            return "zh".equals(lang) ? "答案是" + answer + "。" : "The answer is " + answer + ".";
        }
        String picked = speechOf(opts, pickedId);
        return "zh".equals(lang)
                ? "正确答案是" + answer + "——你选了" + picked + "。"
                : "It was " + answer + " — you chose " + picked + ".";
    }

    // ── results ───────────────────────────────────────────────────────────────

    private void recordResult(JSONObject q, boolean correct, String answeredId) {
        try {
            JSONObject r = new JSONObject();
            r.put("moduleId", q.optString("moduleId"));
            r.put("itemKey", q.isNull("itemKey") ? null : q.optString("itemKey"));
            r.put("correct", correct);
            r.put("answerId", String.valueOf(q.get("answerId")));
            r.put("answeredId", answeredId);
            synchronized (results) { results.put(r); }
        } catch (Exception ignored) { }
    }

    // ── audio synthesis ───────────────────────────────────────────────────────

    private JSONArray optionEvents(JSONArray opts, int index) {
        try {
            return opts.getJSONObject(index).optJSONArray("events");
        } catch (Exception e) {
            return null;
        }
    }

    private boolean playEvents(JSONArray events) {
        if (events == null || events.length() == 0) return running;
        float[] mix = render(events);
        if (mix.length == 0) return running;
        short[] pcm = new short[mix.length];
        for (int i = 0; i < mix.length; i++) {
            float v = mix[i] * volume;
            if (v > 1f) v = 1f;
            if (v < -1f) v = -1f;
            pcm[i] = (short) (v * 32767f);
        }

        AudioTrack t = null;
        try {
            int bytes = pcm.length * 2;
            t = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(OUT_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(bytes)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build();
            track = t;
            t.write(pcm, 0, pcm.length);
            t.play();

            long end = System.currentTimeMillis() + (pcm.length * 1000L / OUT_RATE) + 80;
            while (running && System.currentTimeMillis() < end) {
                if (idleExpired()) {
                    stopReason = "idle";
                    running = false;
                    break;
                }
                try { Thread.sleep(30); } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (Throwable e) {
            Log.e(TAG, "playback failed", e);
        } finally {
            track = null;
            if (t != null) {
                try { t.stop(); } catch (Exception ignored) { }
                try { t.release(); } catch (Exception ignored) { }
            }
        }
        return running;
    }

    private float[] render(JSONArray events) {
        double maxEnd = 0;
        for (int i = 0; i < events.length(); i++) {
            JSONObject e = events.optJSONObject(i);
            if (e == null) continue;
            maxEnd = Math.max(maxEnd, e.optDouble("at", 0) + e.optDouble("dur", 0.5) + 0.3);
        }
        int frames = (int) Math.ceil(maxEnd * OUT_RATE);
        if (frames <= 0 || frames > OUT_RATE * 60) return new float[0];
        float[] buf = new float[frames];

        for (int i = 0; i < events.length(); i++) {
            JSONObject e = events.optJSONObject(i);
            if (e == null) continue;
            double at = e.optDouble("at", 0);
            double dur = e.optDouble("dur", 0.5);
            double vel = e.optDouble("vel", 1);
            JSONArray midis = e.optJSONArray("midis");
            if (midis != null) {
                for (int j = 0; j < midis.length(); j++) addTone(buf, midis.optInt(j), at, dur, vel);
            } else {
                addTone(buf, e.optInt("midi", 60), at, dur, vel);
            }
        }

        float peak = 0;
        for (float v : buf) peak = Math.max(peak, Math.abs(v));
        if (peak > 0.95f) {
            float scale = 0.95f / peak;
            for (int i = 0; i < buf.length; i++) buf[i] *= scale;
        }
        return buf;
    }

    /** triangle + sine + octave sine, with the web player's decay envelope. */
    private void addTone(float[] buf, int midi, double at, double dur, double vel) {
        double freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
        int start = (int) Math.round(at * OUT_RATE);
        int len = (int) Math.round((dur + 0.25) * OUT_RATE);
        double peak = 0.5 * vel;
        for (int i = 0; i < len; i++) {
            int idx = start + i;
            if (idx < 0 || idx >= buf.length) break;
            double t = i / (double) OUT_RATE;
            double env;
            if (t < 0.01) {
                env = peak * (t / 0.01);
            } else if (t < dur) {
                env = peak * Math.pow(0.18, (t - 0.01) / Math.max(0.01, dur - 0.01));
            } else {
                env = peak * 0.18 * Math.pow(0.0044, (t - dur) / 0.25);
            }
            double phase = 2 * Math.PI * freq * t;
            double tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
            double s = 0.50 * tri + 0.30 * Math.sin(phase) + 0.08 * Math.sin(2 * phase);
            buf[idx] += (float) (s * env);
        }
    }

    // ── TTS ───────────────────────────────────────────────────────────────────

    private void initTts() {
        final CountDownLatch ready = new CountDownLatch(1);
        try {
            // The engine binds to a service; creating and driving it from the
            // main thread is the documented path.
            main.post(() -> {
                try {
                    tts = new TextToSpeech(context, status -> {
                        try {
                            if (status == TextToSpeech.SUCCESS && tts != null) {
                                tts.setLanguage("zh".equals(lang)
                                        ? Locale.SIMPLIFIED_CHINESE : Locale.US);
                                tts.setSpeechRate(0.95f);
                                tts.setAudioAttributes(new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_MEDIA)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                        .build());
                                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                                    @Override public void onStart(String id) { }
                                    @Override public void onDone(String id) { finishSpeech(); }
                                    @Override public void onError(String id) { finishSpeech(); }
                                });
                                ttsReady = true;
                            }
                        } finally {
                            ready.countDown();
                        }
                    });
                } catch (Throwable t) {
                    ready.countDown();
                }
            });
            ready.await(3000, TimeUnit.MILLISECONDS);
        } catch (Throwable t) {
            Log.w(TAG, "TTS unavailable", t);
        }
    }

    private void speak(String text) {
        if (text == null || text.isEmpty() || !running) return;
        if (!ttsReady || tts == null) {
            sleep(900);
            return;
        }
        CountDownLatch latch = new CountDownLatch(1);
        ttsDone = latch;
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
        try {
            main.post(() -> {
                if (tts != null) {
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "native-feedback");
                } else {
                    latch.countDown();
                }
            });
            latch.await(8, TimeUnit.SECONDS);
        } catch (Throwable e) {
            Log.w(TAG, "speak failed", e);
        } finally {
            if (ttsDone == latch) ttsDone = null;
        }
    }

    private void finishSpeech() {
        CountDownLatch latch = ttsDone;
        if (latch != null) latch.countDown();
    }

    private synchronized void shutdownTts() {
        ttsReady = false;
        if (tts != null) {
            try { tts.stop(); } catch (Exception ignored) { }
            try { tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
        }
    }

    // ── model ─────────────────────────────────────────────────────────────────

    private Model loadModel() throws Exception {
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        File dir = new File(context.getFilesDir(), "asr-" + lang + "-" + MODEL_VERSION);
        File marker = new File(dir, ".ready");
        if (!marker.exists()) {
            Log.d(TAG, "unpacking " + lang + " model into " + dir);
            if (dir.exists()) deleteTree(dir);
            if (!dir.mkdirs()) throw new IOException("cannot create " + dir);
            copyAsset(MODEL_DIR + "/" + lang, dir);
            if (!marker.createNewFile()) throw new IOException("cannot write model marker");
        }
        return new Model(dir.getAbsolutePath());
    }

    private void closeModel() {
        synchronized (this) {
            if (model != null) {
                try { model.close(); } catch (Exception ignored) { }
                model = null;
            }
        }
    }

    private void copyAsset(String path, File out) throws IOException {
        AssetManager assets = context.getAssets();
        String[] children = assets.list(path);
        if (children != null && children.length > 0) {
            if (!out.exists() && !out.mkdirs()) throw new IOException("mkdir failed: " + out);
            for (String child : children) copyAsset(path + "/" + child, new File(out, child));
            return;
        }
        File parent = out.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("mkdir failed: " + parent);
        }
        try (InputStream in = assets.open(path);
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

    // ── grammar and number words ──────────────────────────────────────────────

    private String buildGrammar(JSONArray opts) throws Exception {
        if ("zh".equals(lang)) return null;   // the zh model ships no word list
        JSONArray phrases = new JSONArray();
        for (int i = 0; i < opts.length(); i++) {
            JSONArray aliases = opts.optJSONObject(i).optJSONArray("aliases");
            if (aliases == null) continue;
            for (int j = 0; j < aliases.length(); j++) addPhrase(phrases, aliases.optString(j));
        }
        for (Iterator<String> it = commands.keys(); it.hasNext();) {
            JSONArray list = commands.optJSONArray(it.next());
            if (list == null) continue;
            for (int i = 0; i < list.length(); i++) addPhrase(phrases, list.optString(i));
        }
        for (int n = 1; n <= opts.length(); n++) {
            String card = numberWord(n);
            String ord = ordinalWord(n);
            addPhrase(phrases, card);
            addPhrase(phrases, ord);
            addPhrase(phrases, "option " + card);
            addPhrase(phrases, "number " + card);
            addPhrase(phrases, "option " + ord);
            addPhrase(phrases, "number " + ord);
        }
        return phrases.toString();
    }

    private static void addPhrase(JSONArray list, String phrase) {
        String p = phrase == null ? "" : phrase.trim().toLowerCase(Locale.ROOT);
        if (p.isEmpty() || !p.matches("[ -~]+")) return;
        for (int i = 0; i < list.length(); i++) if (p.equals(list.optString(i))) return;
        list.put(p);
    }

    private static final String[] ONES = {
            "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
            "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
            "sixteen", "seventeen", "eighteen", "nineteen",
    };
    private static final String[] TENS = {
            "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    };
    private static final Map<String, Integer> ORDINALS = new HashMap<>();

    static {
        for (int n = 1; n <= 99; n++) ORDINALS.put(ordinalWord(n), n);
    }

    private static String numberWord(int n) {
        if (n < 20) return ONES[n];
        int t = n / 10, o = n % 10;
        return TENS[t] + (o > 0 ? " " + ONES[o] : "");
    }

    private static String ordinalWord(int n) {
        String word = numberWord(n);
        String[] parts = word.split(" ");
        String last = parts[parts.length - 1];
        String ord;
        switch (last) {
            case "one": ord = "first"; break;
            case "two": ord = "second"; break;
            case "three": ord = "third"; break;
            case "five": ord = "fifth"; break;
            case "eight": ord = "eighth"; break;
            case "nine": ord = "ninth"; break;
            case "twelve": ord = "twelfth"; break;
            default:
                ord = last.endsWith("y")
                        ? last.substring(0, last.length() - 1) + "ieth"
                        : last + "th";
        }
        if (parts.length == 1) return ord;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length - 1; i++) sb.append(parts[i]).append(' ');
        return sb.append(ord).toString();
    }

    private static Integer numberWords(String text) {
        String s = text.trim();
        Integer ordinal = ORDINALS.get(s);
        if (ordinal != null) return ordinal;
        int total = 0;
        String[] words = s.split("\\s+");
        if (words.length == 0 || words.length > 3) return null;
        for (String w : words) {
            int one = indexOf(ONES, w);
            int ten = indexOf(TENS, w);
            if (one >= 0) total += one;
            else if (ten > 1) total += ten * 10;
            else return null;
        }
        return total;
    }

    private static int indexOf(String[] arr, String value) {
        for (int i = 0; i < arr.length; i++) if (arr[i].equals(value)) return i;
        return -1;
    }

    private static Integer zhNumber(String text) {
        if (text.matches("\\d+")) return Integer.parseInt(text);
        int total = 0, num = 0;
        for (char ch : text.toCharArray()) {
            if (ch == '十') { total += (num == 0 ? 1 : num) * 10; num = 0; }
            else if (ch == '百') { total += (num == 0 ? 1 : num) * 100; num = 0; }
            else {
                int d = "零〇一二两三四五六七八九".indexOf(ch);
                if (d < 0) return null;
                num = d == 0 ? 0 : d;
            }
        }
        return total + num;
    }

    // ── misc ──────────────────────────────────────────────────────────────────

    private static String field(String json, String key) {
        try {
            return new JSONObject(json).optString(key, "");
        } catch (Exception e) {
            return "";
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

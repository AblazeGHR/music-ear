package app.earpath;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.Locale;

/**
 * Native text-to-speech for the spoken answer names.
 *
 * Android's WebView has no working Web Speech synthesis (speechSynthesis exists
 * but has no voices), so js/speech.js prefers this bridge when the page runs
 * inside the app. The phrase is always English, so the engine is pinned to
 * en-US and spoken a touch slower, matching the web fallback's rate.
 */
public class TtsBridge {

    private static final String TAG = "earpath-tts";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final WebView web;
    private TextToSpeech engine;
    private volatile boolean ready;
    private String pendingText;
    private float pendingVolume = 1f;

    TtsBridge(Context context, WebView web) {
        this.web = web;
        engine = new TextToSpeech(context.getApplicationContext(), status -> {
            if (engine == null) return;          // activity already destroyed
            if (status != TextToSpeech.SUCCESS) {
                Log.w(TAG, "no speech engine available");
                return;
            }
            int lang = engine.setLanguage(Locale.US);
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "en-US voice not installed");
            }
            engine.setSpeechRate(0.95f);
            engine.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { notifySpeechEnd(); }
                @Override public void onError(String id) { notifySpeechEnd(); }
            });
            ready = true;
            if (pendingText != null) {
                speakNow(pendingText, pendingVolume);
                pendingText = null;
            }
        });
    }

    /** speak(text, volume) — volume follows the app's own volume setting. */
    @JavascriptInterface
    public void speak(String text, float volume) {
        if (text == null || text.isEmpty()) return;
        final float v = Math.max(0f, Math.min(1f, volume));
        main.post(() -> {
            if (!ready) {
                pendingText = text;
                pendingVolume = v;
                return;
            }
            speakNow(text, v);
        });
    }

    @JavascriptInterface
    public void cancel() {
        main.post(() -> {
            pendingText = null;
            if (ready) engine.stop();
        });
    }

    @JavascriptInterface
    public boolean isReady() {
        return ready;
    }

    /** Lets the page resume listening only after the TTS line has finished. */
    private void notifySpeechEnd() {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__speechEnd&&window.__speechEnd()", null);
        });
    }

    private void speakNow(String text, float volume) {
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "earpath-answer");
    }

    void shutdown() {
        main.removeCallbacksAndMessages(null);
        if (engine != null) {
            engine.stop();
            engine.shutdown();
            engine = null;
        }
    }
}

package app.earpath;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.webkit.WebView;

/**
 * Keeps a voice session alive with the screen off.
 *
 * A plain Activity is paused when the screen locks; the microphone and the
 * WebView timers then stop. A foreground service with the microphone type plus
 * a partial wake lock keeps the process and the recorder running, and the
 * activity skips WebView.onPause() while this service is alive.
 *
 * This does not fight Doze forever: the service starts only from the visible
 * voice switch, shows a notification, and stops when voice mode stops.
 */
public class PracticeService extends Service {

    private static final String CHANNEL = "voice-practice";
    private static final int NOTIFICATION_ID = 41;
    private static final String ACTION_STOP = "app.earpath.PRACTICE_STOP";

    private static volatile boolean running;

    private static volatile boolean nativeActive;
    private static volatile String lastNativeResults;
    private static volatile String pendingNative;
    private NativePractice nativeEngine;
    private int nativeAnswered;
    private int nativeCorrect;
    private String nativeLine = "";

    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private MediaSession anchor;

    private final android.os.Handler heartbeat = new android.os.Handler(android.os.Looper.getMainLooper());
    private int jsTicks;
    private int beats;
    private static volatile java.lang.ref.WeakReference<WebView> webRef = new java.lang.ref.WeakReference<>(null);
    private static volatile PracticeService instance;

    /** The page is a WebView owned by the activity; the service only pokes it. */
    static void attachWebView(WebView web) {
        webRef = new java.lang.ref.WeakReference<>(web);
    }

    static void detachWebView(WebView web) {
        WebView current = webRef.get();
        if (current == web) webRef = new java.lang.ref.WeakReference<>(null);
    }

    /** JS calls this from window.__practiceTick, so we can see it is alive. */
    static void onJsTick() {
        PracticeService s = instance;
        if (s == null) return;
        s.heartbeat.post(() -> {
            s.jsTicks++;
            if (s.jsTicks % 5 == 0) s.updateNotification();
        });
    }

    private final Runnable beat = new Runnable() {
        @Override public void run() {
            WebView web = webRef.get();
            if (running && web != null && !nativeActive) {
                // resumeTimers() undoes an implicit WebView pause; the eval is
                // the actual liveness probe and drives pending auto-advance.
                web.resumeTimers();
                web.evaluateJavascript("window.__practiceTick&&window.__practiceTick()", null);
                beats++;
            }
            heartbeat.postDelayed(this, 1000);
        }
    };

    public static boolean isRunning() {
        return running;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // A sticky restart without an Activity means there is no page left to
        // drive; do not leave a zombie foreground service holding the mic.
        if (intent == null && webRef.get() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            createChannel();
            Notification notification = buildNotification();
            startInForeground(notification);
        } catch (Throwable t) {
            Log.e("earpath-practice", "startForeground failed", t);
            PracticeBridge.setActive(false);
            stopSelf();
            return START_NOT_STICKY;
        }

        running = true;
        instance = this;
        acquireWakeLock();
        requestAudioFocus();
        anchorSession();
        heartbeat.removeCallbacks(beat);
        heartbeat.postDelayed(beat, 1000);
        // The screen may have locked before the service finished starting; the
        // payload was already handed over, so begin as soon as we are alive.
        String pending = pendingNative;
        pendingNative = null;
        if (pending != null && !pending.isEmpty()) startNative(pending);
        return START_STICKY;
    }

    private void startInForeground(Notification notification) {
        if (Build.VERSION.SDK_INT >= 30) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                            | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onDestroy() {
        if (nativeEngine != null) {
            lastNativeResults = nativeEngine.resultsJson();
            nativeEngine.stop();
            nativeEngine = null;
        }
        nativeActive = false;
        running = false;
        instance = null;
        heartbeat.removeCallbacks(beat);
        PracticeBridge.setActive(false);
        if (anchor != null) {
            try { anchor.setActive(false); } catch (Exception ignored) { }
            try { anchor.release(); } catch (Exception ignored) { }
            anchor = null;
        }
        releaseAudioFocus();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── notification ─────────────────────────────────────────────────────────

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL,
                isChinese() ? "语音练习" : "Voice practice",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(isChinese()
                ? "锁屏后保持麦克风与播放"
                : "Keeps the microphone and playback running with the screen off");
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private void updateNotification() {
        if (!running) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTIFICATION_ID, buildNotification());
        } catch (Throwable ignored) { }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openIntent = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        String title;
        String text;
        if (nativeActive) {
            title = isChinese() ? "锁屏练习进行中" : "Screen-off practice running";
            text = isChinese()
                    ? "第 " + nativeLine + " 题 · 已答 " + nativeAnswered + " · 正确 " + nativeCorrect
                    : "Question " + nativeLine + " · answered " + nativeAnswered + " · correct " + nativeCorrect;
        } else {
            title = isChinese() ? "语音练习进行中" : "Voice practice running";
            text = isChinese()
                    ? "锁屏后仍可继续 · 心跳 " + jsTicks
                    : "Listening with the screen off · heartbeat " + jsTicks;
        }
        return builder
                .setSmallIcon(R.drawable.ic_practice)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openIntent)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    // ── power / audio ────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "earpath:voice-practice");
        wakeLock.setReferenceCounted(false);
        // Long enough for a practice session; the timeout prevents a leaked
        // service from draining the battery forever.
        wakeLock.acquire(12 * 60 * 60 * 1000L);
    }

    private void requestAudioFocus() {
        if (focusRequest != null) return;
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(change -> { })
                .build();
        audioManager.requestAudioFocus(focusRequest);
    }

    private void anchorSession() {
        if (anchor != null) return;
        try {
            MediaSession s = new MediaSession(this, "earpath-practice");
            s.setPlaybackState(new PlaybackState.Builder()
                    .setState(PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f)
                    .build());
            s.setSessionActivity(PendingIntent.getActivity(this, 0,
                    new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            s.setActive(true);
            anchor = s;
        } catch (Throwable t) {
            Log.w("earpath-practice", "media session unavailable", t);
        }
    }

    private void releaseAudioFocus() {
        if (audioManager != null && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        }
        focusRequest = null;
    }

    private boolean isChinese() {
        return "zh".equals(PracticeBridge.currentLang());
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, PracticeService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, PracticeService.class));
    }

    // ── native screen-off engine ─────────────────────────────────────────────

    static boolean isNativeActive() {
        return nativeActive;
    }

    /** Runs the pre-built queue natively; the page may be frozen from here on. */
    static void startNative(String json) {
        if (json == null || json.isEmpty()) return;
        PracticeService s = instance;
        if (s == null) {
            pendingNative = json;
            return;
        }
        lastNativeResults = null;
        if (s.nativeEngine != null) {
            s.nativeEngine.stop();
            s.nativeEngine = null;
        }
        s.nativeAnswered = 0;
        s.nativeCorrect = 0;
        s.nativeLine = "1";
        s.nativeEngine = new NativePractice(s, new NativePractice.Listener() {
            @Override public void onProgress(int answered, int correct) {
                s.nativeAnswered = answered;
                s.nativeCorrect = correct;
                s.nativeLine = String.valueOf(answered + 1);
                s.heartbeat.post(s::updateNotification);
            }

            @Override public void onFinished(String reason) {
                nativeActive = false;
                if (s.nativeEngine != null) lastNativeResults = s.nativeEngine.resultsJson();
                s.heartbeat.post(s::updateNotification);
                // A session that ended by itself (stop command / idle timeout /
                // error) must release the microphone and wake lock; the page
                // picks the results up when it becomes visible.
                if (!"resume".equals(reason)) {
                    // Voice mode is over; release the microphone and wake lock.
                    // The page receives the stashed results when it returns.
                    s.heartbeat.postDelayed(s::stopSelf, 1500);
                }
            }
        });
        nativeActive = true;
        s.nativeEngine.start(json);
        s.updateNotification();
    }

    /** Stops the engine and returns its results (null when none ran). */
    static String stopNative() {
        nativeActive = false;
        pendingNative = null;
        PracticeService s = instance;
        String out = lastNativeResults;
        lastNativeResults = null;
        if (s != null && s.nativeEngine != null) {
            s.nativeEngine.stop();
            out = s.nativeEngine.resultsJson();
            s.nativeEngine = null;
        }
        return out;
    }
}

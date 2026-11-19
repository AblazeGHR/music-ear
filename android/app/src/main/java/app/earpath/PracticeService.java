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

    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        Notification notification = buildNotification();
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

        running = true;
        acquireWakeLock();
        requestAudioFocus();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        PracticeBridge.setActive(false);
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

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openIntent = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_practice)
                .setContentTitle(isChinese() ? "语音练习进行中" : "Voice practice running")
                .setContentText(isChinese()
                        ? "锁屏后仍可继续，点按返回"
                        : "Keeps listening with the screen off — tap to return")
                .setOngoing(true)
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
        wakeLock.acquire();
    }

    private void requestAudioFocus() {
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

    private void releaseAudioFocus() {
        if (audioManager != null && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        }
        focusRequest = null;
    }

    private boolean isChinese() {
        try {
            ApplicationInfo info = getPackageManager()
                    .getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            return info.metaData != null && "zh".equals(info.metaData.getString("app.lang"));
        } catch (Exception e) {
            return false;
        }
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, PracticeService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, PracticeService.class));
    }
}

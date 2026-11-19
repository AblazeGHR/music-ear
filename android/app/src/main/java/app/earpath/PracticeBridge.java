package app.earpath;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * JS entry point for screen-off practice. The page calls start() when the
 * voice switch goes on and stop() when it goes off (or times out), so the
 * foreground service exists exactly as long as the microphone should.
 */
public class PracticeBridge {

    private static final int NOTIFICATION_REQUEST = 72;
    private static volatile boolean active;
    private final Activity activity;

    PracticeBridge(Activity activity) {
        this.activity = activity;
    }

    static boolean isActive() { return active; }
    static void setActive(boolean value) { active = value; }

    @JavascriptInterface
    public void start() {
        // The page calls this when recognition reports "listening", which is
        // also when RECORD_AUDIO is known to be granted; a microphone FGS
        // without it would throw on Android 14.
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        active = true;
        if (Build.VERSION.SDK_INT >= 33
                && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
        }
        PracticeService.start(activity);
    }

    @JavascriptInterface
    public void stop() {
        active = false;
        PracticeService.stop(activity);
    }
}

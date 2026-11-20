package app.earpath;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import android.webkit.JavascriptInterface;

/**
 * JS entry point for screen-off practice. The page calls start() when the
 * voice switch goes on and stop() when it goes off (or times out), so the
 * foreground service exists exactly as long as the microphone should.
 */
public class PracticeBridge {

    private static final int NOTIFICATION_REQUEST = 72;
    private static volatile boolean active;
    private static volatile boolean pendingStart;
    private static volatile String currentLang = "en";
    private final Activity activity;

    PracticeBridge(Activity activity) {
        this.activity = activity;
    }

    static boolean isActive() { return active; }
    static void setActive(boolean value) { active = value; }
    static String currentLang() { return currentLang; }

    @JavascriptInterface
    public boolean start(String lang) {
        if ("zh".equals(lang)) currentLang = "zh";
        else if ("en".equals(lang)) currentLang = "en";
        // Starting the service before the model loads closes the race where the
        // screen is locked during model preparation. Without RECORD_AUDIO a
        // microphone FGS would throw on Android 14, so defer until the runtime
        // permission result arrives.
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            pendingStart = true;
            return false;
        }
        // JavascriptInterface methods run off the UI thread; both the runtime
        // permission request and startForegroundService belong on main.
        activity.runOnUiThread(this::startService);
        return true;
    }

    private void startService() {
        active = true;
        if (PracticeService.isRunning()) return;
        if (Build.VERSION.SDK_INT >= 33
                && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
        }
        try {
            PracticeService.start(activity);
            Log.i("earpath-practice", "foreground service requested");
        } catch (Throwable t) {
            active = false;
            Log.e("earpath-practice", "foreground service refused", t);
        }
    }

    /** Called by the activity when RECORD_AUDIO is granted. */
    void onMicGranted() {
        if (!pendingStart) return;
        pendingStart = false;
        startService();
    }

    @JavascriptInterface
    public boolean isRunning() {
        return PracticeService.isRunning();
    }

    @JavascriptInterface
    public void stop() {
        active = false;
        pendingStart = false;
        PracticeService.stop(activity);
    }
}

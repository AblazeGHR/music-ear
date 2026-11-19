package app.earpath;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The whole Android app: a full-screen WebView pointed at the static site that
 * ships inside the APK.
 *
 * The site is served from a fake https origin rather than file:// because ES
 * modules (the app is plain <script type="module">) and localStorage require a
 * real origin. Requests for that origin are answered from assets/www.
 */
public class MainActivity extends Activity implements SpeechBridge.Host {

    private static final String TAG = "earpath";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final int BG = 0xFF0B0E14;

    private static final int MIC_REQUEST = 71;

    private WebView web;
    private TtsBridge tts;
    private SpeechBridge speech;
    private PracticeBridge practice;
    private String appLang = "en";
    private boolean webPaused;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        tts = new TtsBridge(this, web);
        web.addJavascriptInterface(tts, "AndroidTTS");

        appLang = readAppLanguage();
        speech = new SpeechBridge(this, web, this, appLang);
        web.addJavascriptInterface(speech, "AndroidASR");

        practice = new PracticeBridge(this);
        web.addJavascriptInterface(practice, "AndroidPractice");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15 forces edge-to-edge for targetSdk 35, so the WebView would
        // otherwise sit under the status and gesture bars. Keep the bars dark
        // and pad the content by exactly the system insets.
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl());
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        // With a voice session running the screen may be locked on purpose;
        // pausing the WebView here would freeze timers and question playback.
        if (!PracticeBridge.isActive()) {
            web.onPause();
            webPaused = true;
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webPaused) {
            web.onResume();
            webPaused = false;
        }
    }

    @Override
    protected void onDestroy() {
        web.removeJavascriptInterface("AndroidTTS");
        web.removeJavascriptInterface("AndroidASR");
        web.removeJavascriptInterface("AndroidPractice");
        if (speech != null) speech.shutdown();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    // ── microphone permission (voice answering) ────────────────────────────

    @Override
    public boolean hasMicPermission() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void requestMicPermission() {
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MIC_REQUEST && speech != null) {
            speech.onPermissionResult(results.length > 0
                    && results[0] == PackageManager.PERMISSION_GRANTED);
        }
    }

    private String readAppLanguage() {
        try {
            ApplicationInfo info = getPackageManager()
                    .getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
            String lang = info.metaData == null ? "" : info.metaData.getString("app.lang", "");
            return lang == null || lang.isEmpty() ? "en" : lang;
        } catch (Exception ignored) {
            return "en";
        }
    }

    /** The build's language is fixed in the manifest; the page reads ?lang=. */
    private String startUrl() {
        return START_URL + "?lang=" + appLang;
    }

    /** Back walks the app's own hash history before leaving the app. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private final class AppClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            // The APK is self-contained: external resources are refused rather
            // than fetched, so a stray URL cannot leak or stall offline use.
            if (url == null || !APP_HOST.equals(url.getHost())) return blocked();
            return asset(url.getPath());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url != null && APP_HOST.equals(url.getHost())) return false;
            openExternally(url);
            return true;
        }
    }

    /** Maps https://appassets.androidplatform.net/<path> onto assets/www/<path>. */
    private WebResourceResponse asset(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.endsWith("/")) path = path + "index.html";
        String rel = path.substring(1);
        if (rel.contains("..")) return notFound();

        try {
            InputStream in = getAssets().open("www/" + rel);
            Map<String, String> headers = new HashMap<>();
            // The bundle changes only with the APK, but WebView's HTTP cache
            // would happily keep the previous version's JS across an update.
            headers.put("Cache-Control", "no-store");
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime(rel), "utf-8", 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", null, null);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
    }

    private static String mime(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase();
        switch (ext) {
            case "html": return "text/html";
            case "css": return "text/css";
            case "js": case "mjs": return "text/javascript";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "woff2": return "font/woff2";
            case "mp3": return "audio/mpeg";
            default: return "application/octet-stream";
        }
    }

    /** GitHub / changelog / mailto links open in the real browser or mail app. */
    private void openExternally(Uri url) {
        if (url == null) return;
        String scheme = url.getScheme();
        if (scheme == null) return;
        if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no handler for " + url);
        }
    }
}

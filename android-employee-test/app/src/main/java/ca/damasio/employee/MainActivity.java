package ca.damasio.employee;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.animation.LinearInterpolator;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;
import android.widget.VideoView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://damasio-os-h1mc.vercel.app/mobile/login?v=5215";
    private static final String LOGIN_URL = "https://damasio-os-h1mc.vercel.app/mobile/login?v=5215";
    private static final String STARTUP_CONFIG_URL = "https://damasio-os-h1mc.vercel.app/brand/mobile-startup.json";
    private static final String STARTUP_PREFS = "four_ever_startup";
    private static final String STARTUP_VERSION_KEY = "cached_video_version";
    private static final String STARTUP_VIDEO_FILE = "four-ever-startup.mp4";
    private static final String APP_HOST = "damasio-os-h1mc.vercel.app";
    private static final String MOBILE_PATH = "/mobile";
    private static final int FILE_CHOOSER_REQUEST = 4101;
    private static final int PERMISSION_REQUEST = 4102;

    private WebView webView;
    private ProgressBar progressBar;
    private View startupOverlay;
    private VideoView startupVideo;
    private ProgressBar startupProgress;
    private ObjectAnimator startupProgressAnimator;
    private long startupDurationMs = 3000L;
    private boolean playingCachedStartupVideo = false;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private long lastBackPressedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.employeeWebView);
        progressBar = findViewById(R.id.pageProgress);
        startupOverlay = findViewById(R.id.startupOverlay);
        startupVideo = findViewById(R.id.startupVideo);
        startupProgress = findViewById(R.id.startupProgress);
        applySystemBarInsets();
        configureWebView();

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
            startStartupVideo();
        } else {
            startupOverlay.setVisibility(View.GONE);
            webView.restoreState(savedInstanceState);
            requestOptionalPermissions();
        }
    }

    private void startStartupVideo() {
        startupVideo.setOnPreparedListener(player -> {
            player.setVolume(0f, 0f);
            if (player.getDuration() > 0) startupDurationMs = player.getDuration();
            startupVideo.start();
            startupVideo.postDelayed(this::startStartupProgress, 70L);
        });
        startupVideo.setOnCompletionListener(player -> finishStartup());
        startupVideo.setOnErrorListener((player, what, extra) -> {
            if (playingCachedStartupVideo) {
                playingCachedStartupVideo = false;
                File cached = new File(getFilesDir(), STARTUP_VIDEO_FILE);
                if (cached.exists()) cached.delete();
                getSharedPreferences(STARTUP_PREFS, MODE_PRIVATE).edit().remove(STARTUP_VERSION_KEY).apply();
                startupDurationMs = 3000L;
                startupVideo.post(() -> startupVideo.setVideoURI(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.four_ever_seasons_opening)));
                return true;
            }
            finishStartup();
            return true;
        });
        File cachedVideo = new File(getFilesDir(), STARTUP_VIDEO_FILE);
        playingCachedStartupVideo = cachedVideo.isFile() && cachedVideo.length() > 100_000L;
        if (playingCachedStartupVideo) startupVideo.setVideoPath(cachedVideo.getAbsolutePath());
        else startupVideo.setVideoURI(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.four_ever_seasons_opening));
        refreshRemoteStartupVideo();
    }

    private void startStartupProgress() {
        if (!startupVideo.isPlaying() || startupOverlay.getVisibility() != View.VISIBLE) return;
        startupProgress.setProgress(0);
        startupProgress.setVisibility(View.VISIBLE);
        startupProgressAnimator = ObjectAnimator.ofInt(startupProgress, "progress", 0, 1000);
        startupProgressAnimator.setDuration(Math.max(1L, startupDurationMs - 140L));
        startupProgressAnimator.setInterpolator(new LinearInterpolator());
        startupProgressAnimator.start();
    }

    private void refreshRemoteStartupVideo() {
        new Thread(() -> {
            HttpURLConnection configConnection = null;
            HttpURLConnection videoConnection = null;
            File temporary = new File(getFilesDir(), STARTUP_VIDEO_FILE + ".download");
            try {
                configConnection = openConnection(STARTUP_CONFIG_URL + "?t=" + System.currentTimeMillis());
                JSONObject config = new JSONObject(readText(configConnection.getInputStream()));
                String version = config.optString("version", "").trim();
                String videoUrl = config.optString("videoUrl", "").trim();
                if (version.isEmpty() || !videoUrl.startsWith("https://")) return;
                SharedPreferences preferences = getSharedPreferences(STARTUP_PREFS, MODE_PRIVATE);
                File cached = new File(getFilesDir(), STARTUP_VIDEO_FILE);
                if (version.equals(preferences.getString(STARTUP_VERSION_KEY, "")) && cached.length() > 100_000L) return;

                videoConnection = openConnection(videoUrl + (videoUrl.contains("?") ? "&" : "?") + "v=" + Uri.encode(version));
                try (InputStream input = videoConnection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[16_384];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.getFD().sync();
                }
                if (temporary.length() < 100_000L) return;
                if (cached.exists() && !cached.delete()) return;
                if (temporary.renameTo(cached)) preferences.edit().putString(STARTUP_VERSION_KEY, version).apply();
            } catch (Exception ignored) {
                // The bundled video remains the offline-safe fallback.
            } finally {
                if (configConnection != null) configConnection.disconnect();
                if (videoConnection != null) videoConnection.disconnect();
                if (temporary.exists()) temporary.delete();
            }
        }, "startup-video-refresh").start();
    }

    private HttpURLConnection openConnection(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json,video/mp4,*/*");
        connection.connect();
        if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) throw new IOException("HTTP " + connection.getResponseCode());
        return connection;
    }

    private String readText(InputStream input) throws IOException {
        try (InputStream stream = input) {
            byte[] buffer = new byte[4096];
            StringBuilder text = new StringBuilder();
            int count;
            while ((count = stream.read(buffer)) != -1) text.append(new String(buffer, 0, count, java.nio.charset.StandardCharsets.UTF_8));
            return text.toString();
        }
    }

    private void finishStartup() {
        if (startupProgressAnimator != null) startupProgressAnimator.cancel();
        startupProgress.setProgress(1000);
        startupOverlay.setVisibility(View.GONE);
        startupVideo.stopPlayback();
        requestOptionalPermissions();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " 4EverSeasonsAndroid/52.1.5");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isEmployeeUrl(uri)) return false;
                if ("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) {
                    view.loadUrl(APP_URL);
                    Toast.makeText(MainActivity.this, "This link is not available inside 4Ever Seasons.", Toast.LENGTH_SHORT).show();
                    return true;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progressBar.setVisibility(View.GONE);
                    showOfflinePage();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean granted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin, granted, false);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean cameraGranted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                    if (cameraGranted) request.grant(request.getResources());
                    else request.deny();
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> newCallback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = newCallback;
                launchImageChooser();
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> openExternal(Uri.parse(url)));
    }

    private void applySystemBarInsets() {
        View root = findViewById(R.id.appRoot);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private boolean isEmployeeUrl(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getHost())) return false;
        String path = uri.getPath();
        return path != null && (path.equals(MOBILE_PATH) || path.startsWith(MOBILE_PATH + "/")
            || path.equals("/master") || path.startsWith("/master/")
            || path.equals("/admin") || path.startsWith("/admin/")
            || path.equals("/employee") || path.startsWith("/employee/")
            || path.equals("/customer") || path.startsWith("/customer/")
            || path.equals("/auth") || path.startsWith("/auth/"));
    }

    private void requestOptionalPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        String[] permissions = { Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION };
        ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST);
    }

    private void launchImageChooser() {
        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType("image/*");
        gallery.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        Intent chooser = Intent.createChooser(gallery, "Take or choose a photo");
        Intent camera = buildCameraIntent();
        if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });

        try {
            startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException error) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            Toast.makeText(this, "No photo app is available.", Toast.LENGTH_LONG).show();
        }
    }

    private Intent buildCameraIntent() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return null;
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (camera.resolveActivity(getPackageManager()) == null) return null;
        try {
            File image = File.createTempFile("damasio_visit_", ".jpg", getExternalCacheDir());
            cameraOutputUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", image);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return camera;
        } catch (IOException error) {
            cameraOutputUri = null;
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int index = 0; index < count; index++) results[index] = data.getClipData().getItemAt(index).getUri();
            } else if (data != null && data.getData() != null) {
                results = new Uri[] { data.getData() };
            } else if (cameraOutputUri != null) {
                results = new Uri[] { cameraOutputUri };
            }
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
        cameraOutputUri = null;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No compatible app was found.", Toast.LENGTH_LONG).show();
        }
    }

    private void showOfflinePage() {
        String html = "<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;background:#f4f7f5;font-family:sans-serif;color:#173b2a;display:grid;min-height:100vh;place-items:center'><main style='text-align:center;padding:28px'><div style='width:76px;height:76px;border-radius:24px;background:#0f6b43;color:white;display:grid;place-items:center;margin:auto;font-size:30px;font-weight:900'>4S</div><h2>Connection unavailable</h2><p>Check your internet connection and try again.</p><button onclick=\"location.href='" + APP_URL + "'\" style='border:0;border-radius:14px;background:#0f6b43;color:white;padding:14px 24px;font-weight:800'>Try again</button></main></body></html>";
        webView.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    }

    @Override
    public void onBackPressed() {
        Uri current = Uri.parse(webView.getUrl() == null ? APP_URL : webView.getUrl());
        String path = current.getPath() == null ? "" : current.getPath();
        if (!isEmployeeUrl(current)) { webView.loadUrl(APP_URL); return; }
        if (webView.canGoBack() && !path.equals("/mobile/admin") && !path.equals("/mobile/customer")) { webView.goBack(); return; }
        if (path.equals("/mobile/admin") || path.equals("/mobile/customer")) { webView.loadUrl(LOGIN_URL); return; }
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < 2000L) { moveTaskToBack(true); return; }
        lastBackPressedAt = now;
        Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}

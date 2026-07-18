package ca.damasio.employee;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
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

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.io.IOException;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://damasio-os-h1mc.vercel.app/mobile?v=5211";
    private static final String LOGIN_URL = "https://damasio-os-h1mc.vercel.app/mobile/login?v=5211";
    private static final String APP_HOST = "damasio-os-h1mc.vercel.app";
    private static final String MOBILE_PATH = "/mobile";
    private static final int FILE_CHOOSER_REQUEST = 4101;
    private static final int PERMISSION_REQUEST = 4102;

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private long lastBackPressedAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.employeeWebView);
        progressBar = findViewById(R.id.pageProgress);
        applySystemBarInsets();
        configureWebView();
        requestOptionalPermissions();

        if (savedInstanceState == null) webView.loadUrl(APP_URL);
        else webView.restoreState(savedInstanceState);
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
        settings.setUserAgentString(settings.getUserAgentString() + " DamasioOSAndroid/52.1.1");

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
        String html = "<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;background:#f4f7f5;font-family:sans-serif;color:#173b2a;display:grid;min-height:100vh;place-items:center'><main style='text-align:center;padding:28px'><div style='width:76px;height:76px;border-radius:24px;background:#0f6b43;color:white;display:grid;place-items:center;margin:auto;font-size:34px;font-weight:900'>D</div><h2>Connection unavailable</h2><p>Check your internet connection and try again.</p><button onclick=\"location.href='" + APP_URL + "'\" style='border:0;border-radius:14px;background:#0f6b43;color:white;padding:14px 24px;font-weight:800'>Try again</button></main></body></html>";
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

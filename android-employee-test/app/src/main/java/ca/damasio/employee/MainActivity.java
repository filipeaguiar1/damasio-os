package ca.damasio.employee;

import android.Manifest;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.fragment.app.FragmentActivity;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

public class MainActivity extends FragmentActivity {
    private static final String APP_URL = "https://damasio-os-h1mc.vercel.app/mobile?v=5230";
    private static final String LOGIN_URL = "https://damasio-os-h1mc.vercel.app/mobile/login?v=5230";
    private static final String APP_HOST = "damasio-os-h1mc.vercel.app";
    private static final String MOBILE_PATH = "/mobile";
    private static final int FILE_CHOOSER_REQUEST = 4101;
    private static final int PERMISSION_REQUEST = 4102;
    private static final String SECURITY_PREFS = "four_seasons_device_security";
    private static final String DEVICE_AUTH_ENABLED = "device_auth_enabled";
    private static final long BACKGROUND_RELOCK_MS = 30_000L;

    private WebView webView;
    private ProgressBar progressBar;
    private NativeOpeningController openingController;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private long lastBackPressedAt = 0L;
    private long backgroundedAt = 0L;
    private SharedPreferences securityPrefs;
    private BiometricPrompt biometricPrompt;
    private boolean authInProgress = false;
    private boolean startupUnlocked = false;
    private String pendingAuthAction = "authenticate";
    private Runnable pendingAuthSuccess;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        securityPrefs = getSharedPreferences(SECURITY_PREFS, Context.MODE_PRIVATE);
        webView = findViewById(R.id.employeeWebView);
        progressBar = findViewById(R.id.pageProgress);
        FrameLayout openingLayer = findViewById(R.id.openingLayer);
        android.view.TextureView openingTexture = findViewById(R.id.openingTexture);
        openingController = new NativeOpeningController(this, openingLayer, openingTexture);
        webView.setBackgroundColor(Color.rgb(244, 237, 220));
        progressBar.setVisibility(android.view.View.GONE);
        applySystemBarInsets();
        configureWebView();
        configureBiometricPrompt();

        final boolean lockEnabled = isDeviceAuthEnabledInternal();
        startupUnlocked = !lockEnabled;
        webView.setVisibility(lockEnabled ? android.view.View.INVISIBLE : android.view.View.VISIBLE);

        if (savedInstanceState == null) {
            openingController.start();
            if (lockEnabled) {
                webView.postDelayed(() -> authenticateForStartup(() -> {
                    webView.loadUrl(APP_URL);
                    webView.postDelayed(this::requestOptionalPermissions, 4700L);
                }), 250L);
            } else {
                webView.loadUrl(APP_URL);
                webView.postDelayed(this::requestOptionalPermissions, 4700L);
            }
        } else {
            webView.restoreState(savedInstanceState);
            openingController.finish();
            if (lockEnabled) {
                webView.postDelayed(() -> authenticateForStartup(this::requestOptionalPermissions), 250L);
            } else {
                requestOptionalPermissions();
            }
        }
    }

    private boolean isStartupUrl(String url) {
        try {
            Uri uri = Uri.parse(url);
            return APP_HOST.equals(uri.getHost()) && MOBILE_PATH.equals(uri.getPath());
        } catch (Exception ignored) {
            return false;
        }
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
        settings.setUserAgentString(settings.getUserAgentString() + " 4EverSeasonsAndroid/52.3.0 NativeOpening/2 DeviceAuth/1");

        // This bridge never returns passwords or Supabase tokens. It only exposes
        // local device-auth state/actions and the existing bundled-icon switch.
        webView.addJavascriptInterface(new NativeBridge(), "FourSeasonsNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(isStartupUrl(url) ? android.view.View.GONE : android.view.View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(android.view.View.GONE);
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
                    progressBar.setVisibility(android.view.View.GONE);
                    showOfflinePage();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                if (isStartupUrl(view.getUrl())) {
                    progressBar.setVisibility(android.view.View.GONE);
                    return;
                }
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress >= 100 ? android.view.View.GONE : android.view.View.VISIBLE);
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

    private void configureBiometricPrompt() {
        biometricPrompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                authInProgress = false;
                if ("enable".equals(pendingAuthAction)) {
                    securityPrefs.edit().putBoolean(DEVICE_AUTH_ENABLED, true).apply();
                } else if ("disable".equals(pendingAuthAction)) {
                    securityPrefs.edit().putBoolean(DEVICE_AUTH_ENABLED, false).apply();
                }
                startupUnlocked = true;
                backgroundedAt = 0L;
                webView.setVisibility(android.view.View.VISIBLE);
                emitDeviceAuthResult(pendingAuthAction, true, "ok");
                Runnable success = pendingAuthSuccess;
                pendingAuthSuccess = null;
                if (success != null) success.run();
            }

            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                authInProgress = false;
                String action = pendingAuthAction;
                pendingAuthSuccess = null;
                emitDeviceAuthResult(action, false, errString == null ? "cancelled" : errString.toString());
                if ("startup".equals(action) || "resume".equals(action)) showLockedFallbackDialog();
            }
        });
    }

    private BiometricPrompt.PromptInfo buildPromptInfo(String action) {
        String title = "enable".equals(action) ? "Enable secure device unlock" :
            "disable".equals(action) ? "Confirm before disabling" : "Unlock 4Ever Seasons";
        BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Use biometrics or your device screen lock")
            .setConfirmationRequired(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG |
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
            );
        } else {
            // AndroidX uses the system PIN/pattern/password fallback on API 24-29.
            builder.setDeviceCredentialAllowed(true);
        }
        return builder.build();
    }

    private boolean isDeviceAuthAvailableInternal() {
        BiometricManager manager = BiometricManager.from(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return manager.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_STRONG |
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
            ) == BiometricManager.BIOMETRIC_SUCCESS;
        }

        int biometric = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean credential = keyguard != null && keyguard.isDeviceSecure();
        return biometric == BiometricManager.BIOMETRIC_SUCCESS || credential;
    }

    private boolean isDeviceAuthEnabledInternal() {
        return securityPrefs != null && securityPrefs.getBoolean(DEVICE_AUTH_ENABLED, false);
    }

    private void authenticateForStartup(Runnable onSuccess) {
        if (!isDeviceAuthAvailableInternal()) {
            securityPrefs.edit().putBoolean(DEVICE_AUTH_ENABLED, false).apply();
            clearWebSessionAndUsePassword("Device security changed. Sign in again to protect this device.");
            return;
        }
        authenticateDeviceInternal("startup", onSuccess);
    }

    private void authenticateDeviceInternal(String action, Runnable onSuccess) {
        if (authInProgress) return;
        if (!isDeviceAuthAvailableInternal()) {
            emitDeviceAuthResult(action, false, "device_auth_unavailable");
            return;
        }
        pendingAuthAction = action;
        pendingAuthSuccess = onSuccess;
        authInProgress = true;
        biometricPrompt.authenticate(buildPromptInfo(action));
    }

    private void showLockedFallbackDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
            .setTitle("4Ever Seasons is locked")
            .setMessage("Authenticate with this device, or clear the local session and sign in with your account password.")
            .setPositiveButton("Try again", (dialog, which) -> authenticateDeviceInternal("startup", null))
            .setNegativeButton("Use account password", (dialog, which) -> clearWebSessionAndUsePassword(null))
            .setCancelable(false)
            .show();
    }

    private void clearWebSessionAndUsePassword(String toastMessage) {
        startupUnlocked = true;
        backgroundedAt = 0L;
        WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        webView.clearHistory();
        webView.setVisibility(android.view.View.VISIBLE);
        webView.loadUrl(LOGIN_URL);
        openingController.finish();
        if (toastMessage != null) Toast.makeText(this, toastMessage, Toast.LENGTH_LONG).show();
    }

    private void emitDeviceAuthResult(String action, boolean success, String reason) {
        if (webView == null) return;
        String js = "window.dispatchEvent(new CustomEvent('fourSeasonsDeviceAuth',{detail:{action:" +
            JSONObject.quote(action == null ? "authenticate" : action) + ",success:" + success +
            ",enabled:" + isDeviceAuthEnabledInternal() + ",reason:" + JSONObject.quote(reason == null ? "" : reason) + "}}));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private final class NativeBridge {
        @JavascriptInterface
        public String getDeviceAuthPlatform() {
            return "android";
        }

        @JavascriptInterface
        public boolean isDeviceAuthAvailable() {
            return isDeviceAuthAvailableInternal();
        }

        @JavascriptInterface
        public boolean isDeviceAuthEnabled() {
            return isDeviceAuthEnabledInternal();
        }

        @JavascriptInterface
        public void requestEnableDeviceAuth() {
            runOnUiThread(() -> authenticateDeviceInternal("enable", null));
        }

        @JavascriptInterface
        public void disableDeviceAuth() {
            runOnUiThread(() -> {
                if (!isDeviceAuthEnabledInternal()) {
                    emitDeviceAuthResult("disable", true, "already_disabled");
                    return;
                }
                authenticateDeviceInternal("disable", null);
            });
        }

        @JavascriptInterface
        public void authenticateDevice() {
            runOnUiThread(() -> authenticateDeviceInternal("authenticate", null));
        }

        @JavascriptInterface
        public void setLauncherIcon(String icon) {
            final boolean legacy = "legacy".equalsIgnoreCase(icon);
            final boolean seasonal = "seasonal".equalsIgnoreCase(icon) || "default".equalsIgnoreCase(icon);
            if (!legacy && !seasonal) return;
            runOnUiThread(() -> {
                PackageManager packageManager = getPackageManager();
                ComponentName seasonalAlias = new ComponentName(MainActivity.this, getPackageName() + ".LauncherDefault");
                ComponentName legacyAlias = new ComponentName(MainActivity.this, getPackageName() + ".LauncherLegacy");
                packageManager.setComponentEnabledSetting(
                    seasonalAlias,
                    seasonal ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
                packageManager.setComponentEnabledSetting(
                    legacyAlias,
                    legacy ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
            });
        }
    }

    private void applySystemBarInsets() {
        android.view.View root = findViewById(R.id.appRoot);
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
        String html = "<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;background:#f4eddc;font-family:sans-serif;color:#173b2a;display:grid;min-height:100vh;place-items:center'><main style='text-align:center;padding:28px'><h2>Connection unavailable</h2><p>Check your internet connection and try again.</p><button onclick=\"location.href='" + APP_URL + "'\" style='border:0;border-radius:14px;background:#0f6b43;color:white;padding:14px 24px;font-weight:800'>Try again</button></main></body></html>";
        webView.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    }

    @Override
    protected void onStop() {
        if (isDeviceAuthEnabledInternal() && startupUnlocked && !authInProgress && !isChangingConfigurations()) {
            backgroundedAt = System.currentTimeMillis();
        }
        super.onStop();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (webView == null || !isDeviceAuthEnabledInternal() || !startupUnlocked || authInProgress || backgroundedAt <= 0L) return;
        if (System.currentTimeMillis() - backgroundedAt < BACKGROUND_RELOCK_MS) return;
        webView.setVisibility(android.view.View.INVISIBLE);
        webView.postDelayed(() -> authenticateDeviceInternal("resume", () -> webView.setVisibility(android.view.View.VISIBLE)), 150L);
    }

    @Override
    public void onBackPressed() {
        if (isDeviceAuthEnabledInternal() && !startupUnlocked) return;
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
        if (openingController != null) openingController.release();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}

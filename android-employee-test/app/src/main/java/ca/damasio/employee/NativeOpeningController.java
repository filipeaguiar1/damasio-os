package ca.damasio.employee;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class NativeOpeningController {
    private static final String MANIFEST_URL = "https://www.4everseasons.com/api/mobile/opening";
    private static final String REMOTE_OPENING_FILE = "opening-remote-v5223.mp4";
    private static final String DEFAULT_OPENING_FILE = "opening-default-v5223.mp4";
    private static final String DEFAULT_OPENING_ASSET = "opening_default.mp4";
    private static final String PREFS = "mobile_opening_v5";
    private static final long TIMEOUT_MS = 7000L;

    private final Activity activity;
    private final FrameLayout layer;
    private final TextureView texture;
    private MediaPlayer player;
    private Surface surface;
    private File pendingFile;
    private boolean playbackRequested;
    private boolean finished;

    NativeOpeningController(Activity activity, FrameLayout layer, TextureView texture) {
        this.activity = activity;
        this.layer = layer;
        this.texture = texture;
        texture.setOpaque(false);
        texture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture value, int width, int height) {
                if (surface != null) surface.release();
                surface = new Surface(value);
                if (pendingFile != null && playbackRequested && !finished) play(pendingFile);
            }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture value, int width, int height) {}
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture value) {
                releasePlayer();
                if (surface != null) { surface.release(); surface = null; }
                return true;
            }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture value) {}
        });
    }

    void start() {
        finished = false;
        playbackRequested = false;
        pendingFile = null;
        texture.setAlpha(0f);
        layer.setAlpha(1f);
        layer.setVisibility(View.VISIBLE);
        layer.postDelayed(this::finish, TIMEOUT_MS);

        File cached = new File(activity.getFilesDir(), REMOTE_OPENING_FILE);
        File bundled = ensureBundledOpening();
        if (usable(cached)) requestPlayback(cached);
        else if (usable(bundled)) requestPlayback(bundled);
        else finish();

        refreshCache();
    }

    void finish() {
        if (finished) return;
        finished = true;
        playbackRequested = false;
        pendingFile = null;
        releasePlayer();
        layer.animate().alpha(0f).setDuration(160L).withEndAction(() -> {
            layer.setVisibility(View.GONE);
            layer.setAlpha(1f);
        }).start();
    }

    void release() {
        finished = true;
        releasePlayer();
        if (surface != null) { surface.release(); surface = null; }
    }

    private File ensureBundledOpening() {
        File target = new File(activity.getFilesDir(), DEFAULT_OPENING_FILE);
        if (usable(target)) return target;

        File temp = new File(activity.getFilesDir(), DEFAULT_OPENING_FILE + ".tmp");
        try (InputStream input = activity.getAssets().open(DEFAULT_OPENING_ASSET);
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temp))) {
            byte[] buffer = new byte[32768];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        } catch (Exception error) {
            temp.delete();
            return target;
        }

        if (!usable(temp)) {
            temp.delete();
            return target;
        }
        if (target.exists() && !target.delete()) {
            temp.delete();
            return target;
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            return target;
        }
        return target;
    }

    private void requestPlayback(File file) {
        if (finished || !usable(file)) { finish(); return; }
        pendingFile = file;
        playbackRequested = true;
        if (surface != null && texture.isAvailable()) play(file);
    }

    private void play(File file) {
        if (finished || surface == null || !usable(file)) return;
        releasePlayer();
        try {
            MediaPlayer next = new MediaPlayer();
            player = next;
            next.setDataSource(file.getAbsolutePath());
            next.setSurface(surface);
            next.setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING);
            next.setVolume(0f, 0f);
            next.setLooping(false);
            next.setOnPreparedListener(media -> {
                if (finished || media != player) return;
                texture.setAlpha(1f);
                media.start();
            });
            next.setOnCompletionListener(media -> finish());
            next.setOnErrorListener((media, what, extra) -> {
                playBundledFallback(file);
                return true;
            });
            next.prepareAsync();
        } catch (Exception error) {
            playBundledFallback(file);
        }
    }

    private void playBundledFallback(File failedFile) {
        File bundled = new File(activity.getFilesDir(), DEFAULT_OPENING_FILE);
        if (!failedFile.equals(bundled) && usable(bundled)) requestPlayback(bundled);
        else finish();
    }

    private void refreshCache() {
        new Thread(() -> {
            HttpURLConnection manifestConnection = null;
            try {
                manifestConnection = open(MANIFEST_URL);
                String text;
                try (InputStream input = manifestConnection.getInputStream()) { text = readText(input); }
                JSONObject manifest = new JSONObject(text);
                String version = manifest.optString("version", "");
                String videoUrl = manifest.optString("url", "");
                String expectedSha = manifest.optString("sha256", "");
                if (version.isEmpty() || videoUrl.isEmpty()) return;

                File cached = new File(activity.getFilesDir(), REMOTE_OPENING_FILE);
                SharedPreferences prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
                if (version.equals(prefs.getString("version", "")) && usable(cached)) return;

                File temp = new File(activity.getFilesDir(), REMOTE_OPENING_FILE + ".tmp");
                if (!download(videoUrl, temp) || !usable(temp)) { temp.delete(); return; }
                if (!expectedSha.isEmpty() && !expectedSha.equalsIgnoreCase(sha256(temp))) { temp.delete(); return; }
                if (cached.exists() && !cached.delete()) { temp.delete(); return; }
                if (!temp.renameTo(cached)) { temp.delete(); return; }
                prefs.edit().putString("version", version).apply();
            } catch (Exception ignored) {
            } finally {
                if (manifestConnection != null) manifestConnection.disconnect();
            }
        }, "opening-cache-refresh").start();
    }

    private HttpURLConnection open(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(3500);
        connection.setReadTimeout(8000);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/json,video/mp4,*/*");
        connection.setUseCaches(false);
        connection.connect();
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            connection.disconnect();
            throw new IOException("HTTP " + code);
        }
        return connection;
    }

    private boolean download(String address, File target) {
        HttpURLConnection connection = null;
        try {
            connection = open(address);
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                byte[] buffer = new byte[32768];
                int read;
                long total = 0L;
                while ((read = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, read);
                    total += read;
                    if (total > 25L * 1024L * 1024L) return false;
                }
            }
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String readText(InputStream input) throws IOException {
        StringBuilder value = new StringBuilder();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) >= 0) value.append(new String(buffer, 0, read, StandardCharsets.UTF_8));
        return value.toString();
    }

    private boolean usable(File file) {
        if (file == null || !file.exists() || file.length() < 100_000L) return false;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] header = new byte[12];
            if (input.read(header) < 12) return false;
            return header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p';
        } catch (IOException error) {
            return false;
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }

    private void releasePlayer() {
        MediaPlayer current = player;
        player = null;
        if (current == null) return;
        try { current.stop(); } catch (Exception ignored) {}
        try { current.reset(); } catch (Exception ignored) {}
        try { current.release(); } catch (Exception ignored) {}
    }
}

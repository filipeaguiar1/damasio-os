package ca.damasio.employee;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

public class SplashActivity extends Activity {
    private static final long SPLASH_DURATION_MS = 1200L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        View mark = findViewById(R.id.splashMark);
        View title = findViewById(R.id.splashTitle);
        View subtitle = findViewById(R.id.splashSubtitle);
        View loader = findViewById(R.id.splashLoader);

        mark.setAlpha(0f);
        mark.setScaleX(.55f);
        mark.setScaleY(.55f);
        mark.setRotation(-12f);
        mark.animate().alpha(1f).scaleX(1f).scaleY(1f).rotation(0f)
            .setDuration(700L).setInterpolator(new AccelerateDecelerateInterpolator()).start();

        title.setAlpha(0f);
        title.setTranslationY(22f);
        title.animate().alpha(1f).translationY(0f).setStartDelay(300L).setDuration(500L).start();

        subtitle.setAlpha(0f);
        subtitle.animate().alpha(1f).setStartDelay(650L).setDuration(450L).start();

        loader.setScaleX(.15f);
        loader.animate().scaleX(1f).setStartDelay(500L).setDuration(1000L).start();

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            startActivity(new Intent(this, MainActivity.class));
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
            finish();
        }, SPLASH_DURATION_MS);
    }
}

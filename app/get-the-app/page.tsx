import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Get the 4Ever Seasons App",
  description: "Download the 4Ever Seasons mobile app for the supported mobile experience.",
};

type Platform = "android" | "ios";

type PageProps = {
  searchParams?: {
    platform?: string;
  };
};

const ANDROID_FALLBACK = "/downloads/damasio-os-mobile-v52.0.1.apk";

function requestedPlatform(value?: string): Platform {
  return value === "ios" ? "ios" : "android";
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.storeIcon}>
      <path d="M16.7 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.8 0-1.9-.9-3.1-.9-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3.1 2.4 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-3.9ZM14.4 5.9c.7-.9 1.2-2.1 1.1-3.3-1.1.1-2.4.7-3.2 1.6-.7.8-1.3 2-1.2 3.2 1.2.1 2.5-.6 3.3-1.5Z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.storeIcon}>
      <path d="M7.2 8.1 5.5 5.2a.7.7 0 0 1 1.2-.7l1.8 3.1A9 9 0 0 1 12 6.9c1.2 0 2.4.2 3.5.7l1.8-3.1a.7.7 0 1 1 1.2.7l-1.7 2.9a7.5 7.5 0 0 1 3.7 5.9H3.5a7.5 7.5 0 0 1 3.7-5.9ZM8.1 11.6a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm7.8 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8ZM3.5 15.4h17v1.3a2.7 2.7 0 0 1-2.7 2.7h-.5v1.3a1.3 1.3 0 1 1-2.6 0v-1.3H9.3v1.3a1.3 1.3 0 1 1-2.6 0v-1.3h-.5a2.7 2.7 0 0 1-2.7-2.7v-1.3Z" />
    </svg>
  );
}

export default function GetTheAppPage({ searchParams }: PageProps) {
  const platform = requestedPlatform(searchParams?.platform);
  const configuredAndroidUrl = process.env.NEXT_PUBLIC_ANDROID_APP_URL?.trim();
  const configuredIosUrl = process.env.NEXT_PUBLIC_IOS_APP_URL?.trim();
  const androidUrl = configuredAndroidUrl || ANDROID_FALLBACK;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="get-app-title">
        <div className={styles.brandMark} aria-hidden="true">4</div>
        <p className={styles.eyebrow}>4Ever Seasons</p>
        <h1 id="get-app-title">Continue in the mobile app</h1>
        <p className={styles.lead}>
          The 4Ever Seasons platform is available on phones through the app for a more reliable and consistent experience.
        </p>

        <div className={styles.actions}>
          {platform === "ios" ? (
            <>
              {configuredIosUrl ? (
                <a className={styles.primaryButton} href={configuredIosUrl} rel="noreferrer">
                  <AppleIcon />
                  <span><small>Download on the</small>App Store</span>
                </a>
              ) : (
                <div className={styles.disabledButton} aria-disabled="true">
                  <AppleIcon />
                  <span><small>iPhone & iPad</small>App Store coming soon</span>
                </div>
              )}
              <a className={styles.secondaryButton} href={androidUrl} rel="noreferrer">
                <AndroidIcon />
                <span><small>Also available for</small>Android</span>
              </a>
            </>
          ) : (
            <>
              <a className={styles.primaryButton} href={androidUrl} rel="noreferrer">
                <AndroidIcon />
                <span><small>{configuredAndroidUrl ? "Get it for" : "Install for"}</small>Android</span>
              </a>
              {configuredIosUrl ? (
                <a className={styles.secondaryButton} href={configuredIosUrl} rel="noreferrer">
                  <AppleIcon />
                  <span><small>Also available on the</small>App Store</span>
                </a>
              ) : (
                <div className={styles.disabledButton} aria-disabled="true">
                  <AppleIcon />
                  <span><small>iPhone & iPad</small>App Store coming soon</span>
                </div>
              )}
            </>
          )}
        </div>

        <p className={styles.note}>
          Already installed? Open 4Ever Seasons directly from your home screen.
        </p>
      </section>
    </main>
  );
}

"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="error-shell">
          <section className="error-card">
            <p className="eyebrow">4Ever Seasons</p>
            <h1>The app needs a quick refresh.</h1>
            <p>
              A core screen failed to load. Refreshing here keeps the fallback
              controlled instead of showing a blank page.
            </p>
            <button className="btn btn-primary" onClick={reset}>
              Refresh
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}

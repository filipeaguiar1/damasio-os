"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-shell">
      <section className="error-card">
        <p className="eyebrow">System protection</p>
        <h1>Something stopped loading.</h1>
        <p>
          The page hit a temporary error. Try again, and the system will reload
          this screen without losing the whole app.
        </p>
        {error.digest ? <small>Error ID: {error.digest}</small> : null}
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}

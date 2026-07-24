import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export default function NotFoundPage() {
  return (
    <>
      <Header />
      <main className="error-shell">
        <section className="error-card">
          <p className="eyebrow">404</p>
          <h1>Page not found.</h1>
          <p>The page you opened does not exist or was moved.</p>
          <Link className="btn btn-primary" href="/">
            Back home
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}

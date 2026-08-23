import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Quote Request Received | 4Ever Seasons",
  description: "Your 4Ever Seasons property quote request has been received and is ready for review.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false, noarchive: true } },
};

export default function QuoteReceivedPage({ searchParams }: { searchParams?: { reference?: string } }) {
  const reference = typeof searchParams?.reference === "string" ? searchParams.reference : "";

  return <>
    <Header />
    <main className="public-page quote-success-page">
      <section className="public-page-hero">
        <div className="public-page-shell quote-success-hero">
          <div className="quote-success-icon" aria-hidden="true">✓</div>
          <span className="public-page-kicker">Request received</span>
          <h1>Your quote request is with our team.</h1>
          <p className="public-page-lead">We have the property details you submitted. We will review the scope and confirm the final price before service is scheduled.</p>
          {reference && <div className="quote-reference"><span>Reference</span><strong>{reference}</strong></div>}
        </div>
      </section>

      <section className="public-page-section section-white">
        <div className="public-page-shell">
          <div className="public-page-section-heading narrow"><span className="public-page-kicker">What happens next</span><h2>Three simple steps from here.</h2></div>
          <div className="process-grid">
            <article className="process-card"><span>01</span><h3>We review the property</h3><p>We check the requested service, property details, access information and any notes you included.</p></article>
            <article className="process-card"><span>02</span><h3>We confirm the scope</h3><p>If something needs clarification, we will contact you before the final quote is approved.</p></article>
            <article className="process-card"><span>03</span><h3>You receive the final quote</h3><p>The approved price is sent using the contact details from your request.</p></article>
          </div>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell public-page-split">
          <div><span className="public-page-kicker">You&apos;re all set</span><h2>No need to submit the same request again.</h2></div>
          <div><p>If you need to add an important detail, send us a message and include the reference number when available.</p><div className="public-page-cta"><Link className="btn btn-primary" href="/">Back to home</Link><Link className="btn btn-outline" href="/contact">Contact us</Link></div></div>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

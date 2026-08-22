import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Quote Request Received | 4Ever Seasons",
  description: "Your 4Ever Seasons property quote request has been received and is ready for review.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
    },
  },
};

export default function QuoteReceivedPage({
  searchParams,
}: {
  searchParams?: { reference?: string };
}) {
  const reference = typeof searchParams?.reference === "string" ? searchParams.reference : "";

  return (
    <>
      <Header />
      <main className="public-page">
        <section className="public-page-hero">
          <div className="public-page-shell" style={{ maxWidth: 980 }}>
            <div
              aria-hidden="true"
              style={{
                width: 78,
                height: 78,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(145deg, #0d5a40, #043d2e)",
                color: "white",
                fontSize: 38,
                fontWeight: 800,
                marginBottom: 24,
                boxShadow: "0 18px 38px rgba(4, 61, 46, 0.22)",
              }}
            >
              ✓
            </div>
            <span className="public-page-kicker">Request received</span>
            <h1 style={{ maxWidth: 760 }}>Thanks — your property quote is now with our team.</h1>
            <p className="public-page-lead" style={{ maxWidth: 760 }}>
              We received your request successfully. A member of the 4Ever Seasons team will review the property details and confirm the final scope before service.
            </p>

            {reference ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 18,
                  padding: "11px 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(4, 61, 46, 0.16)",
                  background: "rgba(255,255,255,0.86)",
                  boxShadow: "0 8px 22px rgba(4, 61, 46, 0.08)",
                }}
              >
                <span style={{ opacity: 0.7 }}>Reference</span>
                <strong>{reference}</strong>
              </div>
            ) : null}
          </div>
        </section>

        <section className="section-white">
          <div className="public-page-shell" style={{ maxWidth: 1100 }}>
            <div style={{ textAlign: "center", maxWidth: 700, margin: "0 auto 34px" }}>
              <span className="public-page-kicker">What happens next</span>
              <h2>Simple, clear and property-specific.</h2>
            </div>

            <div className="public-page-grid">
              <article className="public-page-panel">
                <span className="public-page-kicker">01</span>
                <h3>We review the request</h3>
                <p>We check the service, property details, access notes and the estimate information you submitted.</p>
              </article>
              <article className="public-page-panel">
                <span className="public-page-kicker">02</span>
                <h3>We confirm the scope</h3>
                <p>If anything needs clarification, our team can follow up before the final quote is approved.</p>
              </article>
              <article className="public-page-panel">
                <span className="public-page-kicker">03</span>
                <h3>You receive the final quote</h3>
                <p>Once reviewed, the final approved quote is sent using the contact information provided with your request.</p>
              </article>
            </div>
          </div>
        </section>

        <section>
          <div className="public-page-shell public-page-split" style={{ maxWidth: 1040 }}>
            <div>
              <span className="public-page-kicker">You’re all set</span>
              <h2>No need to submit the same request again.</h2>
            </div>
            <div>
              <p>
                Your request has already reached our system. If you need to add an important detail, contact us and include your reference number when available.
              </p>
              <div className="public-page-cta" style={{ marginTop: 22 }}>
                <Link className="btn btn-primary" href="/">
                  Back to home
                </Link>
                <Link className="btn btn-outline" href="/contact">
                  Contact 4Ever Seasons
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

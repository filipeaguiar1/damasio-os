import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { QuoteWizardConversion } from "@/components/home/QuoteWizardConversion";

export const metadata: Metadata = {
  title: "Request a Property Quote | 4Ever Seasons",
  description: "Request a lawn care, cleanup, garden, winter or Year Care quote from 4Ever Seasons.",
  alternates: { canonical: "/quote" },
};

export default function QuotePage() {
  return (
    <>
      <Header />
      <main className="public-home quote-route-page">
        <section className="section quote-route-section" aria-labelledby="quote-route-title">
          <div className="container quote-route-layout">
            <div className="quote-route-copy">
              <span className="section-kicker">Property quote</span>
              <h1 id="quote-route-title">Tell us about the property. We&apos;ll take it from there.</h1>
              <p className="section-intro">Choose the service, add the details that affect the work and review the request before sending it. Preliminary prices are confirmed after we review the property.</p>
            </div>
            <aside id="quote" className="hero-quote-panel" aria-label="Request a quote">
              <QuoteWizardConversion />
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

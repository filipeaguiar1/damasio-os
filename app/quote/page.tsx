import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { QuoteWizardConversion } from "@/components/home/QuoteWizardConversion";

export const metadata: Metadata = {
  title: "Request a Property Quote | 4Ever Seasons",
  description: "Request a lawn care, cleanup, garden or winter property maintenance quote from 4Ever Seasons.",
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
              <h1 id="quote-route-title">Start with the service you need.</h1>
              <p className="section-intro">Choose a service, add the property details and send the request for review.</p>
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

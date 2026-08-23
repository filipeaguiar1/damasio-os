import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact 4Ever Seasons | Property Care Support",
  description: "Contact 4Ever Seasons about quotes, property details, service questions or account support in Oakville, Burlington and Hamilton.",
};

export default function ContactPage() {
  return <>
    <Header />
    <main className="public-page">
      <section className="public-page-hero">
        <div className="public-page-shell">
          <span className="public-page-kicker">Contact</span>
          <h1>How can we help?</h1>
          <p className="public-page-lead">Send us a question about a quote, an existing service, your property or your account. Give us the useful details and we will route the message to the right place.</p>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell contact-layout">
          <aside className="contact-support-card">
            <span className="public-page-kicker">Contact details</span>
            <h2>Reach us directly.</h2>
            <div className="contact-detail-list">
              <div><small>Email</small><a href="mailto:support@4everseasons.com">support@4everseasons.com</a></div>
              <div><small>Service area</small><strong>Oakville · Burlington · Hamilton</strong></div>
              <div><small>For a faster answer</small><p>Include the property city, the service you need and whether this is about a new quote or an existing visit.</p></div>
            </div>
            <div className="contact-support-note"><strong>Looking for a price?</strong><p>The quote form is the quickest way to send the property details we need for pricing.</p><a className="btn btn-outline" href="/#quote">Start a quote</a></div>
          </aside>

          <div className="contact-form-card">
            <div className="contact-form-heading"><span className="public-page-kicker">Send a message</span><h2>Tell us what is going on.</h2><p>We will use the information below to respond to this request.</p></div>
            <ContactForm />
          </div>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

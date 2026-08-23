import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Terms of Use | 4Ever Seasons",
  description: "Terms for using the 4Ever Seasons website, quote tools, account features and related online services.",
};

const sections = [
  ["website", "Using the website"],
  ["quotes", "Quotes and estimates"],
  ["scheduling", "Scheduling and weather"],
  ["customer", "Customer responsibilities"],
  ["payments", "Payments"],
  ["accounts", "Accounts and access"],
  ["content", "Website content"],
  ["availability", "Availability and limitations"],
  ["changes", "Changes and contact"],
];

export default function TermsPage() {
  return <>
    <Header />
    <main className="public-page legal-page">
      <section className="public-page-hero">
        <div className="public-page-shell">
          <span className="public-page-kicker">Terms of Use</span>
          <h1>Terms for our website and online services.</h1>
          <p className="public-page-lead">These terms apply to the 4Ever Seasons website, quote tools and account features. An approved quote, service agreement or invoice may include additional terms that apply to a specific property or service.</p>
          <p className="legal-updated">Last updated: August 23, 2026</p>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell legal-layout">
          <aside className="legal-sidebar">
            <span className="legal-sidebar-title">On this page</span>
            <nav aria-label="Terms sections">{sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
            <div className="legal-contact-box"><strong>Questions about these terms?</strong><a href="mailto:support@4everseasons.com">support@4everseasons.com</a></div>
          </aside>

          <article className="legal-copy">
            <section id="website"><span className="legal-section-number">01</span><h2>Using the website</h2><p>You may use the 4Ever Seasons website and account areas for lawful purposes related to property-care services, quotes, scheduling, account access and support. You may not interfere with the operation or security of the site, attempt to access another person&apos;s information or misuse account features.</p></section>

            <section id="quotes"><span className="legal-section-number">02</span><h2>Quotes and estimates</h2><p>Online prices and preliminary estimates are intended to help establish the expected scope and cost of a service. Property size, access, condition, seasonal volume and other site-specific details may affect the final price. A service is not confirmed until the applicable quote or service arrangement has been approved.</p><p>For custom or premium services, a starting price may be shown before the exact scope is reviewed. The final approved price may differ based on the property and requested work.</p></section>

            <section id="scheduling"><span className="legal-section-number">03</span><h2>Scheduling and weather</h2><p>Outdoor property care depends on weather, site conditions, safe access and seasonal demand. Scheduled dates, route order or arrival windows may change when conditions make the planned work unsafe or impractical. When reasonably possible, schedule changes will be communicated through the normal service channels.</p></section>

            <section id="customer"><span className="legal-section-number">04</span><h2>Customer responsibilities</h2><p>Customers are responsible for providing accurate contact and property information, identifying known access restrictions or hazards, and making the agreed service areas reasonably accessible. Changes that may affect the work or pricing should be communicated before the scheduled visit whenever possible.</p></section>

            <section id="payments"><span className="legal-section-number">05</span><h2>Payments</h2><p>Where payment features are available, charges and invoice details should correspond to the applicable quote, service record or account statement. Payment processing may be provided by a third party and may also be subject to that provider&apos;s terms. Service-specific deposit, cancellation, credit or refund rules will be stated in the applicable quote or agreement when relevant.</p></section>

            <section id="accounts"><span className="legal-section-number">06</span><h2>Accounts and access</h2><p>You are responsible for keeping your sign-in information secure and for activity performed through your account. Contact us promptly if you believe your account or associated email access has been compromised.</p></section>

            <section id="content"><span className="legal-section-number">07</span><h2>Website content</h2><p>The 4Ever Seasons name, branding, interface and original website materials are provided for use with our services and may not be copied, presented as your own or used in a misleading way without permission. Third-party services, trademarks and materials remain subject to their respective owners&apos; rights and terms.</p></section>

            <section id="availability"><span className="legal-section-number">08</span><h2>Availability and limitations</h2><p>We work to keep the website and account features available and accurate, but online services can be affected by maintenance, provider outages, technical errors or information that has not yet been updated. The website should not be used as an emergency communication channel.</p></section>

            <section id="changes"><span className="legal-section-number">09</span><h2>Changes and contact</h2><p>We may update these terms when our website, account features or service processes change. The updated date at the top of this page will show when the terms were most recently revised.</p><p>Questions about these terms can be sent to <a href="mailto:support@4everseasons.com"><strong>support@4everseasons.com</strong></a>.</p></section>
          </article>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

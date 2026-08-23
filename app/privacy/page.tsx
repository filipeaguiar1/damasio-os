import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy | 4Ever Seasons",
  description: "How 4Ever Seasons collects, uses and protects information submitted through our website, quote forms and customer account features.",
};

const sections = [
  ["scope", "Scope"],
  ["information", "Information we collect"],
  ["use", "How we use information"],
  ["providers", "Service providers"],
  ["payments", "Payments"],
  ["cookies", "Cookies and device data"],
  ["retention", "Retention and security"],
  ["choices", "Your choices"],
  ["updates", "Updates and contact"],
];

export default function PrivacyPage() {
  return <>
    <Header />
    <main className="public-page legal-page">
      <section className="public-page-hero">
        <div className="public-page-shell">
          <span className="public-page-kicker">Privacy Policy</span>
          <h1>How we handle personal information.</h1>
          <p className="public-page-lead">This policy explains the information 4Ever Seasons may collect when you use our website, request a quote, contact us or use account features, and how that information is used to operate our services.</p>
          <p className="legal-updated">Last updated: August 23, 2026</p>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell legal-layout">
          <aside className="legal-sidebar">
            <span className="legal-sidebar-title">On this page</span>
            <nav aria-label="Privacy Policy sections">{sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
            <div className="legal-contact-box"><strong>Privacy question?</strong><a href="mailto:support@4everseasons.com">support@4everseasons.com</a></div>
          </aside>

          <article className="legal-copy">
            <section id="scope"><span className="legal-section-number">01</span><h2>Scope</h2><p>This Privacy Policy applies to personal information handled through the 4Ever Seasons public website, quote and contact forms, customer account features and communications related to our property-care services.</p></section>

            <section id="information"><span className="legal-section-number">02</span><h2>Information we collect</h2><p>The information we collect depends on how you interact with us. It may include your name, email address, phone number, service address, property details, service preferences, quote information, account details, messages, service notes, visit history and photos connected to work at your property.</p><p>We may also receive basic technical information needed to operate and secure the website, such as browser or device information, session data and records related to sign-in activity.</p></section>

            <section id="use"><span className="legal-section-number">03</span><h2>How we use information</h2><p>We use personal information to respond to inquiries, prepare and review quotes, organize property details, schedule and deliver services, maintain service history, operate customer and staff account features, provide support, process account activity and protect the reliability and security of our systems.</p></section>

            <section id="providers"><span className="legal-section-number">04</span><h2>Service providers</h2><p>We use third-party providers for functions such as website hosting, authentication, database services, email delivery, mapping and payment processing. These providers may receive the information reasonably necessary to perform those functions on our behalf and are subject to their own privacy and security obligations.</p></section>

            <section id="payments"><span className="legal-section-number">05</span><h2>Payments</h2><p>When online payment features are available, payment-card information may be processed by a payment provider rather than stored directly by 4Ever Seasons. We may keep related transaction references, invoice amounts, payment status and service records needed to manage the account.</p></section>

            <section id="cookies"><span className="legal-section-number">06</span><h2>Cookies and device data</h2><p>Our website and account areas may use essential cookies, browser storage or similar technologies to keep sessions working, remember necessary interface state and protect account access. If we add non-essential analytics or advertising technologies, this policy will be updated as appropriate.</p></section>

            <section id="retention"><span className="legal-section-number">07</span><h2>Retention and security</h2><p>We keep information for as long as reasonably necessary to provide services, manage accounts, maintain business and service records, meet legal or operational requirements and address security issues. We use reasonable administrative and technical safeguards designed to protect the information we handle. No online system can guarantee absolute security.</p></section>

            <section id="choices"><span className="legal-section-number">08</span><h2>Your choices</h2><p>You may contact us to ask about personal information associated with you, request a correction or discuss deletion where appropriate and permitted. Some information may need to be retained for legitimate service, payment, security, recordkeeping or legal reasons.</p><p>To make a privacy-related request, email <a href="mailto:support@4everseasons.com"><strong>support@4everseasons.com</strong></a> and include enough information for us to understand and verify the request.</p></section>

            <section id="updates"><span className="legal-section-number">09</span><h2>Updates and contact</h2><p>We may update this policy when our website, account features, service processes or legal requirements change. The updated date at the top of this page will show when the policy was most recently revised.</p><p>Questions about this policy or our privacy practices can be sent to <a href="mailto:support@4everseasons.com"><strong>support@4everseasons.com</strong></a>.</p></section>
          </article>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "About 4Ever Seasons | Local Property Care",
  description: "Learn how 4Ever Seasons organizes lawn care, seasonal cleanups, garden work and winter service across Oakville, Burlington and Hamilton.",
};

const principles = [
  ["Clear scope", "You should know what is included before the visit starts and what needs separate approval."],
  ["Reliable scheduling", "Routes are built around real local capacity so recurring work stays practical through the season."],
  ["Property context", "Access notes, preferences and service history stay connected to the address instead of living in scattered messages."],
];

const process = [
  ["01", "Tell us about the property", "Start with the address, service type and the details that can affect the work."],
  ["02", "We confirm the scope", "We review the property, route availability and any seasonal requirements before approving the final quote."],
  ["03", "Service stays organized", "Once scheduled, visits, notes and recurring instructions remain connected to the property."],
];

export default function AboutPage() {
  return <>
    <Header />
    <main className="public-page">
      <section className="public-page-hero">
        <div className="public-page-shell">
          <span className="public-page-kicker">About 4Ever Seasons</span>
          <h1>Local property care, organized for the whole season.</h1>
          <p className="public-page-lead">We take care of the recurring work that keeps a home looking looked after: lawn care, seasonal cleanups, garden maintenance and winter service. The goal is simple — clear work, dependable scheduling and fewer loose ends for the homeowner.</p>
          <div className="public-page-cta"><a className="btn btn-primary" href="/#quote">Request a quote</a><Link className="btn btn-outline" href="/contact">Contact us</Link></div>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell public-page-split">
          <div className="public-page-section-heading"><span className="public-page-kicker">Our approach</span><h2>Good service starts before the crew arrives.</h2><p>A tidy finish matters, but so does knowing the address, the scope and the schedule before the visit begins.</p></div>
          <div className="public-page-grid public-page-grid-single-column">{principles.map(([title, copy]) => <article className="public-page-panel" key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </div>
      </section>

      <section className="public-page-section section-white">
        <div className="public-page-shell">
          <div className="public-page-section-heading narrow"><span className="public-page-kicker">How it works</span><h2>From quote to recurring service.</h2><p>We keep the handoff simple so the information you provide at the beginning does not have to be repeated at every step.</p></div>
          <div className="process-grid">{process.map(([number, title, copy]) => <article className="process-card" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </div>
      </section>

      <section className="public-page-section">
        <div className="public-page-shell public-page-split local-service-block">
          <div><span className="public-page-kicker">Service area</span><h2>Oakville, Burlington and Hamilton.</h2></div>
          <div><p>Keeping the service area focused helps us build sensible routes and give customers realistic scheduling. If your property is nearby and you are not sure whether we cover the address, send us a message and we will confirm.</p><Link className="btn btn-primary" href="/contact">Check your address</Link></div>
        </div>
      </section>
    </main>
    <Footer />
  </>;
}

import { QuoteWizardConversion } from "./QuoteWizardConversion";

export function Hero() {
  return <section className="public-home-site-hero">
    <div className="public-hero-photo" aria-hidden="true">
      <img src="/brand/4ever-seasons-sidebar-art.jpg" alt="" />
    </div>
    <div className="public-hero-overlay" />
    <div className="container public-hero-layout">
      <div className="public-hero-copy">
        <span className="section-kicker">Oakville, Burlington, Hamilton</span>
        <h1>Property maintenance, done on schedule.</h1>
        <p className="hero-text">Local lawn care, seasonal cleanups, garden work and winter visits with clear scope, visit notes and photos after the work is done.</p>
        <div className="hero-actions">
          <a className="btn btn-primary hero-primary" href="#quote">Get your instant quote</a>
          <a className="btn btn-outline hero-customer-link" href="/auth/login">Already a customer?</a>
        </div>
        <div className="hero-proof-grid" aria-label="Service technology highlights">
          <div className="hero-proof"><span>Smart scheduling</span><strong>Neighbourhood routes</strong><small>Planned service with organized local coverage.</small></div>
          <div className="hero-proof"><span>Visit tracking</span><strong>Notes and photos</strong><small>Property history stays connected.</small></div>
          <div className="hero-proof"><span>Seasonal care</span><strong>One property calendar</strong><small>Lawn, cleanup and winter planning together.</small></div>
        </div>
      </div>
      <aside id="quote" className="hero-quote-panel" aria-label="Request a quote">
        <QuoteWizardConversion />
      </aside>
    </div>
  </section>;
}

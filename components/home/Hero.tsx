import { QuoteWizard } from "./QuoteWizard";

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
          <a className="btn btn-primary hero-primary" href="#quote">Request a property quote</a>
          <a className="btn btn-outline hero-customer-link" href="/customer">Open customer portal</a>
        </div>
        <div className="hero-proof-grid" aria-label="Service proof points">
          <div className="hero-proof"><span>Route planning</span><strong>Neighbourhood capacity</strong><small>Local schedules keep arrival windows realistic.</small></div>
          <div className="hero-proof"><span>Visit records</span><strong>Notes and photos</strong><small>Property history stays attached to the address.</small></div>
          <div className="hero-proof"><span>Seasonal work</span><strong>Lawn, cleanup and snow</strong><small>One property calendar across the year.</small></div>
        </div>
      </div>
      <aside id="quote" className="hero-quote-panel" aria-label="Request a quote">
        <QuoteWizard />
      </aside>
    </div>
  </section>;
}

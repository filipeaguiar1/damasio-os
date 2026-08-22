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
        <h1>Property care that looks scheduled, sharp and accountable.</h1>
        <p className="hero-text">4Ever Seasons maintains lawns, cleanups, gardens and winter routes for homeowners who want the property handled without chasing updates.</p>
        <div className="hero-actions">
          <a className="btn btn-primary hero-primary" href="#quote">Request a property quote</a>
          <a className="btn btn-outline hero-customer-link" href="/customer">Open customer portal</a>
        </div>
        <div className="hero-proof-grid" aria-label="Service proof points">
          <div className="hero-proof"><span>Routes</span><strong>Limited by neighbourhood</strong><small>Crews stay local so service windows are realistic.</small></div>
          <div className="hero-proof"><span>Updates</span><strong>Photos and service history</strong><small>Customer records stay attached to each property.</small></div>
          <div className="hero-proof"><span>Season</span><strong>Lawn, cleanup and snow</strong><small>One team for the full property calendar.</small></div>
        </div>
      </div>
      <aside id="quote" className="hero-quote-panel" aria-label="Request a quote">
        <QuoteWizard />
      </aside>
    </div>
  </section>;
}

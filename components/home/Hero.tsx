import { QuoteWizardConversion } from "./QuoteWizardConversion";

export function Hero() {
  return <section className="public-home-site-hero">
    <div className="public-hero-photo" aria-hidden="true">
      <img src="/brand/4ever-seasons-sidebar-art.jpg" alt="" />
    </div>
    <div className="public-hero-overlay" />
    <div className="container public-hero-layout">
      <div className="public-hero-copy">
        <span className="section-kicker">Oakville · Burlington · Hamilton</span>
        <h1>Property care that stays on schedule.</h1>
        <p className="hero-text">Lawn care, seasonal cleanups, garden work and winter service with clear quotes, organized visits and property details kept in one place.</p>
        <div className="hero-actions">
          <a className="btn btn-outline hero-customer-link" href="/login">Already a customer?</a>
        </div>
        <div className="hero-proof-grid" aria-label="Service highlights">
          <div className="hero-proof"><span>Local routing</span><strong>Neighbourhood scheduling</strong><small>Recurring work is planned around practical local routes.</small></div>
          <div className="hero-proof"><span>Visit history</span><strong>Notes and photos</strong><small>Service details stay connected to the property.</small></div>
          <div className="hero-proof"><span>Four seasons</span><strong>One property plan</strong><small>Lawn, cleanup, garden and winter work stay organized together.</small></div>
        </div>
      </div>
      <aside id="quote" className="hero-quote-panel" aria-label="Request a quote">
        <QuoteWizardConversion />
      </aside>
    </div>
  </section>;
}

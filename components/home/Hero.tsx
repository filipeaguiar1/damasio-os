import { QuoteWizard } from "./QuoteWizard";

export function Hero() {
  return <section className="hero public-hero">
    <div className="container hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">Hamilton • Burlington • Oakville</span>
        <div className="season-orbit" aria-hidden="true">
          <span className="season-token season-spring">✦</span>
          <span className="season-token season-summer">☀</span>
          <span className="season-token season-fall">🍁</span>
          <span className="season-token season-winter">❄</span>
        </div>
        <h1>Four seasons. One simple way to care for your property.</h1>
        <p className="hero-text">Fast estimates, dependable service and a clear customer experience from <strong>4 Ever Seasons</strong> — from the first quote to the finished job.</p>
        <div className="hero-actions">
          <a className="btn btn-primary hero-primary" href="#quote">Get Instant Quote</a>
          <a className="btn btn-outline hero-customer-link" href="/customer">Customer Portal</a>
        </div>
        <div className="hero-proof-grid">
          <div className="hero-proof"><span>01</span><strong>Quick estimate</strong><small>Simple guided questions</small></div>
          <div className="hero-proof"><span>02</span><strong>Clear service</strong><small>Updates in one place</small></div>
          <div className="hero-proof"><span>03</span><strong>Easy payments</strong><small>Online invoice experience</small></div>
        </div>
      </div>
      <div id="quote" className="hero-quote-shell"><QuoteWizard /></div>
    </div>
  </section>;
}

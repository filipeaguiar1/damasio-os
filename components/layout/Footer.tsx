import Link from "next/link";

export function Footer() {
  return <footer className="footer">
    <div className="container footer-grid">
      <div className="footer-brand-copy">
        <h3>4Ever Seasons</h3>
        <p>Lawn care, seasonal cleanups, garden maintenance and winter service for homes in Oakville, Burlington and Hamilton.</p>
        <a className="footer-support" href="mailto:support@4everseasons.com">support@4everseasons.com</a>
      </div>
      <div>
        <h4>Services</h4>
        <Link href="/services/lawn-care">Lawn Care</Link>
        <Link href="/services/seasonal-cleanups">Seasonal Cleanups</Link>
        <Link href="/services/garden-care">Garden &amp; Bed Care</Link>
        <Link href="/services/snow-removal">Snow Removal</Link>
        <a href="/#plans">Year Care</a>
      </div>
      <div>
        <h4>Service Areas</h4>
        <div className="footer-area-list"><span><Link href="/service-areas/oakville">Oakville</Link></span><span><Link href="/service-areas/burlington">Burlington</Link></span><span><Link href="/service-areas/hamilton">Hamilton</Link></span></div>
      </div>
      <div>
        <h4>Company</h4>
        <Link href="/about">About</Link>
        <Link href="/quote">Get a Quote</Link>
        <Link href="/customer">Customer Portal</Link>
        <Link href="/contact">Contact</Link>
      </div>
      <div>
        <h4>Legal</h4>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms of Use</Link>
      </div>
    </div>
    <div className="footer-bottom">
      <span>© 2026 4Ever Seasons. All rights reserved.</span>
      <div className="footer-bottom-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
    </div>
  </footer>;
}

import Link from "next/link";

export function Footer(){
  return <footer className="footer">
    <div className="container footer-grid">
      <div className="footer-brand-copy">
        <h3>4Ever Seasons</h3>
        <p>Reliable property care for homes in Oakville, Burlington and Hamilton, with clear service details and simple customer access.</p>
        <a className="footer-support" href="mailto:support@4everseasons.com">support@4everseasons.com</a>
      </div>
      <div>
        <h4>Services</h4>
        <a href="/#services">Lawn Care</a>
        <a href="/#services">Seasonal Cleanups</a>
        <a href="/#services">Garden &amp; Bed Care</a>
        <a href="/#services">Snow Removal</a>
        <a href="/#services">Mulch &amp; Property Maintenance</a>
      </div>
      <div>
        <h4>Service Areas</h4>
        <div className="footer-area-list"><span>Oakville</span><span>Burlington</span><span>Hamilton</span></div>
      </div>
      <div>
        <h4>Company</h4>
        <Link href="/about">About</Link>
        <a href="/#quote">Get a Quote</a>
        <Link href="/customer">Customer Portal</Link>
        <Link href="/contact">Contact</Link>
      </div>
      <div>
        <h4>Legal</h4>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/terms">Terms</Link>
      </div>
    </div>
    <div className="footer-bottom">
      <span>© 2026 4Ever Seasons. All rights reserved.</span>
      <div className="footer-bottom-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
    </div>
  </footer>
}

import Link from "next/link";

export function Header() {
  return (
    <header className="header">
      <div className="container header-inner">
        <Link className="brand" href="/">
          <img
            src="/brand/4ever-seasons-logo-mark.jpg"
            alt="4 Ever Seasons"
            className="brand-logo brand-logo-new brand-logo-mark"
            width="52"
            height="52"
            decoding="async"
          />
          <span className="brand-copy">
            <strong>Jorge Cabeça de Bilola</strong>
            <small>Property Maintenance</small>
          </span>
        </Link>
        <nav className="nav" aria-label="Main navigation">
          <a href="/#services">Services</a>
          <a href="/#plans">Plans</a>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <Link className="btn btn-primary header-login" href="/login">
          <span className="header-login-desktop">Sign in</span>
          <span className="header-login-mobile">Sign in</span>
        </Link>
      </div>
    </header>
  );
}

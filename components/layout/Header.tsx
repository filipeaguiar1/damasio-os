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
            <strong>4 Ever Seasons</strong>
            <small>Property Maintenance</small>
          </span>
        </Link>
        <nav className="nav">
          <a href="/#services">Services</a>
          <a href="/#plans">Plans</a>
          <Link href="/customer">Customer</Link>
          <Link href="/employee">Employee</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/login">Login</Link>
        </nav>
        <Link className="btn btn-primary header-login" href="/login">
          <span className="header-login-desktop">Open 4 Ever Seasons</span>
          <span className="header-login-mobile">Sign in</span>
        </Link>
      </div>
    </header>
  );
}

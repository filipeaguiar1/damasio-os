import Link from "next/link";

export function Header() {
  return (
    <header className="header">
      <div className="container header-inner">
        <Link className="brand" href="/">
  <img src="/logo.png" alt="Damasio Seasons" className="brand-logo" />

  <div className="brand-text">
    <div className="brand-title">Damasio Seasons</div>
    <div className="brand-sub">Property Maintenance</div>
  </div>
</Link>

        <nav className="nav">
          <a href="/#services">Services</a>
          <a href="/#plans">Plans</a>
          <a href="/#extra">Extra Services</a>
          <Link href="/admin">Admin</Link>
        </nav>

        <a className="btn btn-primary" href="/#quote">
          Get Quote
        </a>
      </div>
    </header>
  );
}
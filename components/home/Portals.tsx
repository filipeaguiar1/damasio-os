export function Portals() {
  return <section className="section public-portals">
    <div className="container">
      <div className="section-top"><div><span className="section-kicker">Stay connected</span><h2>Your service, in one place</h2><p className="section-intro">Customers and field teams each have a focused area built around the work that matters to them.</p></div></div>
      <div className="grid-2">
        <div className="card portal-card customer-portal-card">
          <span className="portal-icon" aria-hidden="true">⌂</span>
          <h3>Customer Portal</h3>
          <p>See services, invoices, extra requests and profile information without hunting through messages.</p>
          <a className="btn portal-cta" href="/customer">Open Customer Portal <span aria-hidden="true">→</span></a>
        </div>
        <div className="card portal-card employee-portal-card">
          <span className="portal-icon" aria-hidden="true">↗</span>
          <h3>Employee Portal</h3>
          <p>Today’s jobs, route order, photo uploads, time tracking and field information.</p>
          <a className="btn btn-primary" href="/employee">Open Employee Portal</a>
        </div>
      </div>
    </div>
  </section>;
}

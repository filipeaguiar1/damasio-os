export function Portals() {
  return <section className="section public-portals" aria-labelledby="portal-title">
    <div className="container portal-split">
      <div>
        <span className="section-kicker">After booking</span>
        <h2 id="portal-title">The software stays behind the service.</h2>
        <p className="section-intro">The customer portal is a trust feature, not the headline. It supports invoices, requests and property history after the homeowner already believes in the crew.</p>
      </div>
      <div className="portal-proof">
        <article><span>Customer</span><strong>Invoices, requests and service history in one place.</strong><a href="/customer">Open portal</a></article>
        <article><span>Field crew</span><strong>Route order, property notes, photos and visit timing.</strong><a href="/employee">Open field app</a></article>
      </div>
    </div>
  </section>;
}

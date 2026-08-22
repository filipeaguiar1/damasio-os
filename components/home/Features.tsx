const features = [
  ["⚡", "Fast estimates", "Build a clear service estimate in just a few guided steps."],
  ["👤", "Customer portal", "Keep services, invoices, requests and account details together."],
  ["📍", "Clear service updates", "Know what is scheduled and keep your property information organized."],
  ["📷", "Photo-ready service", "Field proof and service history stay connected to the job."],
  ["🧾", "Simple billing", "Straightforward invoices and secure online payment options."],
  ["🌿", "Year-round care", "Lawn, cleanup, snow and extra property services in one experience."],
];

export function Features() {
  return <section className="section section-white public-features">
    <div className="container">
      <div className="section-top">
        <div><span className="section-kicker">Property care, organized</span><h2>4Ever Seasons</h2><p className="section-intro">A cleaner way to request, manage and follow your property services throughout the year.</p></div>
      </div>
      <div className="grid-3">{features.map(([icon, title, copy], index) => <div className="card feature-card polished-feature" key={title}><span className="feature-index">0{index + 1}</span><div className="icon">{icon}</div><h3>{title}</h3><p>{copy}</p></div>)}</div>
    </div>
  </section>;
}

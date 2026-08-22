const plans = [
  ["Routine", "Weekly or biweekly lawn route", "Best for homeowners who want clean weekly curb appeal without extra coordination.", "Lawn cuts", "Basic trimming", "Online invoices"],
  ["Seasonal", "Lawn plus cleanup planning", "The practical choice for properties that need spring and fall attention on top of lawn care.", "Route priority", "Cleanup reminders", "Service history"],
  ["Estate", "Custom year-round property care", "For larger properties, winter coverage, garden work and recurring special instructions.", "Custom scope", "Winter options", "Property notes"],
];

export function Membership() {
  return <section id="plans" className="section section-white public-membership" aria-labelledby="plans-title">
    <div className="container">
      <div className="membership-head">
        <span className="section-kicker">Maintenance plans</span>
        <h2 id="plans-title">Choose the route level, then confirm the exact scope.</h2>
        <p className="section-intro">Recurring service depends on area, property size and seasonal capacity. Start with the route level, then the team confirms the exact scope.</p>
      </div>
      <div className="membership-grid">
        {plans.map(([name, title, copy, a, b, c], index) => <article className={index === 1 ? "plan-card plan-card-featured" : "plan-card"} key={name}>
          {index === 1 && <span className="plan-badge">Priority route</span>}
          <small>{name}</small>
          <h3>{title}</h3>
          <p>{copy}</p>
          <div className="plan-list"><span>{a}</span><span>{b}</span><span>{c}</span></div>
          <a className={index === 1 ? "btn btn-primary" : "btn btn-outline"} href="#quote">Check availability</a>
        </article>)}
      </div>
    </div>
  </section>;
}

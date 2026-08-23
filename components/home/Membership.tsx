const plans = [
  {
    name: "Routine",
    title: "Weekly or biweekly lawn care",
    copy: "A straightforward recurring lawn route for homeowners who want the property kept tidy without having to rebook every visit.",
    features: ["Recurring lawn cuts", "Trimming and tidy finish", "Online service history"],
  },
  {
    name: "Seasonal",
    title: "Lawn care plus seasonal work",
    copy: "For properties that need regular lawn care with spring and fall cleanup planning built into the year.",
    features: ["Priority route planning", "Seasonal cleanup reminders", "Connected service history"],
  },
  {
    name: "Year Care",
    title: "Year-round property care",
    copy: "One plan for lawn care, seasonal cleanups, garden work and winter service, tailored to the property after review.",
    features: ["All-season planning", "Priority service and routing", "Property-specific notes"],
  },
];

function planClass(index: number) {
  if (index === 1) return "plan-card plan-card-featured";
  if (index === 2) return "plan-card plan-card-year";
  return "plan-card";
}

export function Membership() {
  return <section id="plans" className="section section-white public-membership" aria-labelledby="plans-title">
    <div className="container">
      <div className="membership-head">
        <span className="section-kicker">Maintenance plans</span>
        <h2 id="plans-title">Choose the level of care that fits your property.</h2>
        <p className="section-intro">Start with the service level. We confirm the property size, scope and route availability before the final price is approved.</p>
      </div>
      <div className="membership-grid">
        {plans.map((plan, index) => <article className={planClass(index)} key={plan.name}>
          {index === 1 && <span className="plan-badge">Priority route</span>}
          {index === 2 && <span className="plan-badge">Premium</span>}
          <small>{plan.name}</small>
          <h3>{plan.title}</h3>
          {index === 2 && <div className="plan-price"><strong>From $249</strong><span>/ month</span></div>}
          <p>{plan.copy}</p>
          <div className="plan-list">{plan.features.map(feature => <span key={feature}>{feature}</span>)}</div>
          {index === 2 && <p className="premium-note">* Premium service receives priority scheduling and route planning.</p>}
          <a className={index === 1 ? "btn btn-primary" : "btn btn-outline"} href={index === 2 ? "#quote?service=year_care" : "#quote"}>{index === 2 ? "Build my Year Care plan" : "Check availability"}</a>
        </article>)}
      </div>
    </div>
  </section>;
}

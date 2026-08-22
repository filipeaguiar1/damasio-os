const services = [
  ["Lawn routes", "Weekly, biweekly and one-time cuts", "Edging, trimming, cleanup pass and visit visibility.", "weekly_lawn"],
  ["Spring reset", "Opening work after winter", "Debris, beds, edging and property readiness.", "spring_cleanup"],
  ["Fall cleanup", "Leaf and pre-winter prep", "Leaf removal, garden cutback and disposal options.", "fall_cleanup"],
  ["Snow coverage", "Winter route planning", "Driveways, walks, salting options and seasonal terms.", "snow_removal"],
  ["Garden care", "Seasonal bed maintenance", "Mulch, planting support and tidy refreshes.", "extra_service"],
  ["Custom work", "Reviewed before approval", "Stone, soil, hedge trimming and property-specific requests.", "extra_service"],
];

export function Services() {
  return <section id="services" className="section public-services" aria-labelledby="services-title">
    <div className="container">
      <div className="service-scope-layout">
        <div className="service-scope-intro">
          <span className="section-kicker">Season by season</span>
          <h2 id="services-title">Maintenance with a clear scope.</h2>
          <p className="section-intro">Each quote starts with the property, the season and the work area. The team can confirm access, disposal, salting or special notes before the final approved price is sent.</p>
          <a className="btn btn-primary" href="#quote">Request a property quote</a>
        </div>
        <div className="service-list">{services.map(([title, meta, copy, service], index) => <article className="service-row" key={title}>
          <b>{String(index + 1).padStart(2, "01")}</b>
          <div>
            <span>{meta}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </div>
          <a href={`#quote?service=${service}`} aria-label={`Request ${title}`}>Request</a>
        </article>)}</div>
      </div>
    </div>
  </section>;
}

const services = [
  ["Lawn routes", "Weekly, biweekly and one-time cuts with edging, trimming and route visibility."],
  ["Spring reset", "Debris, beds, edging and opening work after winter."],
  ["Fall cleanup", "Leaf removal, garden cutback and pre-winter property prep."],
  ["Snow coverage", "Driveways, walks, salting options and seasonal route planning."],
  ["Garden care", "Mulch, bed maintenance, planting support and tidy seasonal refreshes."],
  ["Custom work", "Stone, soil, hedge trimming and property-specific requests quoted after review."],
];

export function Services() {
  return <section id="services" className="section public-services" aria-labelledby="services-title">
    <div className="container">
      <div className="section-top"><div><span className="section-kicker">Season by season</span><h2 id="services-title">Maintenance with a clear scope.</h2><p className="section-intro">Each service is scoped around the property, the route and the season so expectations stay clear from quote to completion.</p></div></div>
      <div className="service-list">{services.map(([title, copy], index) => <article className="service-row" key={title}><b>{String(index + 1).padStart(2, "0")}</b><div><h3>{title}</h3><p>{copy}</p></div><a href="#quote">Request</a></article>)}</div>
    </div>
  </section>;
}

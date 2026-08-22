const services = [
  ["lawn", "🌱", "Lawn Care", "Weekly, biweekly and one-time cuts."],
  ["spring", "✨", "Spring Cleanup", "Fresh-start cleanup for the new season."],
  ["fall", "🍁", "Fall Cleanup", "Leaves, debris and winter preparation."],
  ["snow", "❄️", "Snow Removal", "Reliable winter clearing options."],
  ["beds", "🪴", "Mulch & Beds", "Request a custom property quote."],
  ["stone", "🪨", "Stone & Rock", "Request a custom property quote."],
];

export function Services() {
  return <section id="services" className="section public-services">
    <div className="container">
      <div className="section-top"><div><span className="section-kicker">Season by season</span><h2>Services</h2><p className="section-intro">Practical property care with a simple quote and service experience.</p></div></div>
      <div className="grid-3">{services.map(([kind, icon, title, copy]) => <div className={`card service-card seasonal-service service-${kind}`} key={title}><div className="service-icon" aria-hidden="true"><span className="service-glyph">{icon}</span></div><h3>{title}</h3><p>{copy}</p><span className="service-accent" aria-hidden="true" /></div>)}</div>
    </div>
  </section>;
}

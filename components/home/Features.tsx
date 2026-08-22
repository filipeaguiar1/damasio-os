const features = [
  ["Route discipline", "Crews are grouped by neighbourhood so weekly maintenance does not turn into a guessing game."],
  ["Photo-backed visits", "The service record can include property photos, notes and visit history instead of loose messages."],
  ["Seasonal planning", "Lawn care, spring cleanup, fall cleanup and snow coverage are treated as one property calendar."],
];

export function Features() {
  return <section className="section section-white public-features" aria-labelledby="care-standard-title">
    <div className="container">
      <div className="section-top">
        <div><span className="section-kicker">The care standard</span><h2 id="care-standard-title">Built around reliable property routines.</h2><p className="section-intro">Every visit should feel planned before the truck arrives: the right crew, the right property notes and a clean record of what was completed.</p></div>
      </div>
      <div className="care-standard-grid">
        <article className="care-standard-lead">
          <span>Roster status</span>
          <strong>Spring and weekly lawn routes are planned by area.</strong>
          <p>Service areas, seasonal windows and route capacity stay clear so homeowners know what can be handled and when.</p>
        </article>
        {features.map(([title, copy], index) => <article className="care-standard-item" key={title}><b>{String(index + 1).padStart(2, "0")}</b><h3>{title}</h3><p>{copy}</p></article>)}
      </div>
    </div>
  </section>;
}

"use client";

import type { MouseEvent } from "react";
import type { ServiceKey } from "@/lib/pricing";

const services: { title: string; meta: string; copy: string; service: ServiceKey }[] = [
  { title: "Lawn routes", meta: "Weekly, biweekly and one-time cuts", copy: "Edging, trimming, cleanup pass and visit visibility.", service: "weekly_lawn" },
  { title: "Spring reset", meta: "Opening work after winter", copy: "Debris, beds, edging and property readiness.", service: "spring_cleanup" },
  { title: "Fall cleanup", meta: "Leaf and pre-winter prep", copy: "Leaf removal, garden cutback and disposal options.", service: "fall_cleanup" },
  { title: "Snow coverage", meta: "Winter route planning", copy: "Driveways, walks, salting options and seasonal terms.", service: "snow_removal" },
  { title: "Garden care", meta: "Seasonal bed maintenance", copy: "Mulch, planting support and tidy refreshes.", service: "extra_service" },
  { title: "Custom work", meta: "Reviewed before approval", copy: "Stone, soil, hedge trimming and property-specific requests.", service: "extra_service" },
];

export function Services() {
  function requestService(event: MouseEvent<HTMLAnchorElement>, service: ServiceKey) {
    if (window.location.pathname !== "/") return;
    event.preventDefault();

    const nextHash = `#quote?service=${service}`;
    if (window.location.hash !== nextHash) window.history.pushState(null, "", nextHash);
    window.dispatchEvent(new Event("damasio:quote-service-change"));
  }

  return <section id="services" className="section public-services" aria-labelledby="services-title">
    <div className="container">
      <div className="service-scope-layout">
        <div className="service-scope-intro">
          <span className="section-kicker">Season by season</span>
          <h2 id="services-title">Maintenance with a clear scope.</h2>
          <p className="section-intro">Each quote starts with the property, the season and the work area. The team can confirm access, disposal, salting or special notes before the final approved price is sent.</p>
          <a className="btn btn-primary" href="#quote">Request a property quote</a>
        </div>
        <div className="service-list">{services.map(({ title, meta, copy, service }, index) => <article className="service-row" key={title}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <div>
            <span>{meta}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </div>
          <a href={`/#quote?service=${service}`} onClick={event => requestService(event, service)} aria-label={`Request ${title}`}>Request</a>
        </article>)}</div>
      </div>
    </div>
  </section>;
}

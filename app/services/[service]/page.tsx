import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { cityLandings, serviceLandings, serviceSlugs } from "@/lib/seo/landingPages";
import { getSiteUrl } from "@/lib/seo/siteUrl";

export function generateStaticParams() {
  return serviceSlugs.map((service) => ({ service }));
}

export function generateMetadata({ params }: { params: { service: string } }): Metadata {
  const service = serviceLandings[params.service];
  if (!service) return {};
  const path = `/services/${service.slug}`;
  return {
    title: service.title,
    description: service.description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title: service.title, description: service.description },
  };
}

export default function ServiceLandingPage({ params }: { params: { service: string } }) {
  const service = serviceLandings[params.service];
  if (!service) notFound();

  const url = `${getSiteUrl()}/services/${service.slug}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.name,
    serviceType: service.name,
    url,
    provider: { "@type": "HomeAndConstructionBusiness", name: "4Ever Seasons", url: getSiteUrl() },
    areaServed: Object.values(cityLandings).map((city) => ({ "@type": "City", name: city.name, containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } })),
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <Header />
    <main className="public-page">
      <section className="public-page-hero"><div className="public-page-shell">
        <span className="public-page-kicker">{service.name}</span>
        <h1>{service.name} for homes in Hamilton, Burlington and Oakville.</h1>
        <p className="public-page-lead">{service.intro}</p>
        <div className="public-page-cta"><a className="btn btn-primary" href="/#quote">Request a quote</a><Link className="btn btn-outline" href="/contact">Ask a question</Link></div>
      </div></section>

      <section className="public-page-section"><div className="public-page-shell public-page-split">
        <div className="public-page-section-heading"><span className="public-page-kicker">What&apos;s included</span><h2>A clear scope before the visit.</h2><p>We confirm what is part of the service so there are fewer surprises on service day.</p></div>
        <ul className="public-page-list">{service.scope.map((item) => <li key={item}><strong>{item}</strong></li>)}</ul>
      </div></section>

      <section className="public-page-section section-white"><div className="public-page-shell public-page-split">
        <div className="public-page-section-heading"><span className="public-page-kicker">Before we schedule</span><h2>Quoted for the actual property.</h2></div>
        <div>{service.details.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </div></section>

      <section className="public-page-section"><div className="public-page-shell">
        <div className="public-page-section-heading narrow"><span className="public-page-kicker">Service areas</span><h2>Local coverage across three communities.</h2></div>
        <div className="public-page-grid">
          {Object.values(cityLandings).map((city) => <article className="public-page-panel" key={city.slug}>
            <h3>{service.name} in {city.name}</h3><p>{city.intro}</p><Link href={`/service-areas/${city.slug}`}>View {city.name} service area</Link>
          </article>)}
        </div>
      </div></section>

      <section className="public-page-section section-white"><div className="public-page-shell public-page-split">
        <div><span className="public-page-kicker">Property-specific quote</span><h2>The address helps us price the work properly.</h2></div>
        <div><p>Property size, access, current conditions and special instructions can change the amount of work required. The online form gives us the details we need to review the scope before approving the final price.</p><p>For recurring service, we also confirm route availability so the schedule is realistic from the start.</p><a className="btn btn-primary" href="/#quote">Start a property quote</a></div>
      </div></section>
    </main>
    <Footer />
  </>;
}

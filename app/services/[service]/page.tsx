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
    openGraph: {
      type: "website",
      url: path,
      title: service.title,
      description: service.description,
    },
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
    provider: {
      "@type": "HomeAndConstructionBusiness",
      name: "4Ever Seasons",
      url: getSiteUrl(),
    },
    areaServed: Object.values(cityLandings).map((city) => ({
      "@type": "City",
      name: city.name,
      containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" },
    })),
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <Header />
    <main className="public-page">
      <section className="public-page-hero"><div className="public-page-shell">
        <span className="public-page-kicker">4Ever Seasons · {service.name}</span>
        <h1>{service.name} in Hamilton, Burlington and Oakville.</h1>
        <p className="public-page-lead">{service.intro}</p>
        <div className="public-page-cta"><a className="btn btn-primary" href="/#quote">Request a quote</a><Link className="btn btn-outline" href="/contact">Ask a question</Link></div>
      </div></section>

      <section><div className="public-page-shell public-page-split">
        <div><span className="public-page-kicker">Service scope</span><h2>Clear work before the visit starts.</h2></div>
        <ul className="public-page-list">{service.scope.map((item) => <li key={item}><strong>{item}</strong></li>)}</ul>
      </div></section>

      <section className="section-white"><div className="public-page-shell">
        <span className="public-page-kicker">Service areas</span>
        <div className="public-page-grid">
          {Object.values(cityLandings).map((city) => <article className="public-page-panel" key={city.slug}>
            <h3>{service.name} in {city.name}</h3><p>{city.intro}</p><Link href={`/service-areas/${city.slug}`}>View {city.name} service area</Link>
          </article>)}
        </div>
      </div></section>

      <section><div className="public-page-shell public-page-split">
        <div><span className="public-page-kicker">Property-specific quoting</span><h2>The address determines the final scope.</h2></div>
        <div><p>Property size, access, seasonal conditions and special instructions can affect the work required. The online request starts the quote; the final approved scope is confirmed before service.</p><p>Recurring work is then organized around local route capacity so the schedule remains practical.</p></div>
      </div></section>
    </main>
    <Footer />
  </>;
}

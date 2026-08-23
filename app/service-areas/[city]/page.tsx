import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { cityLandings, citySlugs, serviceLandings } from "@/lib/seo/landingPages";
import { getSiteUrl } from "@/lib/seo/siteUrl";

export function generateStaticParams() {
  return citySlugs.map((city) => ({ city }));
}

export function generateMetadata({ params }: { params: { city: string } }): Metadata {
  const city = cityLandings[params.city];
  if (!city) return {};
  const path = `/service-areas/${city.slug}`;
  return {
    title: city.title,
    description: city.description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title: city.title, description: city.description },
  };
}

export default function CityServiceAreaPage({ params }: { params: { city: string } }) {
  const city = cityLandings[params.city];
  if (!city) notFound();

  const url = `${getSiteUrl()}/service-areas/${city.slug}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Property Maintenance in ${city.name}, Ontario`,
    serviceType: "Property maintenance",
    url,
    provider: { "@type": "HomeAndConstructionBusiness", name: "4Ever Seasons", url: getSiteUrl() },
    areaServed: { "@type": "City", name: city.name, containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <Header />
    <main className="public-page">
      <section className="public-page-hero"><div className="public-page-shell">
        <span className="public-page-kicker">Serving {city.name}</span>
        <h1>Property maintenance in {city.name}, Ontario.</h1>
        <p className="public-page-lead">{city.intro}</p>
        <div className="public-page-cta"><a className="btn btn-primary" href="/#quote">Request a property quote</a><Link className="btn btn-outline" href="/contact">Contact us</Link></div>
      </div></section>

      <section className="public-page-section"><div className="public-page-shell public-page-split">
        <div className="public-page-section-heading"><span className="public-page-kicker">Local scheduling</span><h2>Routes built around the neighbourhood.</h2><p>Keeping work grouped locally helps recurring visits stay practical and predictable.</p></div>
        <div><p>{city.localCopy}</p><p>Availability depends on the service, the property details and route capacity at the time of the request.</p></div>
      </div></section>

      <section className="public-page-section section-white"><div className="public-page-shell">
        <div className="public-page-section-heading narrow"><span className="public-page-kicker">Services in {city.name}</span><h2>Property care through the changing seasons.</h2></div>
        <div className="public-page-grid">
          {Object.values(serviceLandings).map((service) => <article className="public-page-panel" key={service.slug}>
            <h3>{service.name}</h3><p>{service.intro}</p><Link href={`/services/${service.slug}`}>View service details</Link>
          </article>)}
        </div>
      </div></section>

      <section className="public-page-section"><div className="public-page-shell public-page-split">
        <div><span className="public-page-kicker">How it works</span><h2>Start with the address and the work you need.</h2></div>
        <ul className="public-page-list">
          <li><strong>1. Send the property details.</strong><br />Choose the service and provide the address.</li>
          <li><strong>2. We review the scope.</strong><br />Property size, access and seasonal conditions can affect the final price.</li>
          <li><strong>3. We confirm the schedule.</strong><br />Recurring work is added to a route only when the timing and local capacity make sense.</li>
          <li><strong>4. The property history stays connected.</strong><br />Visit notes and recurring instructions remain attached to the address.</li>
        </ul>
      </div></section>
    </main>
    <Footer />
  </>;
}

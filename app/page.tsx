import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { Features } from "@/components/home/Features";
import { Services } from "@/components/home/Services";
import { Membership } from "@/components/home/Membership";
import { Portals } from "@/components/home/Portals";
import { FAQ } from "@/components/home/FAQ";
import { AuthLinkRouter } from "@/components/auth/AuthLinkRouter";
import { getSiteUrl } from "@/lib/seo/siteUrl";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: "Lawn Care & Property Maintenance | 4Ever Seasons",
  description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Hamilton, Burlington and Oakville, Ontario. Request a property quote online.",
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "4Ever Seasons | Lawn Care & Property Maintenance",
    description: "Reliable four-season property maintenance across Hamilton, Burlington and Oakville, Ontario.",
  },
};

const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  name: "4Ever Seasons",
  url: siteUrl,
  email: "support@4everseasons.com",
  description: "Four-season property maintenance including lawn care, seasonal cleanups, garden maintenance and winter service.",
  areaServed: [
    { "@type": "City", name: "Hamilton", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
    { "@type": "City", name: "Burlington", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
    { "@type": "City", name: "Oakville", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
  ],
  knowsAbout: ["Lawn care", "Property maintenance", "Seasonal cleanup", "Garden maintenance", "Winter property service"],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema).replace(/</g, "\\u003c") }}
      />
      <AuthLinkRouter />
      <Header />
      <main className="public-home">
        <Hero />
        <Features />
        <Services />
        <Membership />
        <Portals />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

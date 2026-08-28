import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/home/Hero";
import { Features } from "@/components/home/Features";
import { Services } from "@/components/home/Services";
import { Membership } from "@/components/home/Membership";
import { Portals } from "@/components/home/Portals";
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

const mobileHomeCss = String.raw`
@media (max-width:700px){
  .public-home-site-hero{min-height:auto!important;align-items:start!important}
  .public-home-site-hero .public-hero-photo img{object-position:center 46%!important}
  .public-home-site-hero .public-hero-overlay{background:linear-gradient(180deg,rgba(5,20,15,.86) 0%,rgba(5,20,15,.72) 38%,rgba(5,20,15,.9) 100%)!important}
  .public-home .public-hero-layout{display:flex!important;flex-direction:column!important;gap:18px!important;padding:30px 0 24px!important}
  .public-home .public-hero-copy{order:1;max-width:none!important}
  .public-home .public-hero-copy .section-kicker{margin-bottom:8px!important;font-size:10px!important;letter-spacing:.1em!important}
  .public-home .public-hero-copy h1{max-width:340px!important;font-size:clamp(34px,10vw,44px)!important;line-height:1!important}
  .public-home .public-hero-copy .hero-text{max-width:355px!important;margin-top:13px!important;font-size:15px!important;line-height:1.48!important}

  /* On phones the quote is the first action. Portal and proof content move out of the decision path. */
  .public-home .hero-actions,.public-home .hero-proof-grid{display:none!important}
  .public-home .hero-quote-panel{order:2;width:100%!important;margin:0!important;position:relative;padding-bottom:44px}
  .public-home .quote-card{padding:18px!important;border-radius:18px!important;box-shadow:0 16px 38px rgba(0,0,0,.2)!important}
  .public-home .quote-head h2{font-size:23px!important}
  .public-home .quote-card :where(.stack){gap:12px!important}

  /* Lightweight technology proof, without another section to read. */
  .public-home .hero-quote-panel:after{content:"Smart scheduling   •   Visit notes & photos   •   Season-ready service   •   Clear property history";position:absolute;left:0;right:0;bottom:0;height:34px;line-height:34px;overflow:hidden;white-space:nowrap;text-indent:100%;border:1px solid rgba(221,240,228,.22);border-radius:999px;background:rgba(8,31,22,.74);color:#e8f4ec;font-size:11px;font-weight:800;box-shadow:0 10px 26px rgba(0,0,0,.14);backdrop-filter:blur(10px);animation:mobileTrustScroll 18s linear infinite}

  /* The long operational explanation repeats what the moving strip already communicates. */
  .public-home .public-features{display:none!important}

  /* Services become a fast scan rather than six paragraphs. */
  .public-home .public-services{padding-top:34px!important;padding-bottom:34px!important}
  .public-home .service-scope-layout{gap:16px!important}
  .public-home .service-scope-intro{position:static!important}
  .public-home .service-scope-intro .section-intro,.public-home .service-scope-intro .btn{display:none!important}
  .public-home .service-scope-intro h2{margin-bottom:2px!important;font-size:30px!important}
  .public-home .service-row{grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important;padding:13px 0!important}
  .public-home .service-row>b,.public-home .service-row span,.public-home .service-row p{display:none!important}
  .public-home .service-row h3{margin:0!important;font-size:18px!important}
  .public-home .service-row>a{padding:8px 10px!important;font-size:11px!important}

  /* Maintenance plans stay available, but read like choices instead of a wall of copy. */
  .public-home .public-membership{padding-top:34px!important;padding-bottom:34px!important}
  .public-home .membership-head{margin-bottom:16px!important}
  .public-home .membership-head .section-intro{display:none!important}
  .public-home .membership-grid{display:flex!important;gap:12px!important;overflow-x:auto!important;scroll-snap-type:x mandatory;padding-bottom:5px}
  .public-home .membership-grid .plan-card{flex:0 0 min(82vw,310px)!important;min-height:0!important;scroll-snap-align:start;padding:18px!important}
  .public-home .plan-card p{display:none!important}
  .public-home .plan-card h3{font-size:22px!important}

  /* Customer software is secondary and remains available lower on the page. */
  .public-home .public-portals{padding-top:28px!important;padding-bottom:30px!important}
  .public-home .portal-split>div:first-child,.public-home .portal-proof article:nth-child(2){display:none!important}
  .public-home .portal-proof article{grid-template-columns:1fr auto!important;gap:10px!important;padding:14px 15px!important;border-radius:14px!important}
  .public-home .portal-proof article>span{grid-column:1 / -1;margin-bottom:-2px;font-size:9px!important}
  .public-home .portal-proof strong{font-size:13px!important;line-height:1.4!important}
  .public-home .portal-proof a{align-self:center;white-space:nowrap;font-size:12px!important}
}

@keyframes mobileTrustScroll{from{text-indent:100%}to{text-indent:-190%}}
@media (prefers-reduced-motion:reduce){.public-home .hero-quote-panel:after{animation:none!important;text-indent:0!important;text-align:center!important}}
`;

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema).replace(/</g, "\\u003c") }}
      />
      <style dangerouslySetInnerHTML={{ __html: mobileHomeCss }} />
      <AuthLinkRouter />
      <Header />
      <main className="public-home">
        <Hero />
        <Features />
        <Services />
        <Membership />
        <Portals />
      </main>
      <Footer />
    </>
  );
}

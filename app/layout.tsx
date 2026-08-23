import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./homepage-conversion-polish.css";
import "./public-site-polish.css";
import "./role-portal-alignment.css";
import "./customer-profile-media.css";
import "./role-profile-media.css";
import "./unified-mobile.css";
import "./role-mobile-system.css";
import "./premium-mobile.css";
import "./premium-mobile-fixes.css";
import "./customer-mobile-overnight.css";
import "./e2e-surface-fixes.css";
import "./route-build-polish.css";
import "./route-experience-polish.css";
import "./advisor-smart-route-tweaks.css";
import "./advisor-stability-fixes.css";
import "./product-quality-system.css";
import "./mobile-audit-fixes.css";
import "./customer-wallet-feedback.css";
import "./mobile-employee-polish.css";
import "./mobile-employee-polish-v2.css";
import "./mobile-employee-polish-v3.css";
import "./admin-dashboard-polish.css";
import "./admin-primary-pages-polish.css";
import "./route-operations-visual-v2.css";
import "./portal-desktop-polish.css";
import "./master-platform-polish.css";
import "./public-pages.css";
import "./public-pages-final.css";
import "./quote-review-overflow-fix.css";
import "./master-pricing-final.css";
import { SeasonThemeProvider } from "@/components/SeasonThemeProvider";
import { AdminAccessFallback } from "@/components/master/AdminAccessFallback";
import { CustomerLegacyDataGuard } from "@/components/customer/CustomerLegacyDataGuard";
import { RouteAdvisorFeedbackNavigator } from "@/components/admin/RouteAdvisorFeedbackNavigator";
import { AdvisorHouseQuickAccess } from "@/components/admin/AdvisorHouseQuickAccess";
import { RouteWorkerConsistencyEnhancer } from "@/components/admin/RouteWorkerConsistencyEnhancer";
import { CustomerSelectSearchEnhancer } from "@/components/payments/CustomerSelectSearchEnhancer";
import { EmployeeMobilePolish } from "@/components/mobile/EmployeeMobilePolish";
import { PricingBootstrap } from "@/components/PricingBootstrap";
import { getSiteUrl } from "@/lib/seo/siteUrl";

const siteUrl = getSiteUrl().replace(/\/$/, "");
const brandLogoUrl = `${siteUrl}/brand/4ever-seasons-logo-mark.jpg`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Lawn Care & Property Maintenance | Hamilton, Burlington & Oakville | 4 Ever Seasons",
  description: "Local lawn care, seasonal cleanups, garden maintenance and snow removal across Hamilton, Burlington and Oakville, Ontario. Request a property quote from 4 Ever Seasons.",
  applicationName: "4 Ever Seasons",
  manifest: "/manifest.json",
  icons: {
    icon: "/brand/4ever-seasons-logo-mark.jpg",
    shortcut: "/brand/4ever-seasons-logo-mark.jpg",
    apple: "/brand/4ever-seasons-logo-mark.jpg",
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { type: "website", locale: "en_CA", url: siteUrl, siteName: "4 Ever Seasons", title: "Lawn Care & Property Maintenance | Hamilton, Burlington & Oakville", description: "Local lawn care, seasonal cleanups, garden maintenance and snow removal across Hamilton, Burlington and Oakville, Ontario.", images: [{ url: brandLogoUrl, alt: "4 Ever Seasons" }] },
  twitter: { card: "summary", title: "4 Ever Seasons | Lawn Care & Property Maintenance", description: "Local lawn care, seasonal cleanup, garden and snow service across Hamilton, Burlington and Oakville.", images: [brandLogoUrl] },
};

export const viewport: Viewport = { themeColor: "#043d2e", width: "device-width", initialScale: 1, viewportFit: "cover" };

const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "4 Ever Seasons",
      alternateName: "4Ever Seasons",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: brandLogoUrl,
      },
      email: "support@4everseasons.com",
      areaServed: [
        { "@type": "City", name: "Hamilton", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
        { "@type": "City", name: "Burlington", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
        { "@type": "City", name: "Oakville", containedInPlace: { "@type": "AdministrativeArea", name: "Ontario" } },
      ],
      knowsAbout: ["Lawn care", "Lawn cutting", "Seasonal cleanups", "Garden maintenance", "Snow removal", "Property maintenance"],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "4 Ever Seasons",
      publisher: { "@id": `${siteUrl}/#organization` },
      inLanguage: "en-CA",
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = JSON.stringify(siteStructuredData).replace(/</g, "\\u003c");
  return <html lang="en-CA" data-season="summer"><body><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }}/><SeasonThemeProvider><PricingBootstrap/><CustomerLegacyDataGuard/><RouteAdvisorFeedbackNavigator/><EmployeeMobilePolish/><AdvisorHouseQuickAccess/><RouteWorkerConsistencyEnhancer/><CustomerSelectSearchEnhancer/>{children}</SeasonThemeProvider><AdminAccessFallback/></body></html>;
}

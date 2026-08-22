import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./public-site-polish.css";
import "./role-portal-alignment.css";
import "./customer-profile-media.css";
import "./role-profile-media.css";
import "./role-mobile-system.css";
import "./customer-mobile-overnight.css";
import "./mobile-employee-polish-v2.css";
import "./mobile-employee-polish-v3.css";
import "./e2e-surface-fixes.css";
import "./route-build-polish.css";
import "./route-experience-polish.css";
import "./advisor-smart-route-tweaks.css";
import "./advisor-stability-fixes.css";
import "./product-quality-system.css";
import "./admin-dashboard-polish.css";
import "./public-pages.css";
import {SeasonThemeProvider} from "@/components/SeasonThemeProvider";
import {AdminAccessFallback} from "@/components/master/AdminAccessFallback";
import {CustomerLegacyDataGuard} from "@/components/customer/CustomerLegacyDataGuard";
import {RouteAdvisorFeedbackNavigator} from "@/components/admin/RouteAdvisorFeedbackNavigator";
import {AdvisorHouseQuickAccess} from "@/components/admin/AdvisorHouseQuickAccess";
import {RouteWorkerConsistencyEnhancer} from "@/components/admin/RouteWorkerConsistencyEnhancer";
import {CustomerSelectSearchEnhancer} from "@/components/payments/CustomerSelectSearchEnhancer";
import {getSiteUrl} from "@/lib/seo/siteUrl";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "4Ever Seasons | Property Maintenance in Hamilton, Burlington & Oakville",
  description: "Local lawn care, seasonal cleanups, garden maintenance and winter property service across Hamilton, Burlington and Oakville, Ontario.",
  applicationName: "4Ever Seasons",
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_CA",
    url: siteUrl,
    siteName: "4Ever Seasons",
    title: "4Ever Seasons | Property Maintenance in Hamilton, Burlington & Oakville",
    description: "Local lawn care, seasonal cleanups, garden maintenance and winter property service across Hamilton, Burlington and Oakville, Ontario.",
  },
  twitter: {
    card: "summary_large_image",
    title: "4Ever Seasons | Property Maintenance in Hamilton, Burlington & Oakville",
    description: "Local four-season property maintenance across Hamilton, Burlington and Oakville, Ontario.",
  },
};

export const viewport: Viewport = {
  themeColor: "#043d2e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-CA" data-season="summer"><body><SeasonThemeProvider><CustomerLegacyDataGuard/><RouteAdvisorFeedbackNavigator/><AdvisorHouseQuickAccess/><RouteWorkerConsistencyEnhancer/><CustomerSelectSearchEnhancer/>{children}</SeasonThemeProvider><AdminAccessFallback/></body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./role-portal-alignment.css";
import "./customer-profile-media.css";
import "./role-profile-media.css";
import "./role-mobile-system.css";
import "./customer-mobile-overnight.css";
import "./e2e-surface-fixes.css";
import "./route-build-polish.css";
import "./route-experience-polish.css";
import {SeasonThemeProvider} from "@/components/SeasonThemeProvider";
import {AdminAccessFallback} from "@/components/master/AdminAccessFallback";
import {CustomerLegacyDataGuard} from "@/components/customer/CustomerLegacyDataGuard";
import {RouteAdvisorFeedbackNavigator} from "@/components/admin/RouteAdvisorFeedbackNavigator";
import {AdvisorHouseQuickAccess} from "@/components/admin/AdvisorHouseQuickAccess";
import {CustomerSelectSearchEnhancer} from "@/components/payments/CustomerSelectSearchEnhancer";

export const metadata: Metadata = {
  title: "4Ever Seasons | Premium Property Care",
  description: "Modern four-season property care with instant quotes, live routes, customer portals and field proof.",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#043d2e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-season="summer"><body><SeasonThemeProvider><CustomerLegacyDataGuard/><RouteAdvisorFeedbackNavigator/><AdvisorHouseQuickAccess/><CustomerSelectSearchEnhancer/>{children}</SeasonThemeProvider><AdminAccessFallback/></body></html>;
}

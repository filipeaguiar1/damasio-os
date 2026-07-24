import type { Metadata, Viewport } from "next";
import "./globals.css";
import {SeasonThemeProvider} from "@/components/SeasonThemeProvider";

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
  return <html lang="en" data-season="summer"><body><SeasonThemeProvider>{children}</SeasonThemeProvider></body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import {SeasonThemeProvider} from "@/components/SeasonThemeProvider";

export const metadata: Metadata = {
  title: "Damasio Seasons | Damasio OS",
  description: "Property maintenance, CRM, customer portal, employee portal, finance, SaaS, AI and mobile field operations platform.",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#0f5132",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-season="summer"><body><SeasonThemeProvider>{children}</SeasonThemeProvider></body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import {SeasonThemeProvider} from "@/components/SeasonThemeProvider";

export const metadata: Metadata = {
  title: "4Ever Seasons",
  description: "Four-season property care, customer service and field operations.",
  manifest: "/manifest.json"
};

export const viewport: Viewport = {
  themeColor: "#063b62",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-season="summer"><body><SeasonThemeProvider>{children}</SeasonThemeProvider></body></html>;
}

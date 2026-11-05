import type { Metadata } from "next";
import PrivateSnowPage from "./private-snow/page";

export const metadata: Metadata = {
  title: "Residential Snow Removal | 4Ever Seasons",
  description: "Personal residential snow removal in Hamilton and surrounding Ontario communities. Request a single visit, monthly coverage, or full winter season plan.",
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "4Ever Seasons | Private Residential Snow Removal",
    description: "Direct residential snow clearing, with simple service plans and documented visits.",
  },
};

export default function HomePage() {
  return <PrivateSnowPage />;
}

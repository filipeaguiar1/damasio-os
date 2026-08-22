import type { MetadataRoute } from "next";
import { citySlugs, serviceSlugs } from "@/lib/seo/landingPages";
import { getSiteUrl } from "@/lib/seo/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const now = new Date();

  return [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    ...citySlugs.map((city) => ({ url: `${siteUrl}/service-areas/${city}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.9 })),
    ...serviceSlugs.map((service) => ({ url: `${siteUrl}/services/${service}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}

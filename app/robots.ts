import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/siteUrl";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/company/",
          "/employee/",
          "/customer/",
          "/master/",
          "/mobile/",
          "/login/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}

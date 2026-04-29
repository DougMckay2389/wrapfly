import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/account/",
          "/cart",
          "/checkout/",
          "/admin/",
          "/_next/",
        ],
      },
    ],
    sitemap: await siteUrl("/sitemap.xml"),
    host: await siteUrl("/"),
  };
}

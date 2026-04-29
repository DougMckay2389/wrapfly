import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

export const revalidate = 3600; // hourly
export const dynamic = "force-dynamic"; // ensures siteUrl() can read headers()

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const [{ data: cats }, { data: products }] = await Promise.all([
    supabase
      .from("categories")
      .select("path, updated_at")
      .eq("is_active", true),
    supabase
      .from("products")
      .select("slug, updated_at")
      .eq("is_active", true),
  ]);

  const u = (path: string) => siteUrl(path);

  const staticEntries: MetadataRoute.Sitemap = await Promise.all([
    u("/").then((url) => ({ url, changeFrequency: "weekly" as const, priority: 1.0 })),
    u("/about").then((url) => ({ url, changeFrequency: "yearly" as const, priority: 0.4 })),
    u("/contact").then((url) => ({ url, changeFrequency: "yearly" as const, priority: 0.4 })),
    u("/help/shipping").then((url) => ({ url, changeFrequency: "yearly" as const, priority: 0.3 })),
    u("/help/international").then((url) => ({ url, changeFrequency: "yearly" as const, priority: 0.3 })),
    u("/help/faq").then((url) => ({ url, changeFrequency: "monthly" as const, priority: 0.4 })),
  ]);

  const catEntries: MetadataRoute.Sitemap = await Promise.all(
    (cats ?? []).map(async (c) => ({
      url: await u(`/c/${c.path}`),
      lastModified: c.updated_at ? new Date(c.updated_at) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  );

  const productEntries: MetadataRoute.Sitemap = await Promise.all(
    (products ?? []).map(async (p) => ({
      url: await u(`/p/${p.slug}`),
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  );

  return [...staticEntries, ...catEntries, ...productEntries];
}

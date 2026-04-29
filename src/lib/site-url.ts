import { headers } from "next/headers";

/**
 * Runtime-aware site URL resolver.
 *
 * Order of precedence:
 *  1. The actual host serving the request (Cloudflare sets `host` and
 *     `x-forwarded-proto`). This means whatever domain the user is on
 *     becomes the canonical, with no redeploy needed during a DNS cutover.
 *  2. NEXT_PUBLIC_SITE_URL (build-time inlined — used as fallback when
 *     headers aren't available, e.g. during static generation).
 *  3. https://wrapfly.com hardcoded fallback.
 *
 * Use this in sitemap.ts, robots.ts, and JSON-LD where canonicality matters.
 */
export async function getSiteUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host") ?? h.get("x-forwarded-host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ??
        (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws outside a request scope (e.g. during static
    // pre-render). Fall through to env-var fallback.
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://wrapfly.com";
}

export async function siteUrl(path: string): Promise<string> {
  const base = await getSiteUrl();
  return new URL(path, base).toString();
}

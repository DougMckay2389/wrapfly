/**
 * Standalone image-mirror script.
 *
 * Why it exists: when the CSV importer runs a big batch, Grimco sometimes
 * rate-limits the inline product-page fetches (anti-bot heuristics) — so
 * products land in Supabase with empty `images` columns. This script does
 * the image step on its own, with polite pacing, and can be re-run safely.
 *
 * It also gracefully retries by walking PRODUCT URL → JSON-LD → og:image
 * → Cloudinary CDN URLs that are visible in PDF Links, in that order,
 * picking the first one that returns a real image.
 *
 * Usage:
 *   npx tsx scripts/grimco/mirror-images.ts                # missing-only
 *   npx tsx scripts/grimco/mirror-images.ts --force         # re-mirror all
 *   npx tsx scripts/grimco/mirror-images.ts --limit=10      # first N only
 *   npx tsx scripts/grimco/mirror-images.ts --pause-ms=6000 # slower
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local)
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
if (existsSync(".env.local")) {
  dotenv.config({ path: ".env.local", override: true });
}

const args = process.argv.slice(2);
const flag = (n: string) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  if (a) return a.slice(`--${n}=`.length);
  return args.includes(`--${n}`) ? "true" : null;
};
const FORCE = flag("force") === "true";
const LIMIT = Number(flag("limit") ?? "0") || 0;
// Pause between products (the only fetch that hits grimco.com — image
// downloads go to Cloudinary's CDN). Default 6s ± 25% = 4.5s–7.5s, so the
// per-minute hit rate against grimco.com stays well below typical
// anti-bot thresholds.
const PAUSE_MS = Number(flag("pause-ms") ?? "6000") || 6000;
// Pause between image downloads within a product (Cloudinary). Cloudinary
// doesn't rate-limit at our volumes, but a short breath keeps storage
// uploads from queueing up.
const IMG_PAUSE_MS = Number(flag("img-pause-ms") ?? "400") || 400;
const STORAGE_BUCKET = "products";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0 Safari/537.36";

function jitter(ms: number) {
  return Math.floor(ms * (0.75 + Math.random() * 0.5));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */

async function fetchImageUrlsFromGrimco(productUrl: string): Promise<string[]> {
  if (!productUrl) return [];
  let html: string;
  try {
    const resp = await fetch(productUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!resp.ok) {
      console.warn(`    page fetch ${resp.status} for ${productUrl}`);
      return [];
    }
    html = await resp.text();
  } catch (e) {
    console.warn(`    page fetch error: ${(e as Error).message}`);
    return [];
  }

  const out = new Set<string>();

  // 1. JSON-LD Product schema (most reliable — Grimco populates this on every product page).
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]);
      const types = Array.isArray(data["@type"]) ? data["@type"] : [data["@type"]];
      if (!types.includes("Product")) continue;
      const img = data.image;
      if (typeof img === "string") out.add(img);
      else if (Array.isArray(img))
        for (const i of img) {
          if (typeof i === "string") out.add(i);
          else if (i?.url) out.add(i.url);
        }
    } catch {
      /* skip malformed */
    }
  }

  // 2. og:image meta tag (fallback).
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og) out.add(og[1]);

  // 3. Inline Cloudinary URLs under /Catalog/Products/<folder>/. Group by
  //    folder, keep only the most-frequent folder (that's the *product's*
  //    asset folder — site-wide things like the header logo live under
  //    /Catalog/<other>/ or have no Catalog/Products segment).
  const inlinePerFolder = new Map<string, string[]>();
  const inlineRe =
    /https:\/\/res\.cloudinary\.com\/grimcoweb\/image\/upload\/[^"' )]*?\/Catalog\/Products\/([^/]+)\/[^"' )]+\.(?:jpg|jpeg|png|webp)/gi;
  for (const m of html.matchAll(inlineRe)) {
    const folder = m[1];
    if (!inlinePerFolder.has(folder)) inlinePerFolder.set(folder, []);
    inlinePerFolder.get(folder)!.push(m[0]);
  }
  if (inlinePerFolder.size) {
    // Best folder = the one matching the JSON-LD hero (if any), else the
    // folder with the most distinct image URLs.
    const heroFolder = (() => {
      for (const u of out) {
        const m = u.match(/\/Catalog\/Products\/([^/]+)\//i);
        if (m) return m[1];
      }
      return null;
    })();
    const targetFolder =
      heroFolder && inlinePerFolder.has(heroFolder)
        ? heroFolder
        : Array.from(inlinePerFolder.entries()).sort(
            (a, b) => b[1].length - a[1].length,
          )[0][0];
    for (const u of inlinePerFolder.get(targetFolder)!) out.add(u);
  }

  // 4. Diagnostic: if we still have nothing, log what we DO have so we can
  //    understand the page shape.
  if (out.size === 0) {
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const ldCount = (html.match(/type=["']application\/ld\+json["']/gi) ?? [])
      .length;
    const productFolderHits = Array.from(
      html.matchAll(/\/Catalog\/Products\/([^/]+)\//gi),
    ).length;
    console.warn(
      `      diag: title="${title?.slice(0, 60)}" ld_blocks=${ldCount} product_folder_hits=${productFolderHits}`,
    );
  }

  return Array.from(out).filter((u) => /^https?:\/\//.test(u));
}

async function downloadAndUpload(
  sourceUrl: string,
  productGrimcoId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl, { headers: { "User-Agent": UA } });
    if (!resp.ok) {
      console.warn(`      img ${resp.status}: ${sourceUrl}`);
      return null;
    }
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) {
      console.warn(`      not an image (${ct})`);
      return null;
    }
    const ext = ct.includes("png")
      ? "png"
      : ct.includes("webp")
        ? "webp"
        : ct.includes("gif")
          ? "gif"
          : ct.includes("avif")
            ? "avif"
            : "jpg";
    const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
    const path = `${productGrimcoId}/${hash}.${ext}`;
    const bytes = new Uint8Array(await resp.arrayBuffer());

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: ct, upsert: true });
    if (error) {
      console.warn(`      storage error: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.warn(`      mirror error: ${(e as Error).message}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log(
    `Image mirror — pause ${PAUSE_MS}ms${
      FORCE ? " (force re-mirror)" : ""
    }${LIMIT ? ` limit ${LIMIT}` : ""}`,
  );

  let q = supabase
    .from("products")
    .select("id, name, slug, grimco_id, grimco_url, images")
    .not("grimco_url", "is", null);
  if (!FORCE) {
    // missing-only: images column is null OR an empty array
    q = q.or("images.is.null,images.eq.[]");
  }
  const { data: products, error } = await q;
  if (error) {
    console.error(`Could not load products: ${error.message}`);
    process.exit(1);
  }
  const targets = LIMIT ? products!.slice(0, LIMIT) : products!;
  console.log(`Found ${targets.length} products needing images.\n`);

  let ok = 0;
  let empty = 0;
  let i = 0;
  for (const p of targets) {
    i++;
    console.log(`[${i}/${targets.length}] ${p.name}`);
    const sources = await fetchImageUrlsFromGrimco(p.grimco_url!);
    if (!sources.length) {
      console.log("    no image URLs found — skipping");
      empty++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }
    console.log(`    ${sources.length} candidate URL(s)`);

    const uploaded: string[] = [];
    for (const src of sources.slice(0, 6)) {
      const u = await downloadAndUpload(src, p.grimco_id ?? p.slug);
      if (u) uploaded.push(u);
      // Brief pause between image fetches/uploads within the same product.
      await sleep(jitter(IMG_PAUSE_MS));
    }
    if (!uploaded.length) {
      console.log("    no images uploaded");
      empty++;
    } else {
      const { error: uerr } = await supabase
        .from("products")
        .update({ images: uploaded })
        .eq("id", p.id);
      if (uerr) {
        console.warn(`    DB update failed: ${uerr.message}`);
        empty++;
      } else {
        console.log(`    ✓ ${uploaded.length} image(s) saved`);
        ok++;
      }
    }
    await sleep(jitter(PAUSE_MS));
  }

  console.log(`\nDone: ${ok} mirrored, ${empty} empty.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

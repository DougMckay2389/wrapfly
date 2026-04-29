/**
 * Mirror Grimco category images to Wrapfly's Supabase Storage and
 * update categories.image_url so each category card on the storefront
 * shows the right artwork.
 *
 * Strategy:
 *   1. Read every Wrapfly category that's missing an image_url.
 *   2. Try to derive a likely Grimco category URL from the slug (PascalCase).
 *   3. Fetch that page, extract the first product/category-specific
 *      Cloudinary image (ignoring the site logo / header / footer).
 *   4. Mirror to Supabase Storage at category-images/<slug>/<hash>.<ext>.
 *   5. Update categories.image_url with the public URL.
 *
 * Idempotent. Re-runnable. Pass --force to re-mirror categories that
 * already have an image_url.
 *
 * Usage:
 *   npx tsx scripts/grimco/mirror-category-images.ts
 *   npx tsx scripts/grimco/mirror-category-images.ts --force
 *   npx tsx scripts/grimco/mirror-category-images.ts --pause-ms=4000
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
const PAUSE_MS = Number(flag("pause-ms") ?? "3500") || 3500;
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

/** Convert Wrapfly slug ('automotive-films') → Grimco URL slug pattern.
 *  Grimco uses 'automotivefilms', 'wrapmaterials', etc. (no separators). */
function toGrimcoSlug(s: string): string {
  return s.replace(/-/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const SLUG_OVERRIDES: Record<string, string> = {
  // Slugs where Grimco's pattern doesn't equal stripped Wrapfly slug.
  "vinyl-rolls": "digitalmedia",
  "vinyl-tape": "vinylandapplicationtape",
  "vinyl-wrap": "automotivefilms/wrapmaterials/wrapfilms",
  "signs-supplies": "trafficsignsandsupplies",
  "inks-accessories": "inksandprintersupplies",
  "apparel-screen-printing": "appareldecoration",
  "banner-material": "bannermaterialsandsupplies",
};

function candidateGrimcoUrls(slug: string, path: string): string[] {
  const out: string[] = [];
  const direct = SLUG_OVERRIDES[slug] ?? toGrimcoSlug(slug);
  out.push(`https://www.grimco.com/catalog/category/${direct}`);
  // Try the "path" too (parent/child) in case the category lives nested.
  const nested = path
    .split("/")
    .map((p) => SLUG_OVERRIDES[p] ?? toGrimcoSlug(p))
    .join("/");
  if (nested !== direct) {
    out.push(`https://www.grimco.com/catalog/category/${nested}`);
  }
  return out;
}

/**
 * Grab a category-relevant hero image from a Grimco category page.
 * Filters out logos, navigation icons, division-level images that come
 * from /Catalog/Division/ (those are too generic — we want the page's
 * own marketing imagery).
 */
async function fetchCategoryImage(url: string): Promise<string | null> {
  let html: string;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    if (!resp.ok) {
      console.warn(`    page ${resp.status}: ${url}`);
      return null;
    }
    html = await resp.text();
  } catch (e) {
    console.warn(`    fetch error: ${(e as Error).message}`);
    return null;
  }

  // og:image is what social cards/SEO use — usually the best representative shot.
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  )?.[1];
  if (og && /res\.cloudinary\.com\/grimcoweb/.test(og)) return og;

  // Otherwise, find the first /Catalog/Category/ or /Catalog/Division/ image
  // that doesn't look like a logo or nav icon.
  const candidates: string[] = [];
  for (const m of html.matchAll(
    /https:\/\/res\.cloudinary\.com\/grimcoweb\/image\/upload\/[^"' )]+\.(?:jpg|jpeg|png|webp)/gi,
  )) {
    const u = m[0];
    if (/Logo|logo|Header|Footer|Webstore\/HomePage/i.test(u)) continue;
    if (/\/Catalog\/(Category|Division)\//.test(u)) candidates.push(u);
  }
  return candidates[0] ?? null;
}

async function mirrorImage(
  sourceUrl: string,
  slug: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl, { headers: { "User-Agent": UA } });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const ext = ct.includes("png")
      ? "png"
      : ct.includes("webp")
        ? "webp"
        : ct.includes("gif")
          ? "gif"
          : "jpg";
    const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
    const path = `category-images/${slug}/${hash}.${ext}`;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: ct, upsert: true });
    if (error) {
      console.warn(`    storage error: ${error.message}`);
      return null;
    }
    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.warn(`    mirror error: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  console.log(
    `Category image mirror — pace ${PAUSE_MS}ms${FORCE ? " (force)" : ""}`,
  );

  let q = supabase
    .from("categories")
    .select("id, name, slug, path, image_url")
    .eq("is_active", true)
    .order("level")
    .order("display_order");
  if (!FORCE) q = q.or("image_url.is.null,image_url.eq.");
  const { data: cats, error } = await q;
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Found ${cats!.length} categories needing images.\n`);

  let ok = 0;
  let empty = 0;

  for (let i = 0; i < cats!.length; i++) {
    const c = cats![i];
    console.log(`[${i + 1}/${cats!.length}] ${c.name} (${c.slug})`);

    let chosenUrl: string | null = null;
    const urls = candidateGrimcoUrls(c.slug, c.path);
    for (const u of urls) {
      const found = await fetchCategoryImage(u);
      if (found) {
        console.log(`    found ← ${u}`);
        chosenUrl = found;
        break;
      }
    }

    if (!chosenUrl) {
      console.log(`    no image found`);
      empty++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }

    const mirrored = await mirrorImage(chosenUrl, c.slug);
    if (!mirrored) {
      console.log(`    mirror failed`);
      empty++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }

    const { error: uerr } = await supabase
      .from("categories")
      .update({ image_url: mirrored })
      .eq("id", c.id);
    if (uerr) {
      console.warn(`    DB update failed: ${uerr.message}`);
      empty++;
    } else {
      console.log(`    ✓ saved`);
      ok++;
    }

    await sleep(jitter(PAUSE_MS));
  }

  console.log(`\nDone: ${ok} mirrored, ${empty} empty.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

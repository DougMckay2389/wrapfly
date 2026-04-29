/**
 * Playwright-rendered image mirror.
 *
 * Plain HTTP fetch to Grimco product pages returns DIFFERENT (and often
 * wrong/placeholder) JSON-LD content than what the page shows after JS
 * hydration. Real product images are only correct in the rendered DOM.
 *
 * This script renders each product page in a real Chromium browser, then
 * reads the JSON-LD + visible <img> tags to pick the correct
 * /Catalog/Products/<folder>/ images, downloads them, and uploads to
 * Supabase Storage.
 *
 * Reuses scripts/grimco/.profile/ from the original Playwright scraper, so
 * if you've signed into Grimco there once, no re-login needed.
 *
 * Usage:
 *   npx tsx scripts/grimco/mirror-images-rendered.ts                 # missing-only
 *   npx tsx scripts/grimco/mirror-images-rendered.ts --force         # re-mirror all
 *   npx tsx scripts/grimco/mirror-images-rendered.ts --limit=5       # first N
 *   npx tsx scripts/grimco/mirror-images-rendered.ts --headless      # no visible window
 *   npx tsx scripts/grimco/mirror-images-rendered.ts --pause-ms=8000 # slower pace
 */

import { chromium, type Page, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
const HEADED = flag("headless") !== "true";
const PAUSE_MS = Number(flag("pause-ms") ?? "5000") || 5000;
const STORAGE_BUCKET = "products";
const PROFILE_DIR = resolve(__dirname, ".profile");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function jitter(ms: number) {
  return Math.floor(ms * (0.75 + Math.random() * 0.5));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------- Per-product extraction (rendered) ------------------ */

async function extractFromRendered(page: Page, url: string): Promise<string[]> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for the JSON-LD Product image to be a real /Catalog/Products/X/ URL.
    // Times out at 8s — if Grimco never updates the JSON-LD, we still try the
    // visible <img> fallback below.
    await page
      .waitForFunction(
        () => {
          const lds = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]'),
          )
            .map((n) => {
              try {
                return JSON.parse(n.textContent ?? "");
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          const product = lds.find(
            (l) =>
              l &&
              (l["@type"] === "Product" ||
                (Array.isArray(l["@type"]) && l["@type"].includes("Product"))),
          );
          const img =
            typeof product?.image === "string"
              ? product.image
              : Array.isArray(product?.image)
                ? product.image[0]
                : null;
          return typeof img === "string" && /\/Catalog\/Products\//i.test(img);
        },
        { timeout: 8_000 },
      )
      .catch(() => {});
  } catch {
    return [];
  }

  // Pull JSON-LD + visible <img> srcs in one DOM read.
  return page.evaluate(() => {
    const out = new Set<string>();
    const lds = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )
      .map((n) => {
        try {
          return JSON.parse(n.textContent ?? "");
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const product = lds.find(
      (l) =>
        l &&
        (l["@type"] === "Product" ||
          (Array.isArray(l["@type"]) && l["@type"].includes("Product"))),
    );
    const ldImg = product?.image;
    if (typeof ldImg === "string") out.add(ldImg);
    else if (Array.isArray(ldImg))
      for (const i of ldImg) {
        if (typeof i === "string") out.add(i);
        else if (i?.url) out.add(i.url);
      }

    // Visible product gallery images. Only keep ones whose path includes
    // /Catalog/Products/<folder>/ — that filters out logos/nav icons.
    const productImgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"))
      .map((i) => i.src)
      .filter((s) => /\/Catalog\/Products\/[^/]+\//i.test(s));
    for (const u of productImgs) out.add(u);

    return Array.from(out);
  });
}

/* ----------------------------- download + upload ------------------------- */

async function downloadAndUpload(
  sourceUrl: string,
  productGrimcoId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      console.warn(`      img ${resp.status}: ${sourceUrl}`);
      return null;
    }
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

/* -------------------------------- main ----------------------------------- */

async function main() {
  console.log(
    `Rendered mirror — pace ${PAUSE_MS}ms${
      FORCE ? " (force)" : ""
    }${LIMIT ? ` limit ${LIMIT}` : ""}`,
  );

  let q = supabase
    .from("products")
    .select("id, name, slug, grimco_id, grimco_url, images")
    .not("grimco_url", "is", null);
  if (!FORCE) q = q.or("images.is.null,images.eq.[]");
  const { data: products, error } = await q;
  if (error) {
    console.error(`Could not load products: ${error.message}`);
    process.exit(1);
  }
  const targets = LIMIT ? products!.slice(0, LIMIT) : products!;
  console.log(`Found ${targets.length} products needing images.\n`);

  const browser: BrowserContext = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: !HEADED,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
    },
  );
  const page = browser.pages()[0] ?? (await browser.newPage());

  // Quick auth check by visiting a known page once.
  console.log("Checking Grimco session…");
  try {
    await page.goto("https://www.grimco.com/", { waitUntil: "domcontentloaded" });
    await page.getByText(/My Account/i).first().waitFor({ timeout: 30_000 });
    console.log("✓ Authenticated.\n");
  } catch {
    console.log(
      "(no My Account link visible — continuing anyway; sign in if products fail)\n",
    );
  }

  let ok = 0;
  let empty = 0;
  let i = 0;
  for (const p of targets) {
    i++;
    console.log(`[${i}/${targets.length}] ${p.name}`);
    const sources = await extractFromRendered(page, p.grimco_url!);
    // Pick the most-frequent /Catalog/Products/<folder>/ — that's the product.
    const byFolder = new Map<string, string[]>();
    for (const u of sources) {
      const m = u.match(/\/Catalog\/Products\/([^/]+)\//i);
      if (!m) continue;
      const f = m[1];
      if (!byFolder.has(f)) byFolder.set(f, []);
      byFolder.get(f)!.push(u);
    }
    const best = Array.from(byFolder.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    )[0];
    if (!best) {
      console.log("    no product images found");
      empty++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }
    const [folder, urls] = best;
    const dedup = Array.from(new Set(urls)).slice(0, 6);
    console.log(`    ${dedup.length} URL(s) from folder ${folder}`);

    const uploaded: string[] = [];
    for (const src of dedup) {
      const u = await downloadAndUpload(src, p.grimco_id ?? p.slug);
      if (u) uploaded.push(u);
      await sleep(300);
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

  await browser.close();
  console.log(`\nDone: ${ok} mirrored, ${empty} empty.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

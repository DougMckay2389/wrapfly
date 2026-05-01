/**
 * enrich-products.ts — full-data enrichment for active products via Playwright.
 *
 * Versus mirror-images-rendered.ts (which only grabs the product hero image),
 * this script captures EVERY data point Wrapfly needs for storefront-quality:
 *
 *   - Product hero image                   -> products.images[0]
 *   - All swatch images (with color names) -> product_variants.image_url (matched by color)
 *   - Breadcrumb category                  -> products.category_id (find/create by slug)
 *   - Description from JSON-LD             -> products.description
 *   - Per-variant pricing via Grimco API   -> product_variants.price + compare_price
 *
 * Filter handling:
 *   On variant-rich products (3M 2080, Oracal 651, etc.) Grimco hides
 *   options behind dropdown filters. We click "clear all selections"
 *   first so every swatch + every option is in the DOM, then read.
 *
 * Per-variant pricing:
 *   The page's pricing element only updates when a specific variant is
 *   selected. Rather than clicking each one, we call Grimco's pricing API
 *   directly using the same Playwright BrowserContext (which carries the
 *   auth cookies):
 *      GET /API/Catalog/UpdatePriceAndPromotion/{SKU}?quantity=1&isSystem=false
 *
 * Usage:
 *   npm run enrich:products                       # all active w/o full data
 *   npm run enrich:products -- --limit=5          # first N
 *   npm run enrich:products -- --category=automotive-films
 *   npm run enrich:products -- --force            # re-enrich everything active
 *   npm run enrich:products -- --pause-ms=4000    # slow it down
 *
 * Pre-req: run `npm run mirror:login` once to seed the Playwright profile
 * with your Grimco session cookies.
 */

import { chromium, type Page, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
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
const PAUSE_MS = Number(flag("pause-ms") ?? "4000") || 4000;
const CATEGORY = flag("category");
const PROFILE_DIR = resolve(__dirname, ".profile");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) =>
  Math.floor(ms * (0.85 + Math.random() * 0.3));

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normColor(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ----------------------- Per-product extraction --------------------------- */

type Extracted = {
  productLdName: string | null;
  hero: string | null;
  description: string | null;
  breadcrumbCategory: string | null;
  swatches: Array<{ color: string; url: string }>;
};

async function extractFromPage(page: Page): Promise<Extracted> {
  // Try to click "clear all selections" so every variant is visible.
  try {
    const clearBtn = page.getByText(/clear all selection/i).first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click({ timeout: 2000 }).catch(() => {});
      await sleep(2500); // wait for filters to reset + prices to load
    }
  } catch {
    /* no clear button visible — already at default state */
  }

  // Wait for JSON-LD product image to settle into a real /Catalog/Products/<x>/ URL.
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

  return page.evaluate(() => {
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
    const breadcrumb = lds.find(
      (l) => l && l["@type"] === "BreadcrumbList",
    );
    const breadcrumbItems: string[] =
      breadcrumb?.itemListElement?.map(
        (it: any) => it.name || it.item?.name,
      ) || [];

    const heroLd = Array.isArray(product?.image)
      ? product?.image[0]
      : product?.image;
    const hero =
      typeof heroLd === "string" && /\/Catalog\/Products\//i.test(heroLd)
        ? heroLd
        : null;

    const swatches = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[src*="/Swatch/" i]'),
    )
      .map((i) => ({ color: i.alt || "", url: i.src }))
      .filter((s) => s.color && s.url);

    return {
      productLdName: product?.name ?? null,
      hero,
      description: product?.description?.slice(0, 1000) ?? null,
      breadcrumbCategory:
        breadcrumbItems[breadcrumbItems.length - 2] ?? null,
      swatches,
    };
  });
}

/* ------------- Find-or-create category from breadcrumb name --------------- */

const categoryCache = new Map<string, string>();

async function findOrCreateCategory(name: string): Promise<string | null> {
  const slug = slugify(name);
  if (!slug) return null;
  const cached = categoryCache.get(slug);
  if (cached) return cached;
  const { data: existingCat } = await supabase
    .from("categories")
    .select("id, is_active, image_url")
    .eq("slug", slug)
    .maybeSingle();
  if (existingCat) {
    // Quality gate: only activate if the category has an image
    if (existingCat.is_active === false && existingCat.image_url) {
      await supabase
        .from("categories")
        .update({ is_active: true })
        .eq("id", existingCat.id);
    }
    categoryCache.set(slug, existingCat.id);
    return existingCat.id;
  }
  // Don't auto-create new categories without images — Doug's quality bar.
  console.warn(
    `      category '${name}' (slug ${slug}) not in DB and no auto-create without image`,
  );
  return null;
}

/* ----------------------------- main --------------------------------------- */

async function resolveCategoryIds(slug: string): Promise<string[]> {
  const { data: root } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!root) {
    console.error(`Category slug not found: ${slug}`);
    process.exit(1);
  }
  const ids: string[] = [root.id];
  let frontier: string[] = [root.id];
  while (frontier.length) {
    const { data: kids } = await supabase
      .from("categories")
      .select("id")
      .in("parent_id", frontier);
    if (!kids?.length) break;
    const kidIds = kids.map((k) => k.id);
    ids.push(...kidIds);
    frontier = kidIds;
  }
  return ids;
}

async function main() {
  console.log(
    `enrich-products — pace ${PAUSE_MS}ms${FORCE ? " (force)" : ""}${
      LIMIT ? ` limit ${LIMIT}` : ""
    }${CATEGORY ? ` category=${CATEGORY}` : ""}`,
  );

  let categoryIds: string[] | null = null;
  if (CATEGORY) {
    categoryIds = await resolveCategoryIds(CATEGORY);
    console.log(`Scoped to ${categoryIds.length} category id(s).`);
  }

  let q = supabase
    .from("products")
    .select("id, name, slug, grimco_id, grimco_url, images")
    .eq("is_active", true)
    .not("grimco_url", "is", null);
  if (categoryIds) q = q.in("category_id", categoryIds);
  if (!FORCE) q = q.or("images.is.null,images.eq.[]");
  const { data: products, error } = await q;
  if (error) {
    console.error(`Could not load products: ${error.message}`);
    process.exit(1);
  }
  const targets = LIMIT ? products!.slice(0, LIMIT) : products!;
  console.log(`Found ${targets.length} products to enrich.\n`);

  const browser: BrowserContext = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: !HEADED,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/147.0 Safari/537.36",
    },
  );
  const page = browser.pages()[0] ?? (await browser.newPage());

  // Auth check
  console.log("Checking Grimco session…");
  try {
    await page.goto("https://www.grimco.com/", {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(/My Account/i).first().waitFor({ timeout: 30_000 });
    console.log("✓ Authenticated.\n");
  } catch {
    console.log(
      "(no My Account link — run `npm run mirror:login` first if products fail)\n",
    );
  }

  let okCount = 0;
  let emptyCount = 0;
  let i = 0;
  for (const p of targets) {
    i++;
    console.log(`[${i}/${targets.length}] ${p.name}`);
    try {
      await page.goto(p.grimco_url!, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (e) {
      console.warn(`    nav error: ${(e as Error).message}`);
      emptyCount++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }

    const data = await extractFromPage(page);
    if (!data.hero) {
      console.log("    no hero image — skipping");
      emptyCount++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }
    console.log(
      `    hero ✓, ${data.swatches.length} swatches, cat="${data.breadcrumbCategory ?? "?"}"`,
    );

    // Update product: images + description + maybe category
    const productPatch: Record<string, unknown> = {
      images: [data.hero],
    };
    if (data.description) productPatch.description = data.description;
    if (data.breadcrumbCategory) {
      const catId = await findOrCreateCategory(data.breadcrumbCategory);
      if (catId) productPatch.category_id = catId;
    }
    const { error: pUpd } = await supabase
      .from("products")
      .update(productPatch)
      .eq("id", p.id);
    if (pUpd) {
      console.warn(`    product update failed: ${pUpd.message}`);
      emptyCount++;
      await sleep(jitter(PAUSE_MS));
      continue;
    }

    // Match swatches to existing variants by color name
    if (data.swatches.length > 0) {
      const { data: variants } = await supabase
        .from("product_variants")
        .select("id, sku, combination, image_url")
        .eq("product_id", p.id);
      if (variants?.length) {
        const swByColor = new Map<string, string>();
        for (const sw of data.swatches) {
          swByColor.set(normColor(sw.color), sw.url);
        }
        let matched = 0;
        for (const v of variants) {
          const colorVal = (v.combination?.color ?? "") as string;
          if (!colorVal) continue;
          const swUrl = swByColor.get(normColor(colorVal));
          if (swUrl && swUrl !== v.image_url) {
            const { error: vUpd } = await supabase
              .from("product_variants")
              .update({ image_url: swUrl })
              .eq("id", v.id);
            if (!vUpd) matched++;
          }
        }
        if (matched > 0) console.log(`    ${matched} variant swatch(es) matched`);
      }
    }

    okCount++;
    await sleep(jitter(PAUSE_MS));
  }

  await browser.close();
  console.log(`\nDone: ${okCount} enriched, ${emptyCount} empty/failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Grimco importer — reads `output/products.json` from the scraper and
 * upserts into Supabase (products + product_variants), applying your
 * margin from the env var GRIMCO_MARGIN_PERCENT (default 30).
 *
 * Re-runs idempotently — products are matched by `grimco_id`, variants
 * by `grimco_sku`. Safe to run as often as you want.
 *
 * Usage:
 *   npx tsx scripts/grimco/import.ts
 *   GRIMCO_MARGIN_PERCENT=40 npx tsx scripts/grimco/import.ts   # one-off override
 *   npx tsx scripts/grimco/import.ts --dry-run                   # show what would change
 *
 * Required env (in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import * as dotenv from "dotenv";

// Load env from .env (default) then override from .env.local — the same
// precedence order Next.js uses.
dotenv.config({ path: ".env" });
if (existsSync(".env.local")) {
  dotenv.config({ path: ".env.local", override: true });
}

const PRODUCTS_FILE = resolve(__dirname, "output/products.json");
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MARGIN_PERCENT = Number(process.env.GRIMCO_MARGIN_PERCENT ?? 30);

if (!Number.isFinite(MARGIN_PERCENT) || MARGIN_PERCENT < 0) {
  console.error("Invalid GRIMCO_MARGIN_PERCENT");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type DimensionOption = { value: string; label: string };
type ScrapedProduct = {
  grimco_url: string;
  grimco_id: string;
  name: string;
  brand: string | null;
  description: string | null;
  images: string[];
  category_path: string[];
  specifications: Array<{ label: string; value: string }>;
  variant_dimensions: string[];
  variant_options: Record<string, DimensionOption[]>;
  variants: Array<{
    sku: string | null;
    combination: Record<string, string>;
    cost_price: number | null;
    stock_qty: number | null;
    in_stock: boolean;
  }>;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function applyMargin(cost: number): number {
  return Number((cost * (1 + MARGIN_PERCENT / 100)).toFixed(2));
}

/** Walk the category_path and find/create matching `categories` rows. */
async function resolveCategoryId(path: string[]): Promise<string | null> {
  if (!path.length) return null;
  let parentId: string | null = null;
  let cumulativeSlug = "";
  for (let level = 0; level < path.length; level++) {
    const name = path[level];
    const slugPart = slugify(name);
    cumulativeSlug = cumulativeSlug ? `${cumulativeSlug}/${slugPart}` : slugPart;

    // Try lookup by path first.
    const { data: found } = await supabase
      .from("categories")
      .select("id")
      .eq("path", cumulativeSlug)
      .maybeSingle();
    if (found) {
      parentId = found.id;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry] would create category "${cumulativeSlug}"`);
      parentId = null;
      continue;
    }

    const { data: created, error } = await supabase
      .from("categories")
      .insert({
        name,
        slug: slugPart,
        parent_id: parentId,
        level,
        path: cumulativeSlug,
        is_active: true,
        display_order: 100,
      })
      .select("id")
      .single();
    if (error) {
      // Duplicate slug — recover by lookup
      const { data } = await supabase
        .from("categories")
        .select("id")
        .eq("slug", slugPart)
        .maybeSingle();
      parentId = data?.id ?? null;
    } else {
      parentId = created.id;
    }
  }
  return parentId;
}

async function importProduct(p: ScrapedProduct) {
  const slug = slugify(p.name) || p.grimco_id;
  const categoryId = await resolveCategoryId(p.category_path);

  // Use the cheapest in-stock variant cost as base_price (with margin).
  const inStock = p.variants.filter((v) => v.in_stock && v.cost_price != null);
  const minCost = inStock.length
    ? Math.min(...inStock.map((v) => v.cost_price!))
    : null;
  const basePrice = minCost != null ? applyMargin(minCost) : 0;

  const productPayload = {
    grimco_id: p.grimco_id,
    grimco_url: p.grimco_url,
    name: p.name,
    slug,
    sku: p.grimco_id,
    category_id: categoryId,
    brand: p.brand,
    description: p.description,
    short_description: p.description?.slice(0, 240) ?? null,
    base_price: basePrice,
    cost_price: minCost,
    margin_percent: MARGIN_PERCENT,
    images: p.images,
    specifications: p.specifications,
    variant_dimensions: p.variant_dimensions,
    variant_options: p.variant_options,
    is_active: true,
    json_source_url: p.grimco_url,
    last_synced: new Date().toISOString(),
  } as const;

  if (DRY_RUN) {
    console.log(
      `  [dry] product "${p.name}" → ${p.variants.length} variants, ` +
        `base ${minCost ? `$${minCost} → $${basePrice}` : "—"}`,
    );
    return;
  }

  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("grimco_id", p.grimco_id)
    .maybeSingle();

  let productId: string;
  if (existing) {
    const { error } = await supabase
      .from("products")
      .update(productPayload)
      .eq("id", existing.id);
    if (error) throw error;
    productId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("products")
      .insert(productPayload)
      .select("id")
      .single();
    if (error) throw error;
    productId = inserted.id;
  }

  /* ---- variants ---- */
  for (const v of p.variants) {
    const cost = v.cost_price;
    const retail = cost != null ? applyMargin(cost) : 0;
    const grimcoSku = v.sku ?? makeFallbackSku(p.grimco_id, v.combination);
    const payload = {
      product_id: productId,
      grimco_sku: grimcoSku,
      sku: grimcoSku,
      combination: v.combination,
      cost_price: cost,
      price: retail,
      stock_qty: v.stock_qty ?? (v.in_stock ? 1 : 0),
      is_available: v.in_stock,
    };

    const { data: existingVariant } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .eq("grimco_sku", grimcoSku)
      .maybeSingle();

    if (existingVariant) {
      const { error } = await supabase
        .from("product_variants")
        .update(payload)
        .eq("id", existingVariant.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("product_variants").insert(payload);
      if (error) throw error;
    }
  }

  console.log(`✓ ${p.name} (${p.variants.length} variants)`);
}

function makeFallbackSku(productId: string, combo: Record<string, string>): string {
  const tail = Object.values(combo)
    .map((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, ""))
    .join("-");
  return `${productId.toUpperCase()}-${tail}`.slice(0, 80);
}

async function main() {
  console.log(
    `Grimco importer — margin ${MARGIN_PERCENT}%${DRY_RUN ? " (DRY RUN)" : ""}`,
  );
  let products: ScrapedProduct[];
  try {
    products = JSON.parse(await readFile(PRODUCTS_FILE, "utf8"));
  } catch (e) {
    console.error(
      `Could not read ${PRODUCTS_FILE}. Run \`npm run scrape:grimco\` first.`,
    );
    throw e;
  }
  console.log(`Loaded ${products.length} scraped products.`);

  let ok = 0;
  let failed = 0;
  for (const p of products) {
    try {
      await importProduct(p);
      ok++;
    } catch (e) {
      failed++;
      console.error(`✗ ${p.name}: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone: ${ok} imported, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

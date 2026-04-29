/**
 * Grimco CSV importer.
 *
 * Reads a CSV produced by your other Grimco scraper (the one that captures
 * Reseller Price reliably) and bulk-upserts into Wrapfly Supabase, applying
 * your retail margin.
 *
 * Expected columns:
 *   Product Name, SKU, Variant Name, Reseller Price, Category, Product URL,
 *   Description, Key Features, PDF Links
 *
 * Usage:
 *   npx tsx scripts/grimco/import-csv.ts <path/to/file.csv>
 *   npx tsx scripts/grimco/import-csv.ts <file.csv> --dry-run
 *   npx tsx scripts/grimco/import-csv.ts <file.csv> --parent-slug=vinyl-rolls
 *   GRIMCO_MARGIN_PERCENT=40 npx tsx scripts/grimco/import-csv.ts <file.csv>
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
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

const csvPath = args.find((a) => !a.startsWith("--"));
if (!csvPath) {
  console.error("Usage: tsx scripts/grimco/import-csv.ts <file.csv> [--dry-run] [--parent-slug=<slug>]");
  process.exit(1);
}

const DRY_RUN = flag("dry-run") === "true";
const PARENT_SLUG = flag("parent-slug") || null;
const NO_IMAGES = flag("no-images") === "true";
const MARGIN_PERCENT = Number(process.env.GRIMCO_MARGIN_PERCENT ?? 30);
const STORAGE_BUCKET = "products";
if (!Number.isFinite(MARGIN_PERCENT) || MARGIN_PERCENT < 0) {
  console.error("Invalid GRIMCO_MARGIN_PERCENT");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/* ------------------------- CSV parser (simple) --------------------------- */

function parseCsv(raw: string): Record<string, string>[] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cur.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && raw[i + 1] === "\n") i++;
        cur.push(cell);
        if (cur.some((c) => c.length)) lines.push(cur);
        cur = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length || cur.length) {
    cur.push(cell);
    lines.push(cur);
  }
  if (!lines.length) return [];
  // Strip BOM from first header
  if (lines[0][0]?.charCodeAt(0) === 0xfeff) {
    lines[0][0] = lines[0][0].slice(1);
  }
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").trim();
    });
    return obj;
  });
}

/* --------------------------- variant parsing ----------------------------- */

type Combination = Record<string, string>;

/**
 * Parses a variant name suffix like:
 *   `31" x 164', Gloss`              → { size: '31" x 164\'', finish: 'Gloss' }
 *   `15" x 10 yd, 10 mil`            → { size: '15" x 10 yd', thickness: '10 mil' }
 *   `36" x 30 m`                     → { size: '36" x 30 m' }
 *   `59" x 164'`                     → { size: '59" x 164\'' }
 */
function parseVariantSuffix(suffix: string): Combination {
  const out: Combination = {};
  const pieces = suffix.split(",").map((s) => s.trim()).filter(Boolean);
  if (!pieces.length) return out;
  out.size = pieces[0];
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    if (/\b(mil|mm|gauge)\b/i.test(p)) {
      out.thickness = p;
    } else if (/^(gloss|matte|satin|hi[-\s]?gloss|high\s?gloss|metallic|carbon\s?fiber|brushed)$/i.test(p)) {
      out.finish = p;
    } else {
      // Fall back to a generic dim name. If multiple unrecognised pieces,
      // suffix them so they don't collide.
      const key = `option_${i}`;
      out[key] = p;
    }
  }
  return out;
}

function stripProductPrefix(productName: string, variantName: string): string {
  return variantName.startsWith(productName)
    ? variantName.slice(productName.length).trim()
    : variantName.trim();
}

/* ---------------------------- helpers ------------------------------------ */

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function applyMargin(cost: number): number {
  return Number((cost * (1 + MARGIN_PERCENT / 100)).toFixed(2));
}

function parsePrice(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------ image mirroring -------------------------------- */

import { createHash } from "node:crypto";

/**
 * Fetches a Grimco product page and pulls the hero image (and any other
 * images we can find in JSON-LD). Returns absolute URLs.
 */
async function fetchProductImagesFromPage(productUrl: string): Promise<string[]> {
  if (!productUrl) return [];
  let html: string;
  try {
    const resp = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) return [];
    html = await resp.text();
  } catch {
    return [];
  }

  const out = new Set<string>();
  // Pull every JSON-LD block; product schema is the one with `"@type":"Product"`.
  const ldMatches = html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of ldMatches) {
    try {
      const data = JSON.parse(m[1]);
      const node =
        data["@type"] === "Product" ||
        (Array.isArray(data["@type"]) && data["@type"].includes("Product"))
          ? data
          : null;
      if (!node) continue;
      const img = node.image;
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

  // Also look for any inline cloudinary product image in <meta property="og:image">
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch) out.add(ogMatch[1]);

  return Array.from(out).filter((u) => /^https?:\/\//.test(u));
}

/**
 * Downloads `sourceUrl`, uploads the bytes to the `products` Supabase
 * Storage bucket at a deterministic path, returns the public URL.
 * Idempotent — same source URL always lands at the same storage path.
 */
async function mirrorImage(
  sourceUrl: string,
  productGrimcoId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
      },
    });
    if (!resp.ok) {
      console.warn(`    image fetch ${resp.status}: ${sourceUrl}`);
      return null;
    }
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      console.warn(`    not an image (${contentType}): ${sourceUrl}`);
      return null;
    }
    const ext =
      contentType.includes("png") ? "png" :
      contentType.includes("webp") ? "webp" :
      contentType.includes("gif") ? "gif" :
      contentType.includes("avif") ? "avif" :
      "jpg";
    const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
    const path = `${productGrimcoId}/${hash}.${ext}`;

    const bytes = new Uint8Array(await resp.arrayBuffer());

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.warn(`    storage upload failed: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.warn(`    mirror error: ${(e as Error).message}`);
    return null;
  }
}

async function mirrorImagesForProduct(
  grimcoId: string,
  productUrl: string,
): Promise<string[]> {
  const sourceUrls = await fetchProductImagesFromPage(productUrl);
  if (!sourceUrls.length) return [];
  const mirrored: string[] = [];
  for (const src of sourceUrls.slice(0, 8)) {
    const url = await mirrorImage(src, grimcoId);
    if (url) mirrored.push(url);
  }
  return mirrored;
}

/* -------------------------- category resolution -------------------------- */

async function getOrCreateCategory(name: string): Promise<string | null> {
  if (!name) return null;
  const slug = slugify(name);

  // If --parent-slug given, look up the parent first.
  let parentId: string | null = null;
  let path = slug;
  if (PARENT_SLUG) {
    const { data: parent } = await supabase
      .from("categories")
      .select("id, path")
      .eq("slug", PARENT_SLUG)
      .maybeSingle();
    if (parent) {
      parentId = parent.id;
      path = `${parent.path}/${slug}`;
    }
  }

  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("path", path)
    .maybeSingle();
  if (existing) return existing.id;

  if (DRY_RUN) {
    console.log(`  [dry] would create category "${path}"`);
    return null;
  }

  const { data: created, error } = await supabase
    .from("categories")
    .insert({
      name,
      slug,
      parent_id: parentId,
      level: parentId ? 1 : 0,
      path,
      is_active: true,
      display_order: 100,
    })
    .select("id")
    .single();
  if (error) {
    // Race / unique conflict — recover by re-lookup
    const { data } = await supabase
      .from("categories")
      .select("id")
      .eq("path", path)
      .maybeSingle();
    return data?.id ?? null;
  }
  return created.id;
}

/* -------------------------- product/variant upsert ----------------------- */

type GroupedProduct = {
  name: string;
  category: string;
  productUrl: string;
  description: string;
  keyFeatures: string;
  pdfLinks: string;
  /** From new-format CSVs (Primary Image URL / All Image URLs columns).
   *  Empty when the CSV is the older shape; in that case we fall back to
   *  fetching the product page. */
  imageUrls: string[];
  rows: Record<string, string>[];
};

async function upsertProduct(g: GroupedProduct) {
  const variantsParsed = g.rows
    .map((r) => {
      const cost = parsePrice(r["Reseller Price"]);
      if (cost == null) return null;
      const suffix = stripProductPrefix(g.name, r["Variant Name"]);
      const combination = parseVariantSuffix(suffix);
      return {
        sku: r["SKU"]?.trim() ?? "",
        combination,
        cost_price: cost,
      };
    })
    .filter((v): v is NonNullable<typeof v> => !!v);

  if (!variantsParsed.length) {
    console.log(`  skip "${g.name}" — no priced variants`);
    return;
  }

  // Determine variant_dimensions = union of keys across combinations,
  // ordered by frequency (most common first → drives picker order).
  const dimCount: Record<string, number> = {};
  for (const v of variantsParsed) {
    for (const k of Object.keys(v.combination)) {
      dimCount[k] = (dimCount[k] ?? 0) + 1;
    }
  }
  const variant_dimensions = Object.keys(dimCount).sort(
    (a, b) => dimCount[b] - dimCount[a],
  );

  // Build variant_options = unique values per dim, preserving CSV order.
  const variant_options: Record<string, Array<{ value: string; label: string }>> = {};
  for (const d of variant_dimensions) {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    for (const v of variantsParsed) {
      const val = v.combination[d];
      if (val && !seen.has(val)) {
        seen.add(val);
        opts.push({ value: val, label: val });
      }
    }
    variant_options[d] = opts;
  }

  const minCost = Math.min(...variantsParsed.map((v) => v.cost_price));
  const basePrice = applyMargin(minCost);
  const slug = slugify(g.name);
  const grimcoId = slug || g.productUrl.split("/").pop() || g.name;
  const categoryId = await getOrCreateCategory(g.category);

  // Convert PDF Links pipe-string into resources array.
  const resources = g.pdfLinks
    .split("|")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url, i) => ({
      name: `Spec sheet ${i + 1}`,
      url,
      type: "application/pdf",
    }));

  // Convert key features into a list — split on " | " or commas as fallback.
  const keyFeaturesList = g.keyFeatures
    .split(/\s*\|\s*|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

  // Mirror product images to our storage so we don't hotlink Grimco's CDN.
  let images: string[] = [];
  if (!NO_IMAGES && !DRY_RUN) {
    if (g.imageUrls.length) {
      // New-format CSV — use the URLs from Primary/All Image URLs columns
      // directly. Cloudinary is public, no auth needed for download.
      console.log(`    using ${g.imageUrls.length} CSV-provided image URL(s)`);
      for (const src of g.imageUrls.slice(0, 8)) {
        const url = await mirrorImage(src, grimcoId);
        if (url) images.push(url);
      }
    } else {
      // Old-format CSV — fetch product page and parse JSON-LD. May return
      // wrong/placeholder images for some Grimco products (banner films
      // notably); use `npm run mirror:images` afterwards as a corrective.
      images = await mirrorImagesForProduct(grimcoId, g.productUrl);
    }
    if (images.length) {
      console.log(`    mirrored ${images.length} image(s)`);
    }
  }

  const productPayload = {
    grimco_id: grimcoId,
    grimco_url: g.productUrl,
    name: g.name,
    slug,
    sku: grimcoId.toUpperCase().slice(0, 60),
    category_id: categoryId,
    brand: extractBrand(g.name),
    description: g.description || null,
    short_description: g.description?.slice(0, 240) ?? null,
    base_price: basePrice,
    cost_price: minCost,
    margin_percent: MARGIN_PERCENT,
    images,
    specifications: [],
    enriched_features: keyFeaturesList,
    resources,
    variant_dimensions,
    variant_options,
    is_active: true,
    json_source_url: g.productUrl,
    last_synced: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log(
      `  [dry] "${g.name}" → ${variantsParsed.length} variants, ` +
        `dims=[${variant_dimensions.join(",")}], ` +
        `cost min=$${minCost} → retail $${basePrice}`,
    );
    return;
  }

  const { data: existing } = await supabase
    .from("products")
    .select("id")
    .eq("grimco_id", grimcoId)
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

  for (const v of variantsParsed) {
    const retail = applyMargin(v.cost_price);
    const payload = {
      product_id: productId,
      grimco_sku: v.sku,
      sku: v.sku,
      combination: v.combination,
      cost_price: v.cost_price,
      price: retail,
      stock_qty: 100, // CSV doesn't expose stock — assume in-stock
      is_available: true,
    };

    const { data: existingV } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .eq("grimco_sku", v.sku)
      .maybeSingle();

    if (existingV) {
      const { error } = await supabase
        .from("product_variants")
        .update(payload)
        .eq("id", existingV.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("product_variants").insert(payload);
      if (error) throw error;
    }
  }

  console.log(
    `✓ ${g.name} (${variantsParsed.length} variants @ ${MARGIN_PERCENT}% markup)`,
  );
}

function extractBrand(name: string): string | null {
  // Heuristic — first capitalized word, but recognise common brands.
  const known = ["3M", "Avery", "Avery Dennison", "Oracal", "Orafol", "Briteline", "Duratex", "RTape", "Rtape"];
  for (const b of known) {
    if (name.toLowerCase().includes(b.toLowerCase())) return b;
  }
  const m = name.match(/^(\S+)/);
  return m ? m[1] : null;
}

/* -------------------------------- main ----------------------------------- */

async function preflightAuth() {
  // Issue a privileged write that any non-service-role key (anon or publishable)
  // will reject. Roll back immediately so we don't pollute the DB.
  // Done by inserting/deleting a temp throwaway category.
  if (DRY_RUN) return;
  const probeSlug = `__preflight_${Date.now()}`;
  const { error: insErr } = await supabase
    .from("categories")
    .insert({ name: probeSlug, slug: probeSlug, path: probeSlug, is_active: false });
  if (insErr) {
    console.error(
      `\nSUPABASE auth check failed: ${insErr.message}\n\n` +
        `Most likely your SUPABASE_SERVICE_ROLE_KEY in .env.local is wrong, ` +
        `truncated, or you accidentally pasted the publishable/anon key.\n` +
        `Fix: Supabase dashboard → Settings → API Keys → Legacy → service_role → Reveal + Copy → ` +
        `update .env.local → re-run.\n`,
    );
    process.exit(2);
  }
  await supabase.from("categories").delete().eq("slug", probeSlug);
}

async function main() {
  console.log(
    `Grimco CSV importer — ${csvPath} — margin ${MARGIN_PERCENT}%${
      DRY_RUN ? " (DRY RUN)" : ""
    }${PARENT_SLUG ? ` — parent=${PARENT_SLUG}` : ""}`,
  );
  await preflightAuth();
  const raw = await readFile(csvPath!, "utf8");
  const rows = parseCsv(raw);
  console.log(`Loaded ${rows.length} CSV rows.`);

  const groups = new Map<string, GroupedProduct>();
  for (const r of rows) {
    const name = r["Product Name"];
    if (!name) continue;

    // Image URL columns — new in the magnetics CSV. Pipe-delimited list in
    // "All Image URLs"; single hero in "Primary Image URL".
    const all = (r["All Image URLs"] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const primary = (r["Primary Image URL"] ?? "").trim();
    const imageUrls = all.length ? all : primary ? [primary] : [];

    const g = groups.get(name) ?? {
      name,
      category: r["Category"] ?? "",
      productUrl: r["Product URL"] ?? "",
      description: r["Description"] ?? "",
      keyFeatures: r["Key Features"] ?? "",
      // CSV uses either "PDF Links" (old) or "PDF / Spec Sheet Links" (new).
      pdfLinks: r["PDF Links"] ?? r["PDF / Spec Sheet Links"] ?? "",
      imageUrls,
      rows: [],
    };
    g.rows.push(r);
    groups.set(name, g);
  }
  console.log(`${groups.size} unique products.\n`);

  let ok = 0;
  let failed = 0;
  for (const g of groups.values()) {
    try {
      await upsertProduct(g);
      ok++;
    } catch (e) {
      failed++;
      console.error(`✗ ${g.name}: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone: ${ok} products, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

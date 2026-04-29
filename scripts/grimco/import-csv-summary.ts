/**
 * Grimco CSV importer — one-row-per-product (summary) format.
 *
 * The new scraper produces one row per product with pipe-delimited variants
 * inside a single cell. This script expands those into product_variants rows.
 *
 * Expected columns:
 *   Product Name, First SKU, Base Price (Starting From), Total Variants,
 *   All Variant SKUs, All Variant Names, Category, Brand, Product URL,
 *   Description, Key Features, Primary Image URL, All Image URLs,
 *   PDF / Spec Sheet Links
 *
 * No per-variant pricing exists in this CSV, so every variant of a product
 * shares the product's `Base Price (Starting From)` (with margin applied).
 *
 * Usage:
 *   npx tsx scripts/grimco/import-csv-summary.ts <file.csv>
 *   npx tsx scripts/grimco/import-csv-summary.ts <file.csv> --dry-run
 *   npx tsx scripts/grimco/import-csv-summary.ts <file.csv> --parent-slug=vinyl-rolls
 *   npx tsx scripts/grimco/import-csv-summary.ts <file.csv> --max-variants=200
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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
  console.error("Usage: tsx scripts/grimco/import-csv-summary.ts <file.csv> [flags]");
  process.exit(1);
}
const DRY_RUN = flag("dry-run") === "true";
const PARENT_SLUG = flag("parent-slug") || null;
const NO_IMAGES = flag("no-images") === "true";
const MAX_VARIANTS = Number(flag("max-variants") ?? "0") || 0; // 0 = unlimited
const RESUME = flag("resume") === "true";
const MARGIN_PERCENT = Number(process.env.GRIMCO_MARGIN_PERCENT ?? 30);
const STORAGE_BUCKET = "products";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/* ---------------------------- CSV parser --------------------------------- */

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
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        cur.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && raw[i + 1] === "\n") i++;
        cur.push(cell);
        if (cur.some((c) => c.length)) lines.push(cur);
        cur = [];
        cell = "";
      } else cell += ch;
    }
  }
  if (cell.length || cur.length) {
    cur.push(cell);
    lines.push(cur);
  }
  if (!lines.length) return [];
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

/* ------------------------- variant suffix parsing ------------------------ */

type Combination = Record<string, string>;

function stripPrefix(productName: string, variantName: string): string {
  return variantName.startsWith(productName)
    ? variantName.slice(productName.length).trim()
    : variantName.trim();
}

/**
 * Parses a variant suffix into a combination map. Examples:
 *   '15" x 10 yd, Transparent, Punched: Yes' →
 *     { size: '15" x 10 yd', color: 'Transparent', punched: 'Yes' }
 *   '60" x 25 yd, White, Gloss' →
 *     { size: '60" x 25 yd', color: 'White', finish: 'Gloss' }
 */
function parseSuffix(suffix: string): Combination {
  const pieces = suffix.split(",").map((s) => s.trim()).filter(Boolean);
  const out: Combination = {};
  if (!pieces.length) return out;

  // First piece — almost always size (matches `<W>" x <L>` pattern).
  out.size = pieces[0];

  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];

    // "Key: Value" form (e.g. "Punched: Yes")
    const kv = p.match(/^([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+)$/);
    if (kv) {
      const key = kv[1]
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      out[key] = kv[2].trim();
      continue;
    }

    // Recognised finishes
    if (
      /^(gloss|matte|satin|hi[-\s]?gloss|high\s?gloss|metallic|carbon\s?fiber|brushed|luster|semi[-\s]?gloss)$/i.test(
        p,
      )
    ) {
      out.finish = p;
      continue;
    }

    // Thickness / mil
    if (/\b(mil|mm|gauge|oz)\b/i.test(p)) {
      out.thickness = p;
      continue;
    }

    // Otherwise treat as colour (default for "Black", "White", "Transparent",
    // "Matte White", etc.). If color is already set, append to a fallback.
    if (!out.color) out.color = p;
    else out[`option_${i}`] = p;
  }
  return out;
}

/* ---------------------- category normalization --------------------------- */

function normaliseCategoryName(raw: string): string {
  if (raw.includes(" > ")) {
    const parts = raw.split(" > ").map((s) => s.trim()).filter(Boolean);
    // Convention from Doug's scraper varies; the LAST part is usually the leaf.
    return parts[parts.length - 1];
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }
  return raw.trim();
}

/* ------------------------------- helpers --------------------------------- */

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

function parsePrice(raw: string): number {
  const m = raw.replace(/,/g, "").match(/[\d.]+/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

function extractBrand(name: string, brandColumn: string): string | null {
  if (brandColumn?.trim()) return brandColumn.trim();
  const known = ["3M", "Avery Dennison", "Avery", "ORAFOL", "ORACAL", "Briteline", "Duratex", "RTape", "Magnum"];
  for (const b of known) if (name.toLowerCase().includes(b.toLowerCase())) return b;
  return null;
}

/* -------------------------- image mirroring ------------------------------ */

async function mirrorImage(
  sourceUrl: string,
  productGrimcoId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(sourceUrl);
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
    const path = `${productGrimcoId}/${hash}.${ext}`;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: ct, upsert: true });
    if (error) return null;
    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/* -------------------- category resolution -------------------------------- */

async function getOrCreateCategory(name: string): Promise<string | null> {
  if (!name) return null;
  const slug = slugify(name);
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
    const { data } = await supabase
      .from("categories")
      .select("id")
      .eq("path", path)
      .maybeSingle();
    return data?.id ?? null;
  }
  return created.id;
}

/* -------------------- preflight auth check ------------------------------- */

async function preflightAuth() {
  if (DRY_RUN) return;
  const probe = `__preflight_${Date.now()}`;
  const { error } = await supabase
    .from("categories")
    .insert({ name: probe, slug: probe, path: probe, is_active: false });
  if (error) {
    console.error(
      `\nSUPABASE auth check failed: ${error.message}\n` +
        `Fix SUPABASE_SERVICE_ROLE_KEY in .env.local and re-run.\n`,
    );
    process.exit(2);
  }
  await supabase.from("categories").delete().eq("slug", probe);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(
    `Grimco summary importer — ${csvPath} — margin ${MARGIN_PERCENT}%${
      DRY_RUN ? " (DRY RUN)" : ""
    }${PARENT_SLUG ? ` — parent=${PARENT_SLUG}` : ""}`,
  );
  await preflightAuth();
  const raw = await readFile(csvPath!, "utf8");
  const rows = parseCsv(raw);
  console.log(`Loaded ${rows.length} CSV rows.\n`);

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let totalVariants = 0;

  // Resume: pre-fetch slugs of products that already have variants, so we
  // can skip them on re-runs after a crash / Ctrl-C / network blip.
  const alreadyDone = new Set<string>();
  if (RESUME) {
    const { data } = await supabase
      .from("products")
      .select("slug, product_variants!inner(id)")
      .not("grimco_url", "is", null)
      .limit(10_000);
    for (const p of data ?? []) alreadyDone.add(p.slug as string);
    console.log(`resume: ${alreadyDone.size} products already have variants — will skip\n`);
  }

  for (const r of rows) {
    const productName = r["Product Name"]?.trim();
    if (!productName) continue;
    if (RESUME && alreadyDone.has(slugify(productName))) {
      skipped++;
      continue;
    }

    const productUrl = r["Product URL"]?.trim() ?? "";
    const baseCost = parsePrice(r["Base Price (Starting From)"] ?? "0");
    const baseRetail = applyMargin(baseCost);
    const slug = slugify(productName);
    const grimcoId = slug || productUrl.split("/").pop() || productName;

    const skus = (r["All Variant SKUs"] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const names = (r["All Variant Names"] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!skus.length || skus.length !== names.length) {
      console.warn(
        `✗ ${productName} — variant SKU/name count mismatch (${skus.length} vs ${names.length}); skipping`,
      );
      failed++;
      continue;
    }

    const variants = skus.slice(0, MAX_VARIANTS || skus.length).map((sku, i) => ({
      sku,
      combination: parseSuffix(stripPrefix(productName, names[i])),
    }));

    // Build dimensions (union of keys, ordered by frequency)
    const dimCount: Record<string, number> = {};
    for (const v of variants)
      for (const k of Object.keys(v.combination))
        dimCount[k] = (dimCount[k] ?? 0) + 1;
    const variant_dimensions = Object.keys(dimCount).sort(
      (a, b) => dimCount[b] - dimCount[a],
    );

    const variant_options: Record<string, Array<{ value: string; label: string }>> = {};
    for (const d of variant_dimensions) {
      const seen = new Set<string>();
      const opts: Array<{ value: string; label: string }> = [];
      for (const v of variants) {
        const val = v.combination[d];
        if (val && !seen.has(val)) {
          seen.add(val);
          opts.push({ value: val, label: val });
        }
      }
      variant_options[d] = opts;
    }

    const categoryName = normaliseCategoryName(r["Category"] ?? "");
    const categoryId = await getOrCreateCategory(categoryName);

    // Mirror the primary image
    let images: string[] = [];
    if (!NO_IMAGES && !DRY_RUN) {
      const primary = r["Primary Image URL"]?.trim();
      const all = (r["All Image URLs"] ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const sources = all.length ? all : primary ? [primary] : [];
      for (const src of sources.slice(0, 4)) {
        const u = await mirrorImage(src, grimcoId);
        if (u) images.push(u);
      }
    }

    const keyFeatures = (r["Key Features"] ?? "")
      .split(/\s*\|\s*|(?<=\.)\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);

    const resources = (r["PDF / Spec Sheet Links"] ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url, i) => ({
        name: `Resource ${i + 1}`,
        url,
        type: "application/pdf",
      }));

    const productPayload = {
      grimco_id: grimcoId,
      grimco_url: productUrl,
      name: productName,
      slug,
      sku: (r["First SKU"] ?? grimcoId).slice(0, 60),
      category_id: categoryId,
      brand: extractBrand(productName, r["Brand"]),
      description: r["Description"] || null,
      short_description: r["Description"]?.slice(0, 240) ?? null,
      base_price: baseRetail,
      cost_price: baseCost,
      margin_percent: MARGIN_PERCENT,
      images,
      enriched_features: keyFeatures,
      resources,
      variant_dimensions,
      variant_options,
      is_active: true,
      json_source_url: productUrl,
      last_synced: new Date().toISOString(),
    };

    if (DRY_RUN) {
      console.log(
        `  [dry] "${productName}" → ${variants.length} variants, dims=[${variant_dimensions.join(",")}], cost=$${baseCost} → retail=$${baseRetail}, cat="${categoryName}"`,
      );
      ok++;
      totalVariants += variants.length;
      continue;
    }

    try {
      // Look up existing product (and a snapshot of its rich fields).
      const { data: existing } = await supabase
        .from("products")
        .select(
          "id, images, variant_options, base_price, cost_price, description, enriched_features, resources",
        )
        .eq("slug", slug)
        .maybeSingle();

      let productId: string;
      if (existing) {
        /* ---- Preserve-rich logic ---- */
        // Keep whichever images list is longer.
        const existingImages: string[] = (existing.images as string[]) ?? [];
        const finalImages =
          images.length > existingImages.length ? images : existingImages;

        // Keep variant_options if it has MORE colors with swatches than CSV.
        const existingColors =
          (existing.variant_options as Record<string, { value: string; label: string; swatch?: string }[]>)?.color ?? [];
        const newColors = variant_options.color ?? [];
        const existingHasSwatches = existingColors.some((c) => c.swatch);
        const finalVariantOptions =
          existingHasSwatches && existingColors.length > newColors.length
            ? existing.variant_options
            : variant_options;

        // If CSV says cost = 0 (Grimco "login to see price") and we already
        // have a real price + paid variants, leave them alone entirely.
        const csvHasNoPricing = baseCost === 0;
        const existingHasPricing = Number(existing.cost_price ?? 0) > 0;
        const protectExisting = csvHasNoPricing && existingHasPricing;

        if (protectExisting) {
          // Touch only the metadata that's safe to refresh (no variant wipe).
          await supabase
            .from("products")
            .update({
              grimco_id: grimcoId,
              grimco_url: productUrl,
              brand: extractBrand(productName, r["Brand"]),
              description: r["Description"] || existing.description,
              short_description: r["Description"]?.slice(0, 240) ?? null,
              enriched_features:
                keyFeatures.length
                  ? keyFeatures
                  : existing.enriched_features,
              resources:
                resources.length
                  ? resources
                  : existing.resources,
              images: finalImages,
              variant_options: finalVariantOptions,
              category_id: categoryId,
              last_synced: new Date().toISOString(),
            })
            .eq("id", existing.id);
          console.log(
            `↺ ${productName} (preserved — CSV had $0 price; ${variants.length} variants kept)`,
          );
          ok++;
          continue;
        }

        const { error } = await supabase
          .from("products")
          .update({
            ...productPayload,
            images: finalImages,
            variant_options: finalVariantOptions,
          })
          .eq("id", existing.id);
        if (error) throw error;
        productId = existing.id;
        await supabase.from("product_variants").delete().eq("product_id", productId);
      } else {
        const { data: inserted, error } = await supabase
          .from("products")
          .insert(productPayload)
          .select("id")
          .single();
        if (error) throw error;
        productId = inserted.id;
      }

      const variantRows = variants.map((v) => ({
        product_id: productId,
        grimco_sku: v.sku,
        sku: v.sku,
        combination: v.combination,
        cost_price: baseCost,
        price: baseRetail,
        stock_qty: 100,
        is_available: baseCost > 0,
      }));
      for (let i = 0; i < variantRows.length; i += 500) {
        const batch = variantRows.slice(i, i + 500);
        const { error } = await supabase.from("product_variants").insert(batch);
        if (error) throw error;
      }

      console.log(
        `✓ ${productName} (${variants.length} variants, ${images.length} image${images.length === 1 ? "" : "s"})`,
      );
      ok++;
      totalVariants += variants.length;
    } catch (e) {
      failed++;
      console.error(`✗ ${productName}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\nDone: ${ok} products, ${totalVariants.toLocaleString()} variants, ${skipped} skipped, ${failed} failed.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

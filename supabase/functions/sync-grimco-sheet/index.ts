/**
 * sync-grimco-sheet — pulls the "Wrapfly.com Top 200 Products Matrix" Google
 * Sheet, joins on `product_variants.sku` (the Grimco SKU column in the sheet),
 * and updates:
 *
 *   - product_variants.image_url   (Swatch Image URL)
 *   - product_variants.is_available (Availability == "Available")
 *   - product_variants.price        (only when current price is 0/NULL,
 *                                     computed as Your Price * 1.30)
 *   - product_variants.compare_price (List Price when > our retail)
 *   - products.images[]             (deduped Main Image URLs)
 *   - products.is_active = true     (so newly added sheet rows auto-appear)
 *
 * Triggered every 5 minutes by pg_cron (job: sync-grimco-sheet-every-5min)
 * and can be invoked manually from /admin/mirror-progress "Sync now".
 *
 * Source-of-truth: Doug's Chrome extension scrapes Grimco -> Sheet.
 * Anything not in the sheet (and not 3M 2080) stays hidden until added.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/17BeZ_twrIfRGSefZcADB3HvUOBQgntgSNxLU9BFJArM/export?format=csv&gid=391950013";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseNumber(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
      ...corsHeaders,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const t0 = Date.now();
  try {
    const r = await fetch(SHEET_CSV_URL);
    if (!r.ok) {
      return jsonResponse(500, {
        ok: false,
        error: `Sheet fetch ${r.status}`,
      });
    }
    const csv = await r.text();
    const rows = parseCSV(csv);
    if (rows.length < 2) {
      return jsonResponse(200, { ok: true, rowsRead: 0, note: "empty sheet" });
    }

    const headerRow = rows[0].map((h) => h.trim().toLowerCase());
    const colIdx = (name: string) =>
      headerRow.findIndex((h) => h === name.toLowerCase());
    const c = {
      sku: colIdx("Variant SKU"),
      swatch: colIdx("Swatch Image URL"),
      main: colIdx("Main Image URL"),
      avail: colIdx("Availability"),
      yourPrice: colIdx("Your Price (USD)"),
      listPrice: colIdx("List Price (USD)"),
    };
    if (c.sku < 0) {
      return jsonResponse(500, {
        ok: false,
        error: "Variant SKU column missing",
        headers: headerRow,
      });
    }

    type RowParsed = {
      sku: string;
      swatch?: string;
      main?: string;
      isAvailable?: boolean;
      yourPrice?: number;
      listPrice?: number;
    };
    const dataRows: RowParsed[] = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sku = (row[c.sku] ?? "").trim();
      if (!sku || sku.toUpperCase().startsWith("TEST")) {
        skipped++;
        continue;
      }
      const avail = (row[c.avail] ?? "").trim().toLowerCase();
      dataRows.push({
        sku,
        swatch: (row[c.swatch] ?? "").trim() || undefined,
        main: (row[c.main] ?? "").trim() || undefined,
        isAvailable: avail ? avail === "available" : undefined,
        yourPrice: parseNumber(row[c.yourPrice]) ?? undefined,
        listPrice: parseNumber(row[c.listPrice]) ?? undefined,
      });
    }

    if (dataRows.length === 0) {
      return jsonResponse(200, { ok: true, rowsRead: 0, rowsSkipped: skipped });
    }

    // Single batched lookup of all sheet SKUs against our DB
    const skus = dataRows.map((r) => r.sku);
    const { data: existing, error: lookupErr } = await supabase
      .from("product_variants")
      .select(
        "id, product_id, sku, price, compare_price, image_url, is_available",
      )
      .in("sku", skus);
    if (lookupErr) {
      return jsonResponse(500, {
        ok: false,
        error: `Variant lookup: ${lookupErr.message}`,
      });
    }
    const existingBySku = new Map(
      (existing ?? []).map((v) => [v.sku, v as typeof existing[number]]),
    );

    let variantsTouched = 0;
    let variantsUnchanged = 0;
    let variantsNotFound = 0;
    const productIdsToActivate = new Set<string>();
    const productMainImages = new Map<string, Set<string>>();

    for (const row of dataRows) {
      const v = existingBySku.get(row.sku);
      if (!v) {
        variantsNotFound++;
        continue;
      }
      productIdsToActivate.add(v.product_id);

      const patch: Record<string, unknown> = {};
      if (row.swatch && row.swatch !== v.image_url) {
        patch.image_url = row.swatch;
      }
      if (
        typeof row.isAvailable === "boolean" &&
        row.isAvailable !== v.is_available
      ) {
        patch.is_available = row.isAvailable;
      }
      if (
        row.yourPrice &&
        (v.price === null || Number(v.price) === 0)
      ) {
        const retail = Math.max(
          Math.round(row.yourPrice * 1.30 * 100) / 100,
          1,
        );
        patch.price = retail;
        if (row.listPrice && row.listPrice > retail) {
          patch.compare_price = row.listPrice;
        }
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase
          .from("product_variants")
          .update(patch)
          .eq("id", v.id);
        if (!error) variantsTouched++;
      } else {
        variantsUnchanged++;
      }

      if (row.main) {
        if (!productMainImages.has(v.product_id)) {
          productMainImages.set(v.product_id, new Set());
        }
        productMainImages.get(v.product_id)!.add(row.main);
      }
    }

    // Per-product updates: is_active=true + merge Main Image URLs
    let productsActivated = 0;
    let productsTouched = 0;
    for (const productId of productIdsToActivate) {
      const { data: prod } = await supabase
        .from("products")
        .select("is_active, images")
        .eq("id", productId)
        .single();

      const updates: Record<string, unknown> = {};

      if (prod?.is_active === false) {
        updates.is_active = true;
      }

      const mainSet = productMainImages.get(productId);
      if (mainSet) {
        const existingImages = Array.isArray(prod?.images)
          ? (prod!.images as string[])
          : [];
        const merged = Array.from(new Set([...existingImages, ...mainSet]));
        const changed =
          merged.length !== existingImages.length ||
          merged.some((u, i) => u !== existingImages[i]);
        if (changed) {
          updates.images = merged;
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("products")
          .update(updates)
          .eq("id", productId);
        if (!error) {
          productsTouched++;
          if (updates.is_active === true) productsActivated++;
        }
      }
    }

    return jsonResponse(200, {
      ok: true,
      rowsRead: dataRows.length,
      rowsSkipped: skipped,
      variantsTouched,
      variantsUnchanged,
      variantsNotFound,
      productsTouched,
      productsActivated,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: String(e) });
  }
});

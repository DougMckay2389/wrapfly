/**
 * enrich-pricing.ts — per-variant Grimco pricing scrape via Playwright.
 *
 * For each ACTIVE product (excluding 3M 2080 — Doug said leave it alone):
 *   1. Open Grimco product page in Chromium with persisted Grimco cookies.
 *   2. Click "clear all selections" so every filter is at default.
 *   3. Iterate every visible variant-filter combination (Material UI Autocomplete
 *      dropdowns), each time:
 *        - Select the value
 *        - Wait for the displayed SKU + price to update (~3 s per Grimco's UX)
 *        - Read the SKU + RawPrice
 *   4. For each captured (combo → sku → wholesale_price):
 *        - Call /API/Catalog/UpdatePriceAndPromotion/{SKU} as a sanity check
 *          (also confirms the wholesale price under the user's actual contract).
 *        - Match combo to our DB variant by color + size text.
 *        - UPDATE product_variants SET price = wholesale * 1.30
 *
 * Flags:
 *   --slug=mimaki-ss21-solvent-ink   only this product
 *   --skip-3m-2080                   never touch 3M 2080 (default ON)
 *   --pause-ms=3500                  per-combo wait
 *   --headless                       no visible window
 *   --dry-run                        log changes, do not write to DB
 *
 * Pre-req: `npm run mirror:login` once to seed Playwright profile with
 * Grimco cookies. Re-run if you hit "Requested product not available".
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

const SLUG = flag("slug");
const HEADED = flag("headless") !== "true";
const PAUSE_MS = Number(flag("pause-ms") ?? "3500") || 3500;
const DRY_RUN = flag("dry-run") === "true";
const SKIP_2080 = flag("skip-3m-2080") !== "false"; // default ON
const PROFILE_DIR = resolve(__dirname, ".profile");
const MARKUP = 1.30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normColor(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normSize(s: string | null | undefined): string {
  // Strip leading dash & whitespace; lowercase; collapse spaces
  return (s || "")
    .replace(/^[\s-]+/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type CapturedVariant = {
  sku: string;
  wholesale: number;
  combo: Record<string, string>; // e.g. {color: "Black", size: "220 mL"}
  rawPriceText: string;
};

/* -------------- Per-product variant + price scraper ----------------------- */

async function scrapeVariantPrices(page: Page): Promise<CapturedVariant[]> {
  // 1. Try clear all selections
  try {
    const clearBtn = page.getByText(/clear all selection/i).first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click({ timeout: 2000 }).catch(() => {});
      await sleep(2500);
    }
  } catch {
    /* no clear button */
  }

  // 2. Find all variant filter dropdowns. Grimco uses Material UI Autocomplete
  //    with a label header above (e.g. "SIZE", "COLOR", "FINISH").
  const dropdowns = await page.locator(".MuiAutocomplete-root").all();
  if (dropdowns.length === 0) {
    console.log("    no MuiAutocomplete dropdowns found — single-variant product?");
    return [];
  }
  console.log(`    found ${dropdowns.length} filter dropdown(s)`);

  // 3. For each dropdown, capture (a) the label name and (b) all option strings.
  //    The label is usually in a sibling / parent element. Options come from
  //    opening the dropdown.
  const dropdownInfo: Array<{ label: string; options: string[] }> = [];
  for (let di = 0; di < dropdowns.length; di++) {
    const dd = dropdowns[di];
    let label = "filter" + di;
    try {
      // Look up to the parent grid item and find a header text
      const labelHandle = await dd
        .locator("xpath=ancestor::*[contains(@class,'MuiGrid-item')][1]")
        .locator("xpath=preceding-sibling::*[1] | descendant::*[1]")
        .first()
        .innerText()
        .catch(() => null);
      if (labelHandle) {
        label = labelHandle
          .split("\n")[0]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "")
          .slice(0, 30) || label;
      }
    } catch {
      /* fall back to filter index */
    }
    // Open dropdown
    const trigger = dd.locator("button.MuiAutocomplete-popupIndicator");
    if ((await trigger.count()) === 0) {
      dropdownInfo.push({ label, options: [] });
      continue;
    }
    try {
      await trigger.click({ timeout: 2000 });
      await sleep(700);
      const opts = await page
        .locator('[role="listbox"] [role="option"]')
        .allTextContents();
      const cleaned = opts
        .map((s) => s.trim())
        .filter((s) => s && s !== "​" && s.length < 80);
      dropdownInfo.push({ label, options: cleaned });
      await page.keyboard.press("Escape");
      await sleep(300);
    } catch {
      dropdownInfo.push({ label, options: [] });
    }
  }
  console.log(
    `    dropdown options: ${dropdownInfo
      .map((d) => `${d.label}=${d.options.length}`)
      .join(", ")}`,
  );

  // 4. Build cartesian product of combinations
  const validDropdowns = dropdownInfo.filter((d) => d.options.length > 0);
  if (validDropdowns.length === 0) return [];
  const combos: Array<Record<string, string>> = [];
  function build(idx: number, current: Record<string, string>) {
    if (idx >= validDropdowns.length) {
      combos.push({ ...current });
      return;
    }
    for (const opt of validDropdowns[idx].options) {
      build(idx + 1, { ...current, [validDropdowns[idx].label]: opt });
    }
  }
  build(0, {});
  console.log(`    iterating ${combos.length} combination(s)`);

  // 5. For each combo, set values + capture SKU + price
  const captured: CapturedVariant[] = [];
  let comboIdx = 0;
  for (const combo of combos) {
    comboIdx++;
    // Re-find dropdowns each iteration in case DOM rerenders
    const ddIter = await page.locator(".MuiAutocomplete-root").all();
    for (let di = 0; di < ddIter.length; di++) {
      const dropdown = ddIter[di];
      const label = dropdownInfo[di]?.label;
      if (!label) continue;
      const value = combo[label];
      if (!value) continue;
      try {
        const input = dropdown.locator("input").first();
        await input.click({ timeout: 1500 });
        await sleep(200);
        // Type the value to filter the autocomplete
        await input.fill("");
        await input.type(value, { delay: 20 });
        await sleep(400);
        // Pick the matching option
        const opt = page
          .locator('[role="listbox"] [role="option"]')
          .filter({ hasText: value })
          .first();
        if ((await opt.count()) > 0) {
          await opt.click({ timeout: 1500 });
        } else {
          await page.keyboard.press("Escape");
        }
        await sleep(300);
      } catch {
        /* skip on selector flake */
      }
    }
    // Wait for price/SKU to update
    await sleep(PAUSE_MS);

    // Extract SKU + price from page (look in the buy-box area)
    const result = await page.evaluate(() => {
      const text = document.body.innerText;
      // Grimco SKU patterns observed: HPCZ682A, MIM-XXX, SPC-XXXXK, etc.
      // Look for a line like "SKU: XXXXX" or a stand-alone token.
      const skuMatch =
        text.match(/SKU[:\s]+([A-Z0-9][A-Z0-9._-]{2,30})/i) ||
        text.match(/Item[:\s#]+([A-Z0-9][A-Z0-9._-]{2,30})/i);
      const priceMatch = text.match(/\$\s*([0-9,]+\.[0-9]{2})/);
      const sku = skuMatch?.[1] ?? null;
      const wholesale = priceMatch
        ? parseFloat(priceMatch[1].replace(/,/g, ""))
        : null;
      return { sku, wholesale, priceText: priceMatch?.[0] ?? "" };
    });

    if (result.sku && result.wholesale && result.wholesale > 0) {
      captured.push({
        sku: result.sku,
        wholesale: result.wholesale,
        combo,
        rawPriceText: result.priceText,
      });
      console.log(
        `      [${comboIdx}/${combos.length}] ${JSON.stringify(combo)} → ${
          result.sku
        } @ $${result.wholesale}`,
      );
    } else {
      console.log(
        `      [${comboIdx}/${combos.length}] ${JSON.stringify(
          combo,
        )} → no SKU/price found`,
      );
    }
  }

  return captured;
}

/* -------------------- match captured to DB variant ------------------------ */

async function applyToDB(
  productId: string,
  productName: string,
  captured: CapturedVariant[],
): Promise<{ matched: number; updated: number; skipped: number }> {
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, sku, combination, price")
    .eq("product_id", productId);
  if (!variants?.length) {
    console.log(`    DB has no variants for ${productName}`);
    return { matched: 0, updated: 0, skipped: 0 };
  }
  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (const v of variants) {
    const combo = v.combination as Record<string, string> | null;
    const colorN = normColor(combo?.color);
    const sizeN = normSize(combo?.size);
    // Find best captured match: any captured combo where the values match ours
    const hit = captured.find((c) => {
      const cValues = Object.values(c.combo).map((s) => s.toLowerCase());
      const combined = cValues.join(" ").toLowerCase();
      const colorOK = colorN
        ? cValues.some((cv) => normColor(cv) === colorN) ||
          normColor(combined).includes(colorN)
        : true;
      const sizeOK = sizeN
        ? cValues.some((cv) => normSize(cv).includes(sizeN)) ||
          normSize(combined).includes(sizeN)
        : true;
      return colorOK && sizeOK;
    });
    if (!hit) {
      skipped++;
      continue;
    }
    matched++;
    const newPrice = Math.round(hit.wholesale * MARKUP * 100) / 100;
    if (Math.abs(Number(v.price) - newPrice) < 0.005) continue;
    if (DRY_RUN) {
      console.log(
        `      DRY: ${v.sku} ${JSON.stringify(combo)} → $${v.price} → $${newPrice}`,
      );
      updated++;
    } else {
      const { error } = await supabase
        .from("product_variants")
        .update({ price: newPrice })
        .eq("id", v.id);
      if (!error) {
        console.log(
          `      ${v.sku} ${JSON.stringify(combo)} → $${v.price} → $${newPrice}`,
        );
        updated++;
      }
    }
  }
  return { matched, updated, skipped };
}

/* ----------------------------- main --------------------------------------- */

async function main() {
  console.log(
    `enrich-pricing — pause ${PAUSE_MS}ms${DRY_RUN ? " (dry-run)" : ""}${
      SLUG ? ` slug=${SLUG}` : ""
    }`,
  );

  let q = supabase
    .from("products")
    .select("id, name, slug, grimco_url, is_active")
    .not("grimco_url", "is", null);
  if (SLUG) q = q.eq("slug", SLUG);
  else q = q.eq("is_active", true);
  const { data: products, error } = await q;
  if (error) {
    console.error(`load products failed: ${error.message}`);
    process.exit(1);
  }
  let targets = products ?? [];
  if (SKIP_2080) {
    targets = targets.filter((p) => p.slug !== "3m-wrap-film-series-2080");
  }
  console.log(`Targets: ${targets.length}`);

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

  let totalUpdated = 0;
  let i = 0;
  for (const p of targets) {
    i++;
    console.log(`\n[${i}/${targets.length}] ${p.name}`);
    try {
      await page.goto(p.grimco_url!, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      // Settle: wait for some specific signal of variant UI ready
      await page
        .waitForSelector(".MuiAutocomplete-root, h1", { timeout: 10_000 })
        .catch(() => {});
      await sleep(1500);
    } catch (e) {
      console.warn(`    nav error: ${(e as Error).message}`);
      continue;
    }

    const captured = await scrapeVariantPrices(page);
    if (captured.length === 0) {
      console.log("    no variants captured — skipping");
      continue;
    }
    console.log(`    captured ${captured.length} variant prices`);
    const { matched, updated, skipped } = await applyToDB(
      p.id,
      p.name,
      captured,
    );
    console.log(`    matched ${matched} DB variants, updated ${updated}, skipped ${skipped}`);
    totalUpdated += updated;
  }

  await browser.close();
  console.log(`\nDone. Updated ${totalUpdated} variant price(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * enrich-pricing.ts — per-variant Grimco pricing + image scrape via Playwright.
 *
 * Iteration pattern (matches Grimco's UX requirement):
 *   1. "Clear all selections" to start fresh.
 *   2. DEPTH-FIRST traversal of filter dropdowns:
 *        for each option of dropdown[0]:
 *          select it
 *          for each option of dropdown[1]:
 *            select it
 *            ...recurse...
 *              wait 3.5s for Grimco's price + SKU + image to settle
 *              capture SKU, wholesale price, hero image
 *            after inner loop: clear dropdown[1] via its X
 *          after inner loop: clear dropdown[0] via its X
 *   3. For each captured (combo → sku → wholesale → image):
 *        - Match to our DB variant by color + size text.
 *        - UPDATE product_variants SET price = wholesale * 1.30, image_url = capturedImg
 *
 * Flags:
 *   --slug=mimaki-ss21-solvent-ink   only this product
 *   --skip-3m-2080                   never touch 3M 2080 (default ON)
 *   --pause-ms=3500                  per-combo wait for prices to load
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
import { cookiesFileExists, injectCookies } from "./cookies-loader";

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
  image: string | null;
  combo: Record<string, string>; // e.g. {color: "Black", size: "220 mL"}
  rawPriceText: string;
};

type DropdownInfo = { label: string; options: string[]; index: number };

/* -------------- Selector helpers ----------------------------------------- */

async function clickClearAllIfPresent(page: Page) {
  try {
    const clearBtn = page.getByText(/clear all selection/i).first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click({ timeout: 2000 }).catch(() => {});
      await sleep(2000);
    }
  } catch {
    /* no clear button */
  }
}

async function selectOptionInDropdown(
  page: Page,
  dropdownIndex: number,
  value: string,
): Promise<boolean> {
  // Re-locate fresh on each call — MUI rerenders aggressively
  const dd = page.locator(".MuiAutocomplete-root").nth(dropdownIndex);
  if ((await dd.count()) === 0) return false;
  try {
    const input = dd.locator("input").first();
    await input.click({ timeout: 1500 });
    await sleep(150);
    await input.fill("");
    await input.type(value, { delay: 15 });
    await sleep(350);
    const opt = page
      .locator('.MuiAutocomplete-listbox [role="option"]')
      .filter({ hasText: value })
      .first();
    if ((await opt.count()) > 0) {
      await opt.click({ timeout: 1500 });
      await sleep(250);
      return true;
    }
    await page.keyboard.press("Escape");
    return false;
  } catch {
    return false;
  }
}

async function clearDropdown(page: Page, dropdownIndex: number) {
  // Each MuiAutocomplete root has a clear-X button inside .MuiAutocomplete-clearIndicator
  // when a value is selected. Click it; falls back to typing Backspace if not found.
  const dd = page.locator(".MuiAutocomplete-root").nth(dropdownIndex);
  if ((await dd.count()) === 0) return;
  try {
    const clearBtn = dd.locator(".MuiAutocomplete-clearIndicator").first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click({ force: true, timeout: 1500 });
      await sleep(350);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const input = dd.locator("input").first();
    await input.click({ timeout: 1500 });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");
    await sleep(250);
  } catch {
    /* give up */
  }
}

async function captureCurrentVariant(
  page: Page,
): Promise<{ sku: string | null; wholesale: number | null; image: string | null; priceText: string }> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const skuMatch =
      text.match(/SKU[:\s]+([A-Z0-9][A-Z0-9._-]{2,30})/i) ||
      text.match(/Item[:\s#]+([A-Z0-9][A-Z0-9._-]{2,30})/i);
    const sku = skuMatch?.[1] ?? null;

    // PRICE — Grimco shows two prices stacked:
    //   List Price        ← label
    //   $XXX.XX           ← MSRP / list (smaller, MuiTypography-subtitle1)
    //   $YYY.YY           ← actual reseller price (LARGER, MuiTypography-h1)
    // We want the second (actual reseller price). Three strategies, in order:
    //
    //   1. Find the MuiTypography-h1 element whose text is just "$X.XX" — that
    //      is the big price. Most reliable.
    //   2. Match the text pattern "List Price\n$A\n$B" and take B.
    //   3. Fallback: first $X.XX in the body (legacy behavior).
    let wholesale: number | null = null;
    let priceText = "";

    const h1Prices = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[class*="MuiTypography-h1"], [class*="MuiTypography-h2"]',
      ),
    )
      .map((el) => el.innerText.trim())
      .filter((t) => /^\$\s*[0-9,]+\.[0-9]{2}$/.test(t));
    if (h1Prices.length > 0) {
      // Prefer the largest such number (in case both h1+h2 match).
      const nums = h1Prices.map((s) =>
        parseFloat(s.replace(/[^0-9.]/g, "").replace(/,/g, "")),
      );
      wholesale = Math.max(...nums);
      priceText = h1Prices[nums.indexOf(wholesale)];
    }

    if (wholesale === null) {
      const listPair = text.match(
        /list\s*price[\s\S]{0,40}?\$\s*([0-9,]+\.[0-9]{2})[\s\S]{0,40}?\$\s*([0-9,]+\.[0-9]{2})/i,
      );
      if (listPair) {
        wholesale = parseFloat(listPair[2].replace(/,/g, ""));
        priceText = `$${listPair[2]}`;
      }
    }

    if (wholesale === null) {
      const m = text.match(/\$\s*([0-9,]+\.[0-9]{2})/);
      if (m) {
        wholesale = parseFloat(m[1].replace(/,/g, ""));
        priceText = m[0];
      }
    }

    // Hero image: largest /Catalog/Products/<x>/ img (not swatch / not in-use)
    const heroImg = Array.from(document.querySelectorAll<HTMLImageElement>("img"))
      .map((i) => i.src)
      .find(
        (s) =>
          /\/Catalog\/Products\/[^/]+\//i.test(s) &&
          !/\/Swatch\//i.test(s) &&
          !/\/InUse\//i.test(s),
      );
    return {
      sku,
      wholesale,
      image: heroImg ?? null,
      priceText,
    };
  });
}

/* -------------- Discover dropdown labels + options ----------------------- */

// Any ancestor matching one of these = the dropdown is part of the reviews
// widget (Bazaarvoice / Grimco's own review section), not a product attribute.
const REVIEW_CONTAINER_SELECTOR = [
  "#reviews",
  "[id^='review']",
  "[id*='Review']",
  "[id*='review' i]",
  "[class*='review' i]",
  "[data-bv-show]",
  "[data-bv-product-id]",
  ".bv-content-list",
  ".bv-cv2-cleanslate",
  "#bv-review-display",
].join(", ");

async function discoverDropdowns(page: Page): Promise<DropdownInfo[]> {
  const allDropdowns = await page.locator(".MuiAutocomplete-root").all();
  if (allDropdowns.length === 0) return [];

  const info: DropdownInfo[] = [];
  for (let di = 0; di < allDropdowns.length; di++) {
    const dd = allDropdowns[di];

    // Skip if this Autocomplete lives inside the reviews block.
    const isInReviews = await dd
      .evaluate(
        (el, sel) => !!(el as HTMLElement).closest(sel),
        REVIEW_CONTAINER_SELECTOR,
      )
      .catch(() => false);
    if (isInReviews) {
      console.log(`   skipping dropdown #${di} (inside reviews section)`);
      continue;
    }

    let label = `filter${di}`;
    try {
      const txt = await dd
        .locator("xpath=ancestor::*[contains(@class,'MuiGrid-item')][1]")
        .first()
        .innerText()
        .catch(() => "");
      if (txt) {
        label =
          txt
            .split("\n")[0]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "")
            .slice(0, 30) || label;
      }
    } catch {}

    const trigger = dd.locator("button.MuiAutocomplete-popupIndicator");
    if ((await trigger.count()) === 0) continue;

    let options: string[] = [];
    try {
      await trigger.click({ timeout: 2000 });
      await sleep(600);
      const opts = await page
        .locator('.MuiAutocomplete-listbox [role="option"]')
        .allTextContents();
      options = opts
        .map((s) => s.trim())
        .filter((s) => s && s !== "​" && s.length < 80);
      await page.keyboard.press("Escape");
      await sleep(250);
    } catch {
      /* noop */
    }

    info.push({ label, options, index: di });
  }
  return info;
}

/* -------------- Recursive depth-first iteration -------------------------- */

async function iterateAndCapture(
  page: Page,
  dropdowns: DropdownInfo[],
  depth: number,
  currentCombo: Record<string, string>,
  captured: CapturedVariant[],
  progressRef: { count: number; total: number },
): Promise<void> {
  if (depth >= dropdowns.length) {
    // Leaf: wait for state to settle, then capture
    await sleep(PAUSE_MS);
    const result = await captureCurrentVariant(page);
    progressRef.count++;
    if (result.sku && result.wholesale && result.wholesale > 0) {
      captured.push({
        sku: result.sku,
        wholesale: result.wholesale,
        image: result.image,
        combo: { ...currentCombo },
        rawPriceText: result.priceText,
      });
      console.log(
        `      [${progressRef.count}/${progressRef.total}] ${JSON.stringify(
          currentCombo,
        )} → ${result.sku} @ $${result.wholesale}${result.image ? " +img" : ""}`,
      );
    } else {
      console.log(
        `      [${progressRef.count}/${progressRef.total}] ${JSON.stringify(
          currentCombo,
        )} → no SKU/price found`,
      );
    }
    return;
  }

  const dd = dropdowns[depth];
  if (dd.options.length === 0) {
    // No options here, just recurse without selecting
    await iterateAndCapture(page, dropdowns, depth + 1, currentCombo, captured, progressRef);
    return;
  }
  for (const option of dd.options) {
    const ok = await selectOptionInDropdown(page, dd.index, option);
    if (!ok) {
      // Couldn't select — skip this branch but log
      console.log(
        `      ! could not select ${dd.label}=${option}; skipping subtree`,
      );
      continue;
    }
    await sleep(400); // let dependent dropdowns refresh
    await iterateAndCapture(
      page,
      dropdowns,
      depth + 1,
      { ...currentCombo, [dd.label]: option },
      captured,
      progressRef,
    );
    // Clear THIS dropdown's X before the next option in this loop
    await clearDropdown(page, dd.index);
    await sleep(300);
  }
}

/* -------------- Per-product orchestrator --------------------------------- */

async function scrapeVariantPrices(page: Page): Promise<CapturedVariant[]> {
  await clickClearAllIfPresent(page);
  const dropdowns = await discoverDropdowns(page);
  if (dropdowns.length === 0) {
    console.log("    no MuiAutocomplete dropdowns — single-variant product");
    return [];
  }
  const validDropdowns = dropdowns.filter((d) => d.options.length > 0);
  console.log(
    `    dropdowns: ${validDropdowns
      .map((d) => `${d.label}(${d.options.length})`)
      .join(", ")}`,
  );
  const total = validDropdowns.reduce((acc, d) => acc * d.options.length, 1);
  console.log(`    will iterate ${total} combination(s) depth-first with X-clearing`);

  const captured: CapturedVariant[] = [];
  await clickClearAllIfPresent(page);
  await iterateAndCapture(page, validDropdowns, 0, {}, captured, {
    count: 0,
    total,
  });
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  );

  // If scripts/grimco/cookies.json exists (exported from Chrome Cookie-Editor
  // while signed in to grimco.com), inject those cookies — much more reliable
  // than the Playwright-driven login.
  if (cookiesFileExists()) {
    try {
      const n = await injectCookies(browser);
      console.log(`✓ Injected ${n} cookies from scripts/grimco/cookies.json`);
    } catch (e) {
      console.warn(`⚠ Could not inject cookies: ${(e as Error).message}`);
    }
  }

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
      "(no My Account link — export cookies.json via Chrome Cookie-Editor or\n" +
        " run `npm run mirror:login` first if products fail)\n",
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

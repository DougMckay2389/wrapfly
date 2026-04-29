/**
 * Grimco scraper — Playwright-driven catalog harvester.
 *
 * Runs locally on your Mac. Uses a persistent Chrome profile so you log into
 * Grimco once (in the visible browser window the script opens) and that
 * session is reused on every subsequent run.
 *
 * Usage:
 *   npx tsx scripts/grimco/scrape.ts                    # Use default seed URLs
 *   npx tsx scripts/grimco/scrape.ts --headed           # Show browser (default)
 *   npx tsx scripts/grimco/scrape.ts --headless         # Headless (after first login)
 *   npx tsx scripts/grimco/scrape.ts --seed=https://... # Custom seed URL
 *   npx tsx scripts/grimco/scrape.ts --limit=10         # Stop after N products
 *   npx tsx scripts/grimco/scrape.ts --resume           # Skip already-scraped products
 *
 * Output:
 *   scripts/grimco/output/products.json   — full product + variant data
 *   scripts/grimco/output/urls.json       — discovered product URLs (for resume)
 *   scripts/grimco/output/errors.log      — any errors that occurred
 *   scripts/grimco/.profile/              — persistent Chrome profile (gitignored)
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const ROOT = resolve(__dirname);
const OUT_DIR = resolve(ROOT, "output");
const PROFILE_DIR = resolve(ROOT, ".profile");
const URLS_FILE = resolve(OUT_DIR, "urls.json");
const PRODUCTS_FILE = resolve(OUT_DIR, "products.json");
const ERRORS_FILE = resolve(OUT_DIR, "errors.log");

const DEFAULT_SEEDS = [
  "https://www.grimco.com/catalog/category/automotivefilms",
];

const args = process.argv.slice(2);
const flag = (name: string, dflt: string | null = null) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  if (a) return a.split("=").slice(1).join("=");
  if (args.includes(`--${name}`)) return "true";
  return dflt;
};

const HEADED = flag("headless") !== "true";
const LIMIT = Number(flag("limit") ?? "0") || 0;
const RESUME = flag("resume") === "true";
const SKIP_CRAWL = flag("skip-crawl") === "true";
const SEEDS = (flag("seed")?.split(",") ?? DEFAULT_SEEDS).map((s) => s.trim());

// Pacing config — all in milliseconds. Defaults are tuned to NOT trip
// Grimco's anti-bot heuristics. If you've been blocked, double these.
const PRODUCT_PAUSE_MS = Number(flag("pause-ms") ?? "5000") || 5000;
const CLICK_PAUSE_MS = Number(flag("click-pause-ms") ?? "900") || 900;
const CRAWL_PAUSE_MS = Number(flag("crawl-pause-ms") ?? "2500") || 2500;

/** Sleep for `ms` ± up to 25% jitter so timing doesn't look mechanical. */
function jitter(ms: number): number {
  return Math.floor(ms * (0.75 + Math.random() * 0.5));
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type DimensionOption = { value: string; label: string };
type Variant = {
  sku: string | null;
  combination: Record<string, string>;
  cost_price: number | null;
  stock_qty: number | null;
  in_stock: boolean;
};

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
  variants: Variant[];
  scraped_at: string;
  source: "grimco";
};

/* -------------------------------------------------------------------------- */
/* Logging                                                                    */
/* -------------------------------------------------------------------------- */

const log = (...m: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...m);
const errLog = async (msg: string, err?: unknown) => {
  const line = `[${new Date().toISOString()}] ${msg}${err ? ` :: ${(err as Error).message ?? err}` : ""}\n`;
  console.error(line.trim());
  await appendFile(ERRORS_FILE, line).catch(() => {});
};

/* -------------------------------------------------------------------------- */
/* Crawler — discover product URLs from category seeds                        */
/* -------------------------------------------------------------------------- */

async function discoverProductUrls(page: Page): Promise<string[]> {
  const seen = new Set<string>();
  const productUrls = new Set<string>();
  const queue = [...SEEDS];

  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      log(`crawl  ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      // Polite pause between crawl page loads so Grimco doesn't flag us.
      await page.waitForTimeout(jitter(CRAWL_PAUSE_MS));

      // Pull all anchors. Filter to products + sub-categories.
      const links: string[] = await page.$$eval("a[href]", (as) =>
        as
          .map((a) => (a as HTMLAnchorElement).href)
          .filter(
            (h) =>
              h.includes("/catalog/products/") ||
              h.includes("/catalog/category/"),
          ),
      );

      for (const href of links) {
        try {
          const u = new URL(href, "https://www.grimco.com");
          // Strip query/hash AND trailing slash so /foo and /foo/ dedupe.
          u.search = "";
          u.hash = "";
          let clean = u.toString().toLowerCase();
          if (clean.endsWith("/")) clean = clean.slice(0, -1);
          if (clean.includes("/catalog/products/")) {
            productUrls.add(clean);
          } else if (
            clean.includes("/catalog/category/") &&
            SEEDS.some((s) => {
              let seed = s.toLowerCase().split("?")[0].split("#")[0];
              if (seed.endsWith("/")) seed = seed.slice(0, -1);
              return clean.startsWith(seed);
            })
          ) {
            queue.push(clean);
          }
        } catch {
          /* malformed URL, skip */
        }
      }
    } catch (e) {
      await errLog(`crawl failed ${url}`, e);
    }
  }

  return Array.from(productUrls).sort();
}

/* -------------------------------------------------------------------------- */
/* Per-product scrape                                                          */
/* -------------------------------------------------------------------------- */

async function scrapeProduct(
  page: Page,
  url: string,
): Promise<ScrapedProduct | null> {
  log(`scrape ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Detect a captcha / block / login wall.
  const blockSignals = await page.evaluate(() => {
    const t = document.body.innerText.slice(0, 4000).toLowerCase();
    const title = document.title.toLowerCase();
    return {
      title: document.title,
      hasProductJsonLd: !!document.querySelector(
        'script[type="application/ld+json"]',
      ),
      hasSelectAnOption: /select an option/i.test(t),
      hasPriceText: /\$\d/.test(t),
      looksBlocked:
        /access denied|forbidden|please verify|bot detection|cloudflare|recaptcha|are you a robot|unusual traffic/i.test(
          t + " " + title,
        ),
    };
  });

  if (blockSignals.looksBlocked) {
    await errLog(
      `BLOCKED on ${url} — title="${blockSignals.title}". Wait a few minutes, then re-run with --resume.`,
    );
    return null;
  }
  if (!blockSignals.hasProductJsonLd) {
    await errLog(
      `no Product JSON-LD on ${url} — title="${blockSignals.title}", hasSelectAnOption=${blockSignals.hasSelectAnOption}`,
    );
    return null;
  }

  const meta = await extractMetadata(page);
  if (!meta) {
    await errLog(`extractMetadata returned null for ${url}`);
    return null;
  }
  log(
    `  meta ok — name="${meta.name.slice(0, 60)}", brand=${meta.brand}, hasPickers=${blockSignals.hasSelectAnOption}`,
  );

  const dims = await extractDimensions(page);
  log(
    `  dims found: ${dims.dimensions.length}${
      dims.dimensions.length
        ? ` (${dims.dimensions
            .map((d) => `${d}=${dims.options[d].length}`)
            .join(", ")})`
        : ""
    }`,
  );

  // Build cartesian product of options for this product.
  const combos = cartesian(
    dims.dimensions.map((d) =>
      dims.options[d].map((o) => ({ dim: d, opt: o })),
    ),
  );

  const variants: Variant[] = [];
  if (combos.length === 0) {
    // Single-SKU product (no variant axes); read price directly.
    const single = await readPriceAndSku(page);
    if (single) variants.push({ ...single, combination: {} });
  } else {
    log(`  ${combos.length} variant combinations to test`);
    let validCount = 0;
    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];
      const comboKey = combo.map((c) => `${c.dim}=${c.opt.value}`).join(", ");
      try {
        const selected = await selectCombination(page, combo);
        if (!selected) {
          // Selection silently rejected — Grimco doesn't carry this combo.
          variants.push({
            sku: null,
            combination: Object.fromEntries(
              combo.map((c) => [c.dim, c.opt.value]),
            ),
            cost_price: null,
            stock_qty: null,
            in_stock: false,
          });
          continue;
        }
        const v = await readPriceAndSku(page);
        if (v && v.cost_price != null) {
          validCount++;
          variants.push({
            ...v,
            combination: Object.fromEntries(
              combo.map((c) => [c.dim, c.opt.value]),
            ),
          });
        } else {
          variants.push({
            sku: null,
            combination: Object.fromEntries(
              combo.map((c) => [c.dim, c.opt.value]),
            ),
            cost_price: null,
            stock_qty: null,
            in_stock: false,
          });
        }
      } catch (e) {
        await errLog(`variant ${url} ${comboKey}`, e);
      }
      // Progress every 10 combos.
      if ((i + 1) % 10 === 0) {
        log(`    ${i + 1}/${combos.length} (${validCount} priced)`);
      }
      // Rate-limit between selections so Grimco doesn't throttle us.
      await page.waitForTimeout(250);
    }
    log(`  ${validCount}/${combos.length} valid combinations priced`);
  }

  return {
    grimco_url: url,
    grimco_id: meta.grimco_id,
    name: meta.name,
    brand: meta.brand,
    description: meta.description,
    images: meta.images,
    category_path: meta.category_path,
    specifications: meta.specifications,
    variant_dimensions: dims.dimensions,
    variant_options: dims.options,
    variants,
    scraped_at: new Date().toISOString(),
    source: "grimco",
  };
}

/* ---------------------------- metadata ----------------------------------- */

async function extractMetadata(page: Page) {
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
      (l) => l && (l["@type"] === "Product" || l["@type"]?.includes?.("Product")),
    );
    if (!product) return null;

    const breadcrumb = lds.find(
      (l) => l && (l["@type"] === "BreadcrumbList" || l["@type"]?.includes?.("BreadcrumbList")),
    );

    const props = Array.isArray(product.additionalProperty)
      ? product.additionalProperty.map((p: { name: string; value: string }) => ({
          label: p.name,
          value: String(p.value),
        }))
      : [];

    const path = Array.isArray(breadcrumb?.itemListElement)
      ? breadcrumb.itemListElement
          .map((it: { name: string }) => it.name)
          .filter((n: string) => n && n !== "Home")
          .slice(0, -1) // drop the product name itself
      : [];

    // Try to derive an internal Grimco id from the productId param if any meta tag exposes it
    const productIdMeta = document.querySelector('meta[name="product-id"]')?.getAttribute("content");
    const slug = location.pathname.split("/").pop() ?? "";

    const heroImg = product.image
      ? Array.isArray(product.image)
        ? product.image
        : [product.image]
      : [];

    // Add gallery images visible on the page.
    const galleryImgs = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        '[class*="image-gallery"] img, [class*="ImageGallery"] img, [class*="MainImage"] img, .product-image img',
      ),
    )
      .map((i) => i.src)
      .filter((s) => /^https?:/.test(s));

    return {
      grimco_id: productIdMeta || slug,
      name: product.name ?? "",
      brand: product.brand?.name ?? null,
      description: product.description ?? null,
      images: Array.from(new Set([...heroImg, ...galleryImgs])).slice(0, 12),
      category_path: path as string[],
      specifications: props,
    };
  });
}

/* -------------------------- dimension discovery -------------------------- */
/*
 * Grimco's variant pickers are MUI v5 Autocomplete components. The trigger
 * is a div containing "Select an option" text; clicking it opens a portal
 * with options that have id="<DimensionName>-option-N" (e.g. "Size-option-3",
 * "Core-Size-option-0", "Color-option-12"). The dimension name we capture
 * is exactly the prefix from the option id, so it survives whatever Grimco
 * names the picker in the UI.
 */

async function extractDimensions(page: Page): Promise<{
  dimensions: string[];
  triggerLabels: Record<string, string>;
  options: Record<string, DimensionOption[]>;
}> {
  // Step 1 — find every dropdown trigger on the page. Grimco renders these
  // BEFORE the user clicks them, with a "Select an option" placeholder.
  const triggers = await page.$$eval('div, span, button', (els) => {
    const results: Array<{
      labelText: string;
      triggerSelector: string;
    }> = [];
    const all = els as HTMLElement[];
    for (const el of all) {
      const txt = (el.textContent ?? "").trim();
      // Find leaf-ish nodes whose direct text is "Select an option".
      // Avoid matching deep ancestors that contain the whole page.
      if (txt === "Select an option" && el.children.length <= 2) {
        // Walk up to find the labelled container — usually the dimension
        // name (SIZE, CORE SIZE, COLOR, ...) sits as a sibling/parent
        // heading just above the picker.
        let cursor: HTMLElement | null = el;
        let labelText = "";
        for (let i = 0; i < 6 && cursor; i++) {
          const heading = cursor.querySelector<HTMLElement>(
            'h2, h3, h4, h5, label, [class*="label" i], [class*="title" i]',
          );
          if (heading && heading !== el && heading.contains(el) === false) {
            const t = heading.textContent?.trim();
            if (t && t.length < 60 && t !== "Select an option") {
              labelText = t;
              break;
            }
          }
          cursor = cursor.parentElement;
        }
        // Build a stable selector for this trigger so we can re-find it later.
        let selector = "";
        const id = el.id;
        if (id) selector = `#${CSS.escape(id)}`;
        else {
          // Synthesize a uniquely-identifying chain.
          let node: HTMLElement | null = el;
          const chain: string[] = [];
          while (node && chain.length < 5 && node !== document.body) {
            const i = Array.from(node.parentElement?.children ?? []).indexOf(node);
            chain.unshift(`${node.tagName.toLowerCase()}:nth-child(${i + 1})`);
            node = node.parentElement;
          }
          selector = chain.join(" > ");
        }
        results.push({ labelText, triggerSelector: selector });
      }
    }
    return results;
  });

  // Step 2 — pop each one open in turn, harvest its options by id prefix.
  const dimensions: string[] = [];
  const triggerLabels: Record<string, string> = {};
  const options: Record<string, DimensionOption[]> = {};
  const seenDims = new Set<string>();

  for (const trig of triggers) {
    try {
      const handle = await page.$(trig.triggerSelector);
      if (!handle) continue;
      await handle.scrollIntoViewIfNeeded();
      await handle.click();
      await page.waitForTimeout(450);

      // Read all visible options. Grimco renders them with id="<Dim>-option-N".
      const found = await page.evaluate(() => {
        const out: Record<string, Array<{ id: string; text: string; disabled: boolean }>> = {};
        for (const node of Array.from(
          document.querySelectorAll<HTMLElement>('[id*="-option-"]'),
        )) {
          const m = node.id.match(/^(.+?)-option-\d+$/i);
          if (!m) continue;
          const dim = m[1];
          const text = node.textContent?.trim() ?? "";
          if (!text) continue;
          const disabled =
            node.getAttribute("aria-disabled") === "true" ||
            node.classList.contains("Mui-disabled") ||
            getComputedStyle(node).pointerEvents === "none";
          (out[dim] ??= []).push({ id: node.id, text, disabled });
        }
        return out;
      });

      for (const [dimRaw, optRaws] of Object.entries(found)) {
        if (seenDims.has(dimRaw)) continue;
        // Filter out duplicates that come from previously-opened pickers.
        const opts = optRaws
          .map((o) => ({ value: o.text, label: o.text }))
          .filter(
            (o, i, arr) => arr.findIndex((x) => x.value === o.value) === i,
          );
        if (opts.length) {
          seenDims.add(dimRaw);
          dimensions.push(dimRaw);
          options[dimRaw] = opts;
          triggerLabels[dimRaw] = trig.labelText || dimRaw.replace(/-/g, " ");
        }
      }
      // Close the picker before opening the next one.
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    } catch {
      /* skip on error */
    }
  }

  return { dimensions, triggerLabels, options };
}

/* ------------------------- chip-clearing --------------------------------- */
/**
 * Empties every selected filter chip on the page. Grimco's pickers are
 * filter-style — a selected option appears as a chip with a tiny × button
 * (and there's also a "Clear all selections" link). Order of operations:
 *   1. Click every visible × button.
 *   2. Click "Clear all selections" if still present.
 *   3. If neither worked, page-reload as a last resort.
 *
 * Returns true when no chips remain.
 */
async function clearAllChips(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Pass 1 — click every per-chip × button we can find.
    await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], svg[class*="close" i], svg[class*="clear" i]',
        ),
      );
      for (const btn of candidates) {
        const aria = (btn.getAttribute("aria-label") ?? "").toLowerCase();
        const cls = btn.className?.toString().toLowerCase() ?? "";
        const txt = (btn.textContent ?? "").trim();
        const isCloseLike =
          /remove|close|clear|deselect/.test(aria) ||
          /\bclose\b|\bclear\b|\bremove\b/.test(cls) ||
          txt === "×" ||
          txt === "✕" ||
          txt === "x" ||
          !!btn.querySelector('svg[class*="close" i], svg[data-testid*="close" i]');
        // Only click chip-removers — skip e.g. modal close buttons by
        // requiring the element to be inside a chip-like container.
        if (isCloseLike) {
          const parent = btn.closest('[class*="chip" i], [class*="tag" i], [class*="filter" i], [class*="selection" i]');
          if (parent) (btn as HTMLElement).click();
        }
      }
    });
    await page.waitForTimeout(250);

    // Pass 2 — fallback to "Clear all selections" link.
    await page.evaluate(() => {
      const link = Array.from(
        document.querySelectorAll<HTMLElement>("a, button, span"),
      ).find((el) => /clear\s+all/i.test(el.textContent ?? ""));
      if (link) link.click();
    });
    await page.waitForTimeout(250);

    // Verify: any chip-like element still showing?
    const stillHas = await page.evaluate(() => {
      const chips = Array.from(
        document.querySelectorAll(
          '[class*="chip" i], [class*="tag" i], [class*="filter" i] [class*="selected" i]',
        ),
      );
      return chips.length;
    });
    if (stillHas === 0) return true;
  }

  // Last resort — reload the page so all selections clear.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  return true;
}

/* ----------------------- combination selection --------------------------- */

/**
 * Selects a combination by clicking each dimension's picker, then its target
 * option, in order. Verifies each click took (the trigger element should now
 * show the option's text instead of "Select an option") — if not, we treat
 * the combination as invalid (Grimco silently rejects impossible combos).
 *
 * Returns true if every dimension landed; false if any selection got
 * dropped (which means this combo is unavailable).
 */
async function selectCombination(
  page: Page,
  combo: Array<{ dim: string; opt: DimensionOption }>,
): Promise<boolean> {
  // Grimco's pickers behave as filter chips, not traditional <select>s —
  // each selected option becomes a chip with its own little × button.
  // Clear ALL of them before each combo iteration so selections never
  // leak from the previous combo.
  await clearAllChips(page);

  for (const { dim, opt } of combo) {
    const ok = await page.evaluate(
      ({ dim, value }) => {
        const target = Array.from(
          document.querySelectorAll<HTMLElement>('[id*="-option-"]'),
        ).find(
          (n) =>
            n.id.startsWith(`${dim}-option-`) &&
            n.textContent?.trim() === value,
        );
        if (!target) return false;
        target.scrollIntoView({ block: "center" });
        // Some MUI options need a synthetic mousedown+click to fire the
        // change handler properly.
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        target.click();
        return true;
      },
      { dim, value: opt.value },
    );
    if (!ok) return false;
    // Give Grimco a beat to validate the combination + propagate constraints
    // to the OTHER pickers (some options narrow what's still selectable).
    await page.waitForTimeout(jitter(CLICK_PAUSE_MS));
  }

  return true;
}

/* --------------------------- price + sku --------------------------------- */
/**
 * Wait up to 5s for either:
 *   - a real $X,XXX.XX price to appear in the buy-box
 *   - "Out of stock" / "Unavailable" / "No price" wording (combo invalid)
 * Returns parsed price + SKU + stock signal. Returns null if the combo
 * is invalid — caller will record the variant as `in_stock: false`.
 */
async function readPriceAndSku(page: Page) {
  // Wait for either price or "unavailable" wording.
  const settled = await page
    .waitForFunction(
      () => {
        const txt = document.body.innerText;
        // Skip the placeholder copy "Select required options to view pricing".
        if (/select\s+required\s+options/i.test(txt)) return false;
        return (
          /\$\d[\d,]*\.\d{2}/.test(txt) ||
          /out of stock|unavailable|no longer available|currently not available/i.test(txt)
        );
      },
      { timeout: 5_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!settled) return null;

  return page.evaluate(() => {
    // Restrict price search to the buy-box / right column. We try a few
    // common containers, then fall back to first-match-on-page.
    const buyBoxRoot =
      document.querySelector('[class*="buybox" i]') ??
      document.querySelector('[class*="ProductInfo" i]') ??
      document.querySelector('[class*="addToCart" i]')?.parentElement ??
      document.body;

    const txt = (buyBoxRoot as HTMLElement).innerText ?? "";

    if (/select\s+required\s+options/i.test(txt)) return null;

    if (/out of stock|unavailable|no longer available|currently not available/i.test(txt)) {
      return { sku: null, cost_price: null, stock_qty: 0, in_stock: false };
    }

    const priceMatch = txt.match(/\$([0-9,]+\.\d{2})/);
    const cost_price = priceMatch
      ? Number(priceMatch[1].replace(/,/g, ""))
      : null;
    if (cost_price === null) return null;

    const skuMatch =
      txt.match(/SKU\s*[:#]?\s*([A-Z0-9._-]+)/i) ??
      txt.match(/Item\s*[:#]?\s*([A-Z0-9._-]+)/i) ??
      txt.match(/Part\s*[:#]?\s*([A-Z0-9._-]+)/i);
    const sku = skuMatch ? skuMatch[1] : null;

    const stockMatch = txt.match(/(\d+)\s*(?:in stock|available)/i);
    const stock_qty = stockMatch ? Number(stockMatch[1]) : null;

    return { sku, cost_price, stock_qty, in_stock: true };
  });
}

/* ----------------------------- helpers ----------------------------------- */

function cartesian<T>(arrays: T[][]): T[][] {
  if (!arrays.length) return [];
  return arrays.reduce<T[][]>(
    (acc, arr) =>
      acc.flatMap((a) => arr.map((x) => [...a, x])),
    [[]],
  );
}

/* --------------------------------- main --------------------------------- */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });

  const browser: BrowserContext = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: !HEADED,
      viewport: { width: 1280, height: 900 },
      // Set this UA so Grimco doesn't think we're a bot.
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
    },
  );
  const page = browser.pages()[0] ?? (await browser.newPage());

  // First-run login wait.
  log("Visit grimco.com and sign in (this window stays open until you sign in).");
  await page.goto("https://www.grimco.com/", { waitUntil: "domcontentloaded" });
  // Wait until "My Account" is visible in the header.
  try {
    await page.getByText(/My Account/i).first().waitFor({ timeout: 180_000 });
    log("✓ Authenticated.");
  } catch {
    log(
      "Could not detect login within 3 minutes — continuing anyway. " +
        "If pricing fails, sign in and rerun.",
    );
  }

  /* ------------------------ Phase 1 — discover URLs ----------------------- */
  let productUrls: string[] = [];
  if ((RESUME || SKIP_CRAWL) && existsSync(URLS_FILE)) {
    productUrls = JSON.parse(await readFile(URLS_FILE, "utf8"));
    log(`reuse: loaded ${productUrls.length} product URLs from ${URLS_FILE}`);
  } else {
    productUrls = await discoverProductUrls(page);
    await writeFile(URLS_FILE, JSON.stringify(productUrls, null, 2));
    log(`✓ Discovered ${productUrls.length} product URLs → ${URLS_FILE}`);
  }
  if (LIMIT) productUrls = productUrls.slice(0, LIMIT);

  /* ------------------------ Phase 2 — scrape products --------------------- */
  let existing: ScrapedProduct[] = [];
  if (RESUME && existsSync(PRODUCTS_FILE)) {
    try {
      existing = JSON.parse(await readFile(PRODUCTS_FILE, "utf8"));
      log(`resume: ${existing.length} products already scraped`);
    } catch {
      existing = [];
    }
  }
  const done = new Set(existing.map((p) => p.grimco_url));

  const out: ScrapedProduct[] = [...existing];
  for (let i = 0; i < productUrls.length; i++) {
    const url = productUrls[i];
    if (done.has(url)) {
      log(`skip   ${i + 1}/${productUrls.length} (cached) ${url}`);
      continue;
    }
    log(`product ${i + 1}/${productUrls.length}`);
    try {
      const product = await scrapeProduct(page, url);
      if (product) {
        out.push(product);
        // Flush every 5 products so we don't lose work on crash.
        if (out.length % 5 === 0) {
          await writeFile(PRODUCTS_FILE, JSON.stringify(out, null, 2));
        }
      }
    } catch (e) {
      await errLog(`product failed ${url}`, e);
    }
    // Rate-limit between products. Default 5s + jitter; adjust via --pause-ms=N.
    await page.waitForTimeout(jitter(PRODUCT_PAUSE_MS));
  }

  await writeFile(PRODUCTS_FILE, JSON.stringify(out, null, 2));
  log(`✓ Wrote ${out.length} products → ${PRODUCTS_FILE}`);
  await browser.close();
}

main().catch(async (e) => {
  await errLog("fatal", e);
  process.exit(1);
});

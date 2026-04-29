# Grimco Scraper + Importer

Local-only tools that pull product data from your Grimco reseller account and
import it into your Wrapfly Supabase database with your retail markup applied.

## What you get

- **`scrape.ts`** — Playwright-driven crawler. Logs into Grimco once (you sign
  in to a real Chrome window the script opens), then walks the Automotive
  Films category, finds every product, and for each product iterates every
  variant combination (size × core size, size × color, etc.) to capture SKU,
  cost price, and stock availability.
- **`import.ts`** — Reads the scraper's output JSON, applies your margin
  (default **30%**), and upserts products + variants into Supabase. Re-runs
  are idempotent — products match on `grimco_id`, variants on `grimco_sku`.

## One-time setup

```bash
cd ~/Documents/wrapfly

# 1. Install Playwright + Chromium browser binaries
npm install
npx playwright install chromium

# 2. Confirm SUPABASE_SERVICE_ROLE_KEY is in .env.local
grep SUPABASE_SERVICE_ROLE_KEY .env.local
```

## Run the scraper

```bash
# First run — opens a visible Chrome window. Sign in to grimco.com when
# prompted. The session is saved to scripts/grimco/.profile/ and reused on
# every subsequent run.
npm run scrape:grimco

# Subsequent runs (resume) — skips already-scraped products.
npm run scrape:grimco:resume

# Stop after N products (test runs).
npx tsx scripts/grimco/scrape.ts --limit=5

# Different starting category.
npx tsx scripts/grimco/scrape.ts --seed=https://www.grimco.com/catalog/category/digitalmedia
```

Output lands in `scripts/grimco/output/`:

| File | Contents |
| --- | --- |
| `urls.json` | Every product URL discovered from the seed |
| `products.json` | Full product + variant data — the importer's input |
| `errors.log` | Anything that failed (missing variants, broken pages) |

## Import into Supabase

```bash
# Dry run — shows what would be inserted/updated without touching the DB.
npm run import:grimco:dry

# Real import (default margin 30%).
npm run import:grimco

# Override margin for a one-off (e.g. clearance batch at 20%).
GRIMCO_MARGIN_PERCENT=20 npm run import:grimco
```

The importer:
- Walks each product's `category_path` and creates missing categories on the fly.
- Sets `cost_price` (Grimco's price), `margin_percent`, and `price` (cost × markup) on each variant.
- Keeps the cheapest in-stock variant's retail price as the product's `base_price` (so listing pages show "From $X").
- Marks variants as `is_available` based on the scraper's stock check.
- Stores `grimco_id`, `grimco_url`, and `grimco_sku` for re-sync.

## Re-syncing prices later

Grimco prices change. To refresh:

```bash
# Just re-run scrape (without --resume) to get fresh prices.
npm run scrape:grimco

# Then re-import. Existing products get UPDATEd, not duplicated.
npm run import:grimco
```

## What's robust vs. fragile

**Robust:**
- Login persistence (Chrome profile saved between runs).
- Crawl deduplication (won't double-fetch a URL).
- Periodic flush during scrape (every 5 products) so a crash doesn't lose work.
- Importer is idempotent.
- Error log instead of hard fail when a single product breaks.

**Fragile (will need updates if Grimco changes):**
- Variant dropdown labels (`Size`, `Core Size`, `Color`, `Finish`, etc.) —
  match against a hard-coded keyword list in `extractDimensions`. Add new
  ones if you find products whose dimensions get skipped.
- Price + SKU regex — parses the rendered text. If Grimco redesigns the
  buy-box layout this needs adjusting.
- The MUI `[id*="-option-"]` selector pattern — Grimco's component library.

## When to run

- **Initial onboarding:** scrape once to get the full catalog into Wrapfly.
- **Weekly:** re-scrape and re-import to refresh pricing + stock.
- **Triggered:** when Grimco notifies you of a product launch or pricing change.

If you want this to run automatically (e.g. nightly via launchd), tell me
and we'll wire that up — just need a tiny `plist` and a wrapped shell
script that emails you the diff.

# Wrapfly

SEO-first ecommerce storefront for premium sign and wrap supplies. Built on
Next.js 16 (App Router) deploying to Cloudflare Workers via OpenNext, with
Supabase Postgres + Auth, Square Web Payments, and Resend email.

---

## Stack

- **Framework:** Next.js 16 with App Router, React Server Components, Turbopack.
- **Edge runtime:** Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare).
- **Database & auth:** Supabase Postgres (project `mtocuyoydedhmjzvocra`, region us-east-1) with RLS.
- **Payments:** Square Web Payments SDK (REST API server-side) — sandbox first.
- **Email:** Resend transactional, with templates stored in `email_templates`.
- **UI:** Tailwind v4 (CSS-first config), Radix primitives, lucide-react icons.

---

## Getting started

```bash
# 1. Install (do this on your machine; sandbox build issues will not affect you)
rm -rf node_modules package-lock.json
npm install

# 2. Copy env file and fill in your keys
cp .env.example .env.local

# 3. Run dev server
npm run dev
# → http://localhost:3000
```

The home page, category pages, and product page (`/p/3m-wrap-film-series-2080`) all read from your Supabase project, which is already seeded with 29 categories, 1 product, and 25 variants.

---

## What you need to fill in (`.env.local`)

| Variable                                | Where to get it |
|-----------------------------------------|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY`             | Supabase dashboard → Settings → API → `service_role`. Server-only. |
| `NEXT_PUBLIC_SQUARE_APPLICATION_ID`     | https://developer.squareup.com/apps → your app → "Sandbox Application ID" |
| `NEXT_PUBLIC_SQUARE_LOCATION_ID`        | Square dashboard → Locations → ID column |
| `SQUARE_ACCESS_TOKEN`                   | Square app → Sandbox / Production access token |
| `SQUARE_WEBHOOK_SIGNATURE_KEY`          | Square app → Webhooks → Signature key (after creating subscription) |
| `RESEND_API_KEY`                        | https://resend.com/api-keys |
| `RESEND_FROM_EMAIL`                     | A verified sender at your domain (e.g. `Wrapfly <orders@wrapfly.com>`) |

---

## Repository layout

```
src/
  app/
    layout.tsx                          # Root layout, Org + WebSite JSON-LD, font
    page.tsx                            # Home — hero + categories + featured
    globals.css                         # Tailwind v4 @theme tokens, swatch styles
    sitemap.ts                          # Dynamic sitemap (categories + products)
    robots.ts
    not-found.tsx
    c/
      page.tsx                          # /c — all categories index
      [...path]/page.tsx                # /c/vinyl-rolls/vinyl-wrap — nested
    p/[slug]/page.tsx                   # /p/<slug> — product detail
    cart/page.tsx                       # Cart UI
    checkout/
      page.tsx                          # Checkout with Square card form
      success/page.tsx                  # Post-payment confirmation
    auth/callback/route.ts              # Supabase auth callback
    account/
      layout.tsx                        # Customer portal shell
      page.tsx                          # Dashboard
      sign-in/page.tsx
      sign-up/page.tsx
      forgot-password/page.tsx
      sign-out/route.ts
      orders/page.tsx                   # Order list
      orders/[id]/page.tsx              # Order detail
      addresses/page.tsx                # CRUD addresses
      profile/page.tsx
    admin/
      layout.tsx                        # Admin shell (gated by is_admin)
      page.tsx                          # Dashboard with KPIs
      orders/page.tsx                   # Orders list with filter/search
      orders/[id]/page.tsx              # Order detail + status + refunds
      coupons/page.tsx
      email-templates/page.tsx
      products/page.tsx
      customers/page.tsx
    api/
      cart/add/route.ts
      cart/update/route.ts
      cart/coupon/route.ts
      checkout/route.ts                 # Calls Square + creates order
      webhooks/square/route.ts          # Square HMAC-validated webhook
  components/
    site-header.tsx
    site-footer.tsx
    breadcrumbs.tsx                     # Visual + JSON-LD BreadcrumbList
    category-card.tsx
    product-card.tsx
    variant-selector.tsx                # *** Dynamic variant matrix ***
    checkout-form.tsx                   # Square Web Payments client component
  lib/
    site.ts
    types.ts
    utils.ts
    auth.ts                             # requireUser / requireAdmin / getProfile
    cart.ts                             # Server-side cart helpers
    orders.ts                           # createOrderFromCart + numbering
    square.ts                           # createPayment, refundPayment, webhook verify
    email.ts                            # Resend send + transactional templates
    supabase/
      client.ts
      server.ts
      middleware.ts
  middleware.ts
wrangler.toml
open-next.config.ts
next.config.ts
DEPLOY.md                               # Step-by-step deploy guide
```

---

## SEO foundation that's already built

- **Metadata** — Per-page `title`, `description`, canonical, OpenGraph, Twitter on every route.
- **JSON-LD structured data:**
  - Root: `Organization`, `WebSite` with sitelinks search.
  - Category pages: `BreadcrumbList`, `ItemList`.
  - Product pages: `Product` + `Offer` / `AggregateOffer` + (when reviews land) `AggregateRating`.
- **Sitemap** — `/sitemap.xml` lists every active category and product, hourly ISR.
- **Robots** — `/robots.txt` allows crawl, blocks `/api/`, `/account/`, `/admin/`, `/cart`, `/checkout/`.
- **Performance** — RSC + ISR on storefront pages, image optimization, security headers.
- **Indexable URLs** — Clean `/c/<path>` and `/p/<slug>`, canonicals match.

---

## The variant matrix (`components/variant-selector.tsx`)

This is the piece you specifically called out. The behavior preserved from base44:

1. Each `variant_dimension` (e.g. `color`, `size`) gets its own picker.
2. Picking a value in one dimension **narrows the other dimensions** to those that have an existing variant.
3. Combinations with no variant row, or out of stock, render disabled (greyed swatches with a slash, or strikethrough buttons).
4. The hero image and price update live to the currently-selected variant; falls back to swatch image / base price when partial.
5. Clearing logic — if you pick a value that breaks another already-chosen dimension (e.g. switching to a color that has no 50-yd roll), the conflicting dimension is reset rather than silently locking you out.

Test it: open `/p/3m-wrap-film-series-2080`. The product has all 79 colors and 3 sizes from the catalog; only the 25 colors I migrated will show as in-stock. The rest greys out automatically because they have no variant rows.

---

## Deploying to Cloudflare Workers

See [DEPLOY.md](./DEPLOY.md) for the complete step-by-step (gather keys → admin user → wrangler login → secrets → deploy → wire Square webhook → DNS cutover → flip to production Square).

Quick summary of the commands once your secrets are in hand:

```bash
npx wrangler login
npm run cf-typegen
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM_EMAIL
npx wrangler secret put ADMIN_NOTIFY_EMAIL
npm run deploy
```

---

## What's done vs. what's next

### Done
- Supabase project `wrapfly` provisioned (free tier).
- Schema with categories, products, variants, profiles, addresses, carts, coupons, orders, order_items, email_templates, reviews, forum_threads, forum_posts, intl_shipping_requests, json_imports, site_settings — all with RLS.
- 29 categories migrated from base44 (8 root, 21 sub).
- 1 product (3M Wrap Film 2080) migrated with the **full 79-color × 3-size variant_options matrix**.
- 25 known-available variants migrated.
- Default email_templates seeded (10 events) + default site_settings.
- Storefront: home, category browsing, product detail with dynamic variant matrix, breadcrumbs, sitemap, robots, full JSON-LD.
- **Auth:** sign-in, sign-up, password reset, auth callback, sign-out — all powered by Supabase Auth.
- **Cart:** server-backed in `carts` table, guest cart cookie, add/update/remove/coupon, merge-on-sign-in.
- **Checkout:** Square Web Payments SDK card form, server-side payment via Square REST API, order creation, success page.
- **Square webhook** at `/api/webhooks/square` with HMAC validation for `payment.*` and `refund.*` events.
- **Customer portal:** `/account` dashboard, `/account/orders`, `/account/orders/[id]`, `/account/addresses` CRUD, `/account/profile`.
- **Admin** (gated by `is_admin`): dashboard, orders list + detail with status updates / tracking entry / refunds, coupons, email-templates editor, products list, customers list.
- **Resend** transactional email: order confirmation, order shipped, refund — with admin internal-notify too.
- Cloudflare Workers deploy config (`wrangler.toml`, `open-next.config.ts`) + full `DEPLOY.md`.

### Next (deferred)
- **JSON-feed sync** — pull product variants automatically from feeds like Grimco. Schema (`json_imports`) ready; admin UI + scheduler to add.
- **Reviews + forums UI** on product pages (schema is ready).
- **International shipping form** at `/help/international` (schema is ready).
- **Saved-address selection** at checkout for signed-in users.
- **Tax + real shipping rates** (currently flat: $15 / free over $250, no tax).
- **Cart count badge** in the header.

---

## Useful commands

```bash
npm run dev           # dev server (http://localhost:3000)
npm run build         # production Next.js build
npm run typecheck     # TypeScript validation
npm run preview       # OpenNext local preview (Cloudflare runtime)
npm run deploy        # Build + deploy to Cloudflare Workers
npm run cf-typegen    # Regenerate Cloudflare bindings types
```

---

## Supabase reference

- Project ID: `mtocuyoydedhmjzvocra`
- API URL: `https://mtocuyoydedhmjzvocra.supabase.co`
- Region: `us-east-1`
- Dashboard: https://supabase.com/dashboard/project/mtocuyoydedhmjzvocra
- Publishable key (already in `.env.example` and `wrangler.toml`): `sb_publishable_sHQJ1UvMUetHM2xRM800eQ_gZC-osDw`

To make yourself an admin so you can edit products / coupons / orders later:

```sql
-- After signing up via /account/sign-up:
update public.profiles set is_admin = true where email = 'doug.mckay84@gmail.com';
```

# Wrapfly — Deploy Guide

This walks you through getting Wrapfly live on Cloudflare Workers, then
flipping wrapfly.com over from your old base44 site.

---

## 0. Prerequisites — gather your keys

Before you start, have these in front of you. You can do all the signups in
parallel; total time ~20 minutes.

### Supabase service-role key (already provisioned)

1. Visit https://supabase.com/dashboard/project/mtocuyoydedhmjzvocra/settings/api
2. Under **Service role**, click **Reveal** and copy. You'll paste this once
   in step 4 below — never put it in a public file.

### Square sandbox credentials (free)

1. Sign in at https://developer.squareup.com/apps and **Create application**.
2. From your app's page, grab these four values:
   - **Application ID** (sandbox) — starts with `sandbox-sq0idb-…`
   - **Location ID** — Square dashboard → Locations → ID column
   - **Access token** (sandbox) — server token, server-side only
   - **Webhook signature key** — only after you create a subscription in step 5

### Resend (free tier — 100 emails/day)

1. Sign up at https://resend.com.
2. **Domains** → **Add domain** → `wrapfly.com`. Resend shows you DNS
   records (TXT + 3× MX/SPF/DKIM). Add them at GoDaddy. Verification takes
   minutes-to-hours; you can deploy without this and circle back.
3. **API Keys** → **Create API Key** → name it `wrapfly-prod`.

### Cloudflare account access

You already have a Cloudflare account on record. We just need to log in
locally to the wrangler CLI in step 3.

---

## 1. Make yourself an admin

Sign up via your local dev server first so a profile row exists:

```bash
npm run dev
```

Open http://localhost:3000/account/sign-up, sign up with your real email,
confirm via the email Supabase sends. Then promote yourself to admin:

```sql
-- Run in Supabase SQL editor:
-- https://supabase.com/dashboard/project/mtocuyoydedhmjzvocra/sql/new
update public.profiles set is_admin = true where email = 'doug.mckay84@gmail.com';
```

You can now visit http://localhost:3000/admin (won't redirect away anymore).

---

## 2. Add your secrets to `.env.local` for local testing

Open `.env.local` and fill in the secrets you collected above. Restart
`npm run dev`. You should now be able to:

- Place a real Square sandbox test order with card `4111 1111 1111 1111`
  (any future expiry, any CVV, any postal code).
- See the new order appear in `/account/orders` and `/admin/orders`.
- Receive a Resend confirmation email at the address you used.

---

## 3. Log in to Cloudflare from this machine

```bash
cd ~/Documents/wrapfly
npx wrangler login
```

A browser tab will open — approve.

Generate Cloudflare-bindings types so TypeScript knows what's available
in production:

```bash
npm run cf-typegen
```

---

## 4. Set production secrets on the Worker

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# paste the service role key from step 0

npx wrangler secret put SQUARE_ACCESS_TOKEN
# paste the Square sandbox access token (or production token when you flip)

npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
# paste after you've created the webhook subscription in step 5

npx wrangler secret put RESEND_API_KEY
# paste the Resend API key

npx wrangler secret put RESEND_FROM_EMAIL
# paste e.g. "Wrapfly <orders@wrapfly.com>" (must be a Resend-verified sender)

npx wrangler secret put ADMIN_NOTIFY_EMAIL
# paste your inbox e.g. "doug.mckay84@gmail.com" — internal new-order alerts
```

Also put your **public** Square IDs into `wrangler.toml` under `[vars]`
(replace the empty strings I left there):

```toml
NEXT_PUBLIC_SQUARE_APPLICATION_ID = "sandbox-sq0idb-..."
NEXT_PUBLIC_SQUARE_LOCATION_ID    = "L..."
NEXT_PUBLIC_SQUARE_ENVIRONMENT    = "sandbox"   # change to "production" when flipping
```

Update `NEXT_PUBLIC_SITE_URL` in `wrangler.toml` to whatever URL you'll
deploy to first (workers.dev or staging subdomain — see step 6).

---

## 5. Deploy to a workers.dev URL first

```bash
npm run deploy
```

This runs OpenNext build + wrangler deploy. Output ends with something like:

```
Published wrapfly (1.42 sec)
  https://wrapfly.<your-account>.workers.dev
```

Open that URL, smoke-test:

- `/` — home renders
- `/sitemap.xml` — full sitemap
- `/robots.txt`
- `/p/3m-wrap-film-series-2080` — variant matrix works against prod Supabase
- `/account/sign-up` and `/account/sign-in`
- `/cart` and `/checkout` — place a sandbox test order with card `4111 1111 1111 1111`
- `/admin` — the dashboard (you should see your test order there)

### Wire up the Square webhook

Now that the Worker is live, in the Square dashboard:

1. **Webhooks** → **Subscriptions** → **Add Subscription**
2. URL: `https://wrapfly.<your-account>.workers.dev/api/webhooks/square`
3. Events: subscribe to **payment.updated**, **payment.created**,
   **refund.updated**, **refund.created**
4. Save. Copy the signature key you didn't have in step 4 and run:
   ```bash
   npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
   ```
   Then redeploy: `npm run deploy`.
5. Use the **Test event** button in Square to fire a fake event — it should
   return 200 OK from the Worker.

---

## 6. Cut over `wrapfly.com` from base44 → Cloudflare

You said wrapfly.com is on GoDaddy DNS. Two paths:

### Path A (recommended) — move DNS to Cloudflare

This unlocks the full Cloudflare stack (Workers routes, image resizing,
analytics) and is required for performance-tuning later.

1. Cloudflare dashboard → **Add a site** → enter `wrapfly.com` → **Free plan**.
2. Cloudflare scans existing GoDaddy DNS records. Verify they look right.
3. Cloudflare gives you two nameservers like `eli.ns.cloudflare.com` /
   `nina.ns.cloudflare.com`.
4. At GoDaddy → My Products → wrapfly.com → DNS → Nameservers → **Change**
   → paste the two Cloudflare nameservers → save.
5. Propagation takes 30 min to 24 hr. Status in Cloudflare goes **Active**
   when done.
6. In `wrangler.toml`, **uncomment** the routes block:

   ```toml
   [[routes]]
   pattern = "wrapfly.com/*"
   zone_name = "wrapfly.com"

   [[routes]]
   pattern = "www.wrapfly.com/*"
   zone_name = "wrapfly.com"
   ```

7. In `wrangler.toml` `[vars]`, change:
   ```toml
   NEXT_PUBLIC_SITE_URL = "https://wrapfly.com"
   ```
8. `npm run deploy` again. wrapfly.com now resolves to your Worker.

### Path B — keep DNS at GoDaddy

Slower path; some Workers features (route patterns, rate-limiting) won't
be available. Use Cloudflare Workers Custom Domains via the dashboard:

1. Cloudflare dashboard → Workers → wrapfly → **Triggers** → **Custom
   Domains** → **Add custom domain** → `wrapfly.com`. Cloudflare will
   show you a CNAME target.
2. At GoDaddy → DNS → add a CNAME from `@` (or `www`) to that target.
3. Wait for propagation. Cloudflare validates and issues a cert.

---

## 7. Flip Square to production mode (when you're ready to take real money)

1. Square dashboard → **Production** → grab production Application ID,
   Location ID, Access Token.
2. Update `wrangler.toml` `[vars]`:
   ```toml
   NEXT_PUBLIC_SQUARE_ENVIRONMENT  = "production"
   NEXT_PUBLIC_SQUARE_APPLICATION_ID = "<production app id>"
   NEXT_PUBLIC_SQUARE_LOCATION_ID    = "<production location id>"
   ```
3. Replace the production access token + webhook signature key:
   ```bash
   npx wrangler secret put SQUARE_ACCESS_TOKEN
   npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
   ```
4. Re-create the webhook subscription in **production** Square pointing
   at the same `/api/webhooks/square` URL.
5. `npm run deploy`.
6. Place a real $1 test order on a card you control to confirm.

---

## 8. SEO checklist (post-deploy)

Run these after wrapfly.com points to the Worker:

- **Lighthouse** — `npx lighthouse https://wrapfly.com --view` — aim for
  90+ on Performance, 100 on SEO/Best Practices/Accessibility.
- **Google Rich Results Test** — https://search.google.com/test/rich-results
  — paste `https://wrapfly.com/p/3m-wrap-film-series-2080`. Should detect
  Product, Offer/AggregateOffer, BreadcrumbList.
- **Sitemap** — submit `https://wrapfly.com/sitemap.xml` in Google Search
  Console (https://search.google.com/search-console).
- **PageSpeed Insights** — https://pagespeed.web.dev/ on home, a category
  page, and a product page.
- **Bing Webmaster Tools** — submit sitemap there too; meaningful traffic
  share for B2B sign-shop / wrap-installer searches.

---

## 9. What's deferred to a follow-up session

These were intentionally skipped to ship Phase 2 + 3 in scope:

- **JSON-feed sync** — pull product variants automatically from feeds like
  the Grimco one already on the 3M product. Schema is ready (`json_imports`
  table); admin UI + scheduled job to add.
- **Reviews + forums UI** — schema is ready, just needs UI on the product
  page reading from `product_reviews` and `forum_threads`.
- **International shipping request form** — schema is ready, needs a
  `/help/international` page with the form.
- **Address-book selection at checkout** — currently the checkout always
  collects fresh addresses; later we can offer saved addresses for
  signed-in users.
- **Cart line in header** — show item count in the header cart icon.
- **Tax service** — currently $0; integrate Stripe Tax / TaxJar / Square
  Sales Tax in production.
- **Real shipping rates** — currently flat $15 / free over $250; integrate
  Shippo / EasyPost / Square Shipping.

---

## Useful runtime commands

```bash
npm run dev               # local dev (with .env.local)
npm run typecheck         # TypeScript only
npm run preview           # OpenNext local preview (Cloudflare runtime)
npm run deploy            # build + deploy to Workers
npx wrangler tail         # live tail Worker logs
npx wrangler secret list  # what secrets are set
```

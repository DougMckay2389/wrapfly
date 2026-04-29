/**
 * Site-wide constants. Most user-facing settings (brand, contact, etc.) live in
 * the Supabase `site_settings` table and are loaded at runtime in the layout.
 * The values here are static fallbacks and SEO defaults.
 */

export const SITE = {
  name: "Wrapfly",
  domain: "wrapfly.com",
  defaultTitle:
    "Wrapfly — Vinyl Wraps, Sign Materials & Print Supplies",
  defaultDescription:
    "Wrapfly supplies sign shops, wrap installers, and print professionals with premium vinyl, substrates, equipment, and accessories. Fast shipping, fair prices.",
  twitter: "@wrapfly",
  locale: "en_US",
  // Used in OpenGraph + JSON-LD Organization fallback. Replace with a hosted
  // 1200x630 PNG once branding is finalized.
  ogImage: "/og-default.png",
} as const;

export const NAV = {
  main: [
    { label: "Vinyl Rolls", href: "/c/vinyl-rolls" },
    { label: "Substrates", href: "/c/substrates" },
    { label: "Signs & Supplies", href: "/c/signs-supplies" },
    { label: "Equipment", href: "/c/equipment" },
    { label: "Inks & Accessories", href: "/c/inks-accessories" },
    { label: "Apparel", href: "/c/apparel-screen-printing" },
    { label: "Automotive", href: "/c/automotive-films" },
  ],
  footer: {
    Shop: [
      { label: "All categories", href: "/c" },
      { label: "Search", href: "/search" },
    ],
    Help: [
      { label: "Shipping policy", href: "/shipping" },
      { label: "Returns & refunds", href: "/returns" },
      { label: "FAQ", href: "/faq" },
    ],
    Account: [
      { label: "Sign in", href: "/account/sign-in" },
      { label: "Create account", href: "/account/sign-up" },
      { label: "My orders", href: "/account/orders" },
    ],
    Company: [
      { label: "About", href: "/about" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  } as const,
} as const;

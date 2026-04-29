import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Hook OpenNext into `next dev` so we can call Cloudflare bindings (KV, R2, etc.)
// during local development. No-op in production builds.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // SEO: trailing slashes off (canonical URLs match w/o slash).
  trailingSlash: false,

  // Use built-in image optimization. We'll switch to Cloudflare Images later
  // for true edge image variants.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "mtocuyoydedhmjzvocra.supabase.co" },
    ],
  },

  experimental: {
    // Streaming + RSC: enabled by default in Next 16.
  },

  // Strip `x-powered-by` for security; add CSP headers in middleware.
  poweredByHeader: false,

  // Treat 404s as cache-friendly so Cloudflare can cache them.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

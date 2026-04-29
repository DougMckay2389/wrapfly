import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext + Cloudflare Workers config.
// Docs: https://opennext.js.org/cloudflare
export default defineCloudflareConfig({
  // Use the Workers built-in incremental cache. For production traffic at scale,
  // bind a KV namespace named `NEXT_INC_CACHE_KV` in wrangler.toml and
  // switch to `kvIncrementalCache`.
  // incrementalCache: kvIncrementalCache,
});

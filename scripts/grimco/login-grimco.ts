/**
 * Open Grimco's home page in a real Chromium window using the persistent
 * profile that the image mirror reuses. Sign in, then close the window —
 * cookies persist for subsequent `npm run mirror:images` runs.
 *
 * Run once per machine (or whenever your Grimco session expires).
 *
 * Usage:
 *   npm run mirror:login
 */

import { chromium } from "playwright";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(__dirname, ".profile");

async function main() {
  console.log(
    `Opening Grimco. Sign in if you're not already logged in, then close the\n` +
      `browser window when you're done. Profile location: ${PROFILE_DIR}\n`,
  );
  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/147.0 Safari/537.36",
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto("https://www.grimco.com/", { waitUntil: "domcontentloaded" });

  // Block until the user closes the browser window.
  await new Promise<void>((resolveProm) => {
    browser.on("close", () => resolveProm());
  });
  console.log("Browser closed — profile saved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

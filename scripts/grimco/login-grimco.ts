/**
 * Open Grimco's home page in a real Chromium window using the persistent
 * profile that the image mirror + enrich-pricing scripts reuse. Sign in
 * (check "remember me" if you can), then press ENTER in the terminal to
 * close cleanly. Cookies persist for subsequent runs.
 *
 * Run once per machine, or whenever your Grimco session expires.
 *
 * Usage:
 *   npm run mirror:login
 */

import { chromium } from "playwright";
import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const PROFILE_DIR = resolve(__dirname, ".profile");

async function waitForEnter(prompt: string): Promise<void> {
  process.stdout.write(prompt);
  return new Promise((resolveProm) => {
    const onData = () => {
      process.stdin.removeListener("data", onData);
      try {
        process.stdin.pause();
      } catch {}
      resolveProm();
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

async function main() {
  console.log(
    `\nOpening Grimco with profile: ${PROFILE_DIR}\n` +
      `\n  1. Sign in to Grimco in the window that opens.\n` +
      `  2. (If there's a "Remember me" checkbox, tick it.)\n` +
      `  3. Once you see your account name in the header, come back here\n` +
      `     and press ENTER. Don't close the browser window yourself —\n` +
      `     this script will close it cleanly so cookies actually save.\n`,
  );

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    // Use a Windows UA — faking Mac was probably making Grimco invalidate
    // the session.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto("https://www.grimco.com/Account/LogOn", {
    waitUntil: "domcontentloaded",
  });

  await waitForEnter("\n>>> Press ENTER once you're signed in: ");

  // Take a quick read on whether auth stuck before we close.
  try {
    await page.goto("https://www.grimco.com/", { waitUntil: "domcontentloaded" });
    const myAccountVisible = await page
      .getByText(/My Account/i)
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    console.log(
      myAccountVisible
        ? "✓ 'My Account' link visible — looks signed in."
        : "⚠ 'My Account' link NOT visible — you may not be signed in.",
    );
  } catch {}

  console.log("Closing browser cleanly so cookies flush…");
  await browser.close();

  // Verify the cookies file exists + has bytes.
  const cookiePath = join(PROFILE_DIR, "Default", "Cookies");
  if (existsSync(cookiePath)) {
    const sz = statSync(cookiePath).size;
    console.log(`✓ Cookies file: ${cookiePath} (${sz} bytes)`);
    if (sz < 4096) {
      console.log(
        "⚠ Cookies file is suspiciously small. If enrich:pricing fails to\n" +
          "  authenticate, run this again and make sure you're fully logged in\n" +
          "  before pressing ENTER.",
      );
    }
  } else {
    console.log(
      `✗ No cookies file at ${cookiePath} — login did NOT persist.\n` +
        `  Try again, and tick a "Remember me" / "Keep me signed in" box if shown.`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

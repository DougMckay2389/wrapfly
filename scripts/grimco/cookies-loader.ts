/**
 * Reads scripts/grimco/cookies.json — a JSON array exported from the
 * Chrome "Cookie-Editor" extension while logged in to grimco.com — and
 * injects those cookies into a Playwright BrowserContext.
 *
 * Cookie-Editor's export format is an array like:
 *   [
 *     {
 *       "domain": ".grimco.com",
 *       "name": "ASP.NET_SessionId",
 *       "value": "...",
 *       "path": "/",
 *       "expirationDate": 1762040000.123,    // optional, seconds since epoch
 *       "secure": true,
 *       "httpOnly": true,
 *       "sameSite": "lax" | "no_restriction" | "strict" | "unspecified"
 *     },
 *     ...
 *   ]
 *
 * We only keep cookies for *.grimco.com and re-shape them for Playwright's
 * BrowserContext.addCookies() API.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "playwright";

const COOKIES_PATH = resolve(__dirname, "cookies.json");

type CookieEditorCookie = {
  domain: string;
  name: string;
  value: string;
  path?: string;
  expirationDate?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  hostOnly?: boolean;
  session?: boolean;
};

type PlaywrightCookie = {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

function normalizeSameSite(
  v: string | undefined,
): "Strict" | "Lax" | "None" | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s === "strict") return "Strict";
  if (s === "lax") return "Lax";
  if (s === "no_restriction" || s === "none") return "None";
  return undefined; // "unspecified" → leave unset
}

export function cookiesFileExists(): boolean {
  return existsSync(COOKIES_PATH);
}

export function loadCookiesJSON(): CookieEditorCookie[] {
  if (!existsSync(COOKIES_PATH)) {
    throw new Error(
      `cookies.json not found at ${COOKIES_PATH}\n` +
        `Export from Chrome Cookie-Editor (logged in to grimco.com) and save here.`,
    );
  }
  const raw = readFileSync(COOKIES_PATH, "utf-8").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `cookies.json is not valid JSON: ${(e as Error).message}\n` +
        `Re-export from Cookie-Editor and overwrite the file.`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("cookies.json must be a JSON array (Cookie-Editor 'JSON' export).");
  }
  return parsed as CookieEditorCookie[];
}

export async function injectCookies(context: BrowserContext): Promise<number> {
  const raw = loadCookiesJSON();
  const grimcoOnly = raw.filter((c) =>
    typeof c.domain === "string" && /grimco\.com$/i.test(c.domain.replace(/^\./, "")),
  );
  if (!grimcoOnly.length) {
    throw new Error(
      "cookies.json had no entries for grimco.com. Did you export with the wrong tab in front?",
    );
  }
  const playwrightCookies: PlaywrightCookie[] = grimcoOnly.map((c) => {
    const out: PlaywrightCookie = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
    };
    if (typeof c.expirationDate === "number" && Number.isFinite(c.expirationDate)) {
      out.expires = Math.floor(c.expirationDate);
    }
    if (typeof c.httpOnly === "boolean") out.httpOnly = c.httpOnly;
    if (typeof c.secure === "boolean") out.secure = c.secure;
    const ss = normalizeSameSite(c.sameSite);
    if (ss) out.sameSite = ss;
    return out;
  });

  await context.addCookies(playwrightCookies);
  return playwrightCookies.length;
}

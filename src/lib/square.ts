import { randomUUID } from "node:crypto";

/**
 * Server-side Square integration. We use the REST API directly via fetch
 * instead of the official SDK — keeps the dependency footprint small and
 * works perfectly on the Cloudflare Workers runtime.
 *
 * Docs: https://developer.squareup.com/reference/square
 */

function squareBase() {
  const env = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
  return env === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function squareToken() {
  const t = process.env.SQUARE_ACCESS_TOKEN;
  if (!t) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  return t;
}

async function squareFetch<T = unknown>(
  path: string,
  init: RequestInit & { idempotency?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${squareToken()}`);
  headers.set("Content-Type", "application/json");
  headers.set("Square-Version", "2025-04-16");
  const resp = await fetch(`${squareBase()}${path}`, { ...init, headers });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!resp.ok) {
    const errMsg =
      (body as { errors?: Array<{ detail?: string; code?: string }> })?.errors
        ?.map((e) => e.detail ?? e.code)
        .join("; ") ?? `Square ${resp.status}`;
    throw new Error(errMsg);
  }
  return body as T;
}

export type SquarePayment = {
  id: string;
  status:
    | "APPROVED"
    | "COMPLETED"
    | "PENDING"
    | "CANCELED"
    | "FAILED";
  amount_money: { amount: number; currency: string };
  receipt_url?: string;
  order_id?: string;
};

/**
 * Charges the customer using a tokenized card source from the Web Payments
 * SDK. Amount is in cents (dollars * 100).
 */
export async function createPayment(args: {
  sourceId: string;
  amountCents: number;
  currency?: string;
  buyerEmail?: string;
  note?: string;
  referenceId?: string;
}): Promise<SquarePayment> {
  const body = {
    source_id: args.sourceId,
    idempotency_key: randomUUID(),
    amount_money: {
      amount: args.amountCents,
      currency: args.currency ?? "USD",
    },
    buyer_email_address: args.buyerEmail,
    note: args.note?.slice(0, 500),
    reference_id: args.referenceId?.slice(0, 40),
    autocomplete: true,
    location_id: process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID,
  };
  const json = await squareFetch<{ payment: SquarePayment }>("/v2/payments", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return json.payment;
}

export async function refundPayment(args: {
  paymentId: string;
  amountCents: number;
  currency?: string;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  const body = {
    idempotency_key: randomUUID(),
    payment_id: args.paymentId,
    amount_money: {
      amount: args.amountCents,
      currency: args.currency ?? "USD",
    },
    reason: args.reason?.slice(0, 192),
  };
  const json = await squareFetch<{ refund: { id: string; status: string } }>(
    "/v2/refunds",
    { method: "POST", body: JSON.stringify(body) },
  );
  return json.refund;
}

/**
 * Verifies an incoming Square webhook signature.
 * Reference: https://developer.squareup.com/docs/webhooks/step3validate
 */
export async function verifyWebhookSignature(args: {
  signatureHeader: string | null;
  notificationUrl: string;
  body: string;
}): Promise<boolean> {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !args.signatureHeader) return false;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(args.notificationUrl + args.body),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(expected, args.signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

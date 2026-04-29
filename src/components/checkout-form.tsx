"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

type Props = {
  applicationId: string;
  locationId: string;
  defaultEmail?: string;
};

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Square?: any;
  }
}

/**
 * Checkout form with Square Web Payments SDK.
 *
 * Collects address fields + email + tokenizes the card client-side using
 * Square's hosted iframe (PCI scope stays at Square). On submit it posts
 * the resulting `sourceId` to /api/checkout, which calls Square's REST
 * API server-side to actually charge the card and create the order.
 */
export function CheckoutForm({ applicationId, locationId, defaultEmail = "" }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [card, setCard] = useState<any>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sdkReady || !window.Square || card) return;
    let cancelled = false;
    (async () => {
      try {
        const payments = window.Square.payments(applicationId, locationId);
        const c = await payments.card();
        if (cancelled) return;
        if (cardRef.current) await c.attach(cardRef.current);
        setCard(c);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load payment form");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdkReady, applicationId, locationId, card]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!card) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await card.tokenize();
      if (result.status !== "OK") {
        const msg = result.errors?.[0]?.message ?? "Card tokenization failed";
        throw new Error(msg);
      }
      // Inject the source token as a hidden field and submit the real form.
      const form = formRef.current!;
      const existing = form.querySelector("input[name=source_id]");
      if (existing) existing.remove();
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "source_id";
      input.value = result.token;
      form.appendChild(input);
      form.submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setSubmitting(false);
    }
  }

  const sandbox = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT !== "production";

  return (
    <>
      <Script
        src={
          sandbox
            ? "https://sandbox.web.squarecdn.com/v1/square.js"
            : "https://web.squarecdn.com/v1/square.js"
        }
        onLoad={() => setSdkReady(true)}
        strategy="afterInteractive"
      />
      <form
        ref={formRef}
        action="/api/checkout"
        method="post"
        onSubmit={onSubmit}
        className="space-y-6"
      >
        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Contact</legend>
          <Input name="email" label="Email" type="email" required defaultValue={defaultEmail} />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Shipping address</legend>
          <Input name="ship_full_name" label="Full name" required />
          <Input name="ship_company" label="Company (optional)" />
          <Input name="ship_phone" label="Phone" required type="tel" />
          <Input name="ship_address1" label="Address line 1" required />
          <Input name="ship_address2" label="Address line 2 (optional)" />
          <div className="grid sm:grid-cols-3 gap-3">
            <Input name="ship_city" label="City" required />
            <Input name="ship_state" label="State" required />
            <Input name="ship_postal_code" label="ZIP" required />
          </div>
          <Input name="ship_country" label="Country" required defaultValue="US" />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-lg font-semibold">Billing</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billing_same" defaultChecked />
            Same as shipping address
          </label>
          {/* For brevity, we treat billing == shipping in v1. */}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">Payment</legend>
          <p className="text-xs text-[var(--color-muted)]">
            Card details are tokenized by Square — your card never touches our servers.
          </p>
          <div
            ref={cardRef}
            className="min-h-[64px] p-3 rounded-md border border-[var(--color-border)] bg-white"
          />
          {!sdkReady ? (
            <p className="text-xs text-[var(--color-muted)]">Loading payment form…</p>
          ) : null}
        </fieldset>

        {error ? (
          <div className="p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!card || submitting}
          className="w-full px-5 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)] disabled:bg-[var(--color-brand-300)] disabled:cursor-not-allowed"
        >
          {submitting ? "Processing…" : "Place order"}
        </button>
        <p className="text-xs text-center text-[var(--color-muted)]">
          By placing your order you agree to our Terms and Privacy Policy.
        </p>
      </form>
    </>
  );
}

function Input({
  name,
  label,
  type = "text",
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
      />
    </div>
  );
}

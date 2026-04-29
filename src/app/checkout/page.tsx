import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/checkout-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { readCart } from "@/lib/cart";
import { getProfile } from "@/lib/auth";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
  alternates: { canonical: "/checkout" },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const cart = await readCart();
  if (!cart || !cart.items?.length) redirect("/cart");

  const profile = await getProfile();
  const items = cart.items;
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = Number(cart.discount ?? 0);

  // Phase-1 shipping rule: free over $250, else $15 flat. Will be replaced by
  // real shipping rates from a provider in Phase 3 (or by Square Shipping).
  const shipping = subtotal - discount >= 250 ? 0 : 15;
  const tax = 0; // Tax service in Phase 3.
  const total = +(subtotal - discount + shipping + tax).toFixed(2);

  const applicationId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? "";
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Cart", href: "/cart" },
          { label: "Checkout", href: "/checkout" },
        ]}
      />
      <div className="container-wf pb-16 grid lg:grid-cols-[1fr_400px] gap-10 items-start">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight mb-6">Checkout</h1>

          {!applicationId || !locationId ? (
            <div className="p-3 rounded-md border border-[var(--color-warn)] bg-yellow-50 text-sm">
              Square credentials are not configured yet. Add{" "}
              <code>NEXT_PUBLIC_SQUARE_APPLICATION_ID</code> and{" "}
              <code>NEXT_PUBLIC_SQUARE_LOCATION_ID</code> to your{" "}
              <code>.env.local</code> and restart the dev server to enable
              checkout.
            </div>
          ) : (
            <CheckoutForm
              applicationId={applicationId}
              locationId={locationId}
              defaultEmail={profile?.email ?? ""}
            />
          )}
        </section>

        <aside className="rounded-lg border border-[var(--color-border)] p-5 sticky top-20">
          <h2 className="text-lg font-semibold mb-3">Order summary</h2>
          <ul className="divide-y divide-[var(--color-border)] mb-4">
            {items.map((it) => (
              <li key={it.variant_id} className="py-2 text-sm flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{it.product_name}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {Object.values(it.combination ?? {}).join(" · ")} ×{" "}
                    {it.quantity}
                  </span>
                </span>
                <span className="font-semibold whitespace-nowrap">
                  {formatPrice(it.price * it.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="text-sm space-y-1.5 border-t border-[var(--color-border)] pt-3">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            {discount > 0 ? (
              <div className="flex justify-between text-[var(--color-success)]">
                <dt>Discount</dt>
                <dd>−{formatPrice(discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd>{shipping === 0 ? "Free" : formatPrice(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-[var(--color-border)] pt-2 font-semibold text-base">
              <dt>Total</dt>
              <dd>{formatPrice(total)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}

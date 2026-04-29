import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Trash2, Tag } from "lucide-react";
import { readCart } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
  alternates: { canonical: "/cart" },
};

export const dynamic = "force-dynamic";

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; coupon_error?: string }>;
}) {
  const { error, coupon_error } = await searchParams;
  const cart = await readCart();
  const items = cart?.items ?? [];
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = Number(cart?.discount ?? 0);
  const total = Math.max(0, +(subtotal - discount).toFixed(2));

  if (!items.length) {
    return (
      <div className="container-wf py-16 max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Your cart is empty</h1>
        <p className="text-[var(--color-muted)] mt-2">
          Start shopping and your selections will land here.
        </p>
        <Link
          href="/"
          className="inline-flex mt-6 px-5 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Browse the catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="container-wf py-10 grid lg:grid-cols-[1fr_360px] gap-10 items-start">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Your cart</h1>

        {error ? (
          <div className="mt-4 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}

        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] mt-6">
          {items.map((item) => (
            <li key={item.variant_id} className="py-4 flex gap-4">
              <div className="relative h-20 w-20 shrink-0 rounded-md overflow-hidden bg-[var(--color-muted-bg)]">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.product_name}
                    fill
                    sizes="80px"
                    className="object-contain"
                  />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-brand-900)]">
                  {item.product_name}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {Object.entries(item.combination ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </p>
                <p className="text-xs text-[var(--color-muted)] mt-1">SKU {item.variant_sku}</p>
                <div className="mt-2 flex items-center gap-3">
                  <form action="/api/cart/update" method="post" className="flex items-center gap-1">
                    <input type="hidden" name="variant_id" value={item.variant_id} />
                    <label className="sr-only" htmlFor={`q-${item.variant_id}`}>
                      Quantity
                    </label>
                    <input
                      id={`q-${item.variant_id}`}
                      name="quantity"
                      type="number"
                      defaultValue={item.quantity}
                      min={0}
                      className="w-16 px-2 py-1 rounded-md border border-[var(--color-border)] text-sm"
                    />
                    <button
                      type="submit"
                      className="text-xs underline text-[var(--color-muted)]"
                    >
                      Update
                    </button>
                  </form>
                  <form action="/api/cart/update" method="post">
                    <input type="hidden" name="variant_id" value={item.variant_id} />
                    <input type="hidden" name="quantity" value="0" />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 text-xs text-[var(--color-danger)] hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </form>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {formatPrice(item.price * item.quantity)}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {formatPrice(item.price)} ea
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="rounded-lg border border-[var(--color-border)] p-5 space-y-4">
        <h2 className="text-lg font-semibold">Order summary</h2>
        <dl className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatPrice(subtotal)}</dd>
          </div>
          {discount > 0 ? (
            <div className="flex justify-between text-[var(--color-success)]">
              <dt>Discount {cart?.coupon_code ? `(${cart.coupon_code})` : ""}</dt>
              <dd>−{formatPrice(discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-[var(--color-muted)]">
            <dt>Shipping</dt>
            <dd>Calculated at checkout</dd>
          </div>
          <div className="flex justify-between text-[var(--color-muted)]">
            <dt>Tax</dt>
            <dd>Calculated at checkout</dd>
          </div>
          <div className="border-t border-[var(--color-border)] pt-2 flex justify-between font-semibold text-base">
            <dt>Estimated total</dt>
            <dd>{formatPrice(total)}</dd>
          </div>
        </dl>

        <form action="/api/cart/coupon" method="post" className="border-t border-[var(--color-border)] pt-4">
          <label htmlFor="code" className="text-sm font-medium flex items-center gap-1">
            <Tag className="h-4 w-4" /> Coupon code
          </label>
          {cart?.coupon_code ? (
            <div className="mt-2 flex items-center justify-between p-2 rounded-md bg-[var(--color-muted-bg)] text-sm">
              <span className="font-mono">{cart.coupon_code}</span>
              <button name="action" value="remove" className="text-xs underline">
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <input
                id="code"
                name="code"
                type="text"
                placeholder="WELCOME10"
                className="flex-1 px-2 py-1.5 rounded-md border border-[var(--color-border)] text-sm"
              />
              <button
                name="action"
                value="apply"
                className="px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)] text-sm"
              >
                Apply
              </button>
            </div>
          )}
          {coupon_error ? (
            <p className="mt-2 text-xs text-[var(--color-danger)]">{coupon_error}</p>
          ) : null}
        </form>

        <Link
          href="/checkout"
          className="block text-center px-4 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Checkout
        </Link>
        <Link
          href="/"
          className="block text-center text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Continue shopping
        </Link>
      </aside>
    </div>
  );
}

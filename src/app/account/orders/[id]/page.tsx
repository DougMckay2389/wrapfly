import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Order details",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, fulfillment, total, subtotal, discount_total, shipping_total, tax_total, items, shipping_address, billing_address, square_receipt_url, tracking_number, tracking_carrier, created_at, paid_at, shipped_at, delivered_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!order) notFound();

  const items = order.items as Array<{
    product_name: string;
    variant_sku: string;
    combination?: Record<string, string>;
    price: number;
    quantity: number;
    image_url?: string | null;
  }>;
  const ship = order.shipping_address as Record<string, string> | null;

  return (
    <div>
      <Link href="/account/orders" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All orders
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Order {order.order_number}
      </h1>
      <p className="text-[var(--color-muted)] mt-1">
        Placed {new Date(order.created_at).toLocaleString()} ·{" "}
        <span className="capitalize">{order.status.replace("_", " ")}</span>
      </p>

      <section className="mt-8 grid lg:grid-cols-[1fr_320px] gap-8">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
            Items
          </h2>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {items.map((it, i) => (
              <li key={`${it.variant_sku}-${i}`} className="py-3 flex gap-3 text-sm">
                <div
                  className="w-14 h-14 rounded bg-[var(--color-muted-bg)] bg-cover bg-center shrink-0"
                  style={it.image_url ? { backgroundImage: `url(${it.image_url})` } : undefined}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{it.product_name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {Object.values(it.combination ?? {}).join(" · ")} × {it.quantity}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">SKU {it.variant_sku}</p>
                </div>
                <p className="font-semibold whitespace-nowrap">
                  {formatPrice(it.price * it.quantity)}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <aside className="space-y-5">
          <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
            <h3 className="font-semibold mb-2">Totals</h3>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPrice(order.subtotal)}</dd></div>
              {Number(order.discount_total) > 0 ? (
                <div className="flex justify-between text-[var(--color-success)]">
                  <dt>Discount</dt><dd>−{formatPrice(order.discount_total)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between"><dt>Shipping</dt><dd>{formatPrice(order.shipping_total)}</dd></div>
              {Number(order.tax_total) > 0 ? (
                <div className="flex justify-between"><dt>Tax</dt><dd>{formatPrice(order.tax_total)}</dd></div>
              ) : null}
              <div className="flex justify-between font-semibold pt-1 border-t border-[var(--color-border)]">
                <dt>Total</dt><dd>{formatPrice(order.total)}</dd>
              </div>
            </dl>
          </div>

          {ship ? (
            <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
              <h3 className="font-semibold mb-2">Ship to</h3>
              <p className="leading-relaxed">
                {ship.full_name}<br />
                {ship.company ? <>{ship.company}<br /></> : null}
                {ship.address1}<br />
                {ship.address2 ? <>{ship.address2}<br /></> : null}
                {ship.city}, {ship.state} {ship.postal_code}<br />
                {ship.country ?? "US"}
              </p>
            </div>
          ) : null}

          {order.tracking_number ? (
            <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
              <h3 className="font-semibold mb-2">Tracking</h3>
              <p className="font-mono">{order.tracking_number}</p>
              {order.tracking_carrier ? <p className="text-[var(--color-muted)]">{order.tracking_carrier}</p> : null}
            </div>
          ) : null}

          {order.square_receipt_url ? (
            <a
              href={order.square_receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center px-3 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)] text-sm"
            >
              Square receipt
            </a>
          ) : null}
        </aside>
      </section>
    </div>
  );
}

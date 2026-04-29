import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatPrice } from "@/lib/utils";
import { refundPayment } from "@/lib/square";
import { sendOrderShipped, sendOrderRefunded } from "@/lib/email";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function updateStatus(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const fulfillment = String(formData.get("fulfillment") ?? "");
  const trackingNumber = String(formData.get("tracking_number") ?? "");
  const trackingCarrier = String(formData.get("tracking_carrier") ?? "");
  const adminNotes = String(formData.get("admin_notes") ?? "");
  const supabase = createAdminClient();
  const update: Record<string, unknown> = {
    status,
    fulfillment,
    tracking_number: trackingNumber || null,
    tracking_carrier: trackingCarrier || null,
    admin_notes: adminNotes || null,
  };
  if (status === "shipped" && !update.shipped_at) update.shipped_at = new Date().toISOString();
  if (status === "delivered") update.delivered_at = new Date().toISOString();
  if (status === "cancelled") update.cancelled_at = new Date().toISOString();
  await supabase.from("orders").update(update).eq("id", id);
  if (status === "shipped" && trackingNumber) {
    sendOrderShipped({ orderId: id, trackingNumber, carrier: trackingCarrier }).catch(console.error);
  }
  redirect(`/admin/orders/${id}?ok=1`);
}

async function issueRefund(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  if (!id || amount <= 0) redirect(`/admin/orders/${id}?error=Invalid+amount`);

  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, total, square_payment_id")
    .eq("id", id)
    .maybeSingle();
  if (!order || !order.square_payment_id)
    redirect(`/admin/orders/${id}?error=Order+has+no+payment`);

  try {
    await refundPayment({
      paymentId: order!.square_payment_id!,
      amountCents: Math.round(amount * 100),
      reason: "Admin refund",
    });
    const fully = amount >= Number(order!.total);
    await supabase
      .from("orders")
      .update({
        status: fully ? "refunded" : "partially_refunded",
        refunded_at: new Date().toISOString(),
      })
      .eq("id", id);
    sendOrderRefunded({ orderId: id, amount }).catch(console.error);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refund failed";
    redirect(`/admin/orders/${id}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/admin/orders/${id}?ok=Refunded`);
}

export default async function AdminOrderDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, fulfillment, total, subtotal, discount_total, shipping_total, tax_total, items, shipping_address, billing_address, square_payment_id, square_receipt_url, tracking_number, tracking_carrier, email, admin_notes, created_at, paid_at, shipped_at, delivered_at",
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
  }>;
  const ship = order.shipping_address as Record<string, string> | null;

  return (
    <div>
      <Link href="/admin/orders" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All orders
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {order.order_number} · {formatPrice(order.total)}
      </h1>
      <p className="text-[var(--color-muted)] mt-1">
        {order.email} · placed {new Date(order.created_at).toLocaleString()}
      </p>

      {ok ? <Banner kind="success">{ok === "1" ? "Saved" : ok}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}

      <section className="mt-6 grid lg:grid-cols-[1fr_320px] gap-8">
        <div className="space-y-6">
          <div>
            <h2 className="font-semibold mb-2">Items</h2>
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {items.map((i, k) => (
                <li key={k} className="py-2 flex justify-between text-sm">
                  <span>
                    {i.product_name}
                    <span className="text-[var(--color-muted)]">
                      {" — "}
                      {Object.values(i.combination ?? {}).join(" · ")} × {i.quantity}
                    </span>
                  </span>
                  <span className="font-semibold">{formatPrice(i.price * i.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>

          <form action={updateStatus} className="space-y-3 border border-[var(--color-border)] p-4 rounded-lg">
            <h2 className="font-semibold">Status &amp; fulfillment</h2>
            <input type="hidden" name="id" value={order.id} />
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Select name="status" label="Order status" defaultValue={order.status}>
                {["pending","paid","processing","shipped","delivered","cancelled","refunded","partially_refunded","failed"].map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </Select>
              <Select name="fulfillment" label="Fulfillment" defaultValue={order.fulfillment}>
                {["unfulfilled","partially_fulfilled","fulfilled","returned"].map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </Select>
              <Input name="tracking_number" label="Tracking number" defaultValue={order.tracking_number ?? ""} />
              <Input name="tracking_carrier" label="Carrier (UPS, USPS, FedEx)" defaultValue={order.tracking_carrier ?? ""} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Internal notes</label>
              <textarea
                name="admin_notes"
                rows={2}
                defaultValue={order.admin_notes ?? ""}
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
              />
            </div>
            <button className="px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
              Save
            </button>
          </form>

          {order.square_payment_id ? (
            <form action={issueRefund} className="space-y-3 border border-[var(--color-border)] p-4 rounded-lg">
              <h2 className="font-semibold">Issue refund</h2>
              <input type="hidden" name="id" value={order.id} />
              <p className="text-xs text-[var(--color-muted)]">
                Square payment <code>{order.square_payment_id}</code>
              </p>
              <div className="flex gap-2 items-end">
                <Input
                  name="amount"
                  label={`Amount (max ${formatPrice(order.total)})`}
                  defaultValue={String(order.total)}
                  type="number"
                />
                <button className="px-4 py-2 rounded-md bg-[var(--color-danger)] text-white text-sm font-semibold hover:opacity-90">
                  Refund
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <aside className="space-y-5 text-sm">
          <div className="rounded-lg border border-[var(--color-border)] p-4">
            <h3 className="font-semibold mb-2">Totals</h3>
            <dl className="space-y-1">
              <Row label="Subtotal" value={formatPrice(order.subtotal)} />
              {Number(order.discount_total) > 0 ? <Row label="Discount" value={`−${formatPrice(order.discount_total)}`} /> : null}
              <Row label="Shipping" value={formatPrice(order.shipping_total)} />
              {Number(order.tax_total) > 0 ? <Row label="Tax" value={formatPrice(order.tax_total)} /> : null}
              <Row label="Total" value={formatPrice(order.total)} bold />
            </dl>
          </div>
          {ship ? (
            <div className="rounded-lg border border-[var(--color-border)] p-4">
              <h3 className="font-semibold mb-2">Ship to</h3>
              <p className="leading-relaxed text-sm">
                {ship.full_name}<br />
                {ship.company ? <>{ship.company}<br /></> : null}
                {ship.address1}<br />
                {ship.address2 ? <>{ship.address2}<br /></> : null}
                {ship.city}, {ship.state} {ship.postal_code}<br />
                {ship.country ?? "US"}
              </p>
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

function Banner({ kind, children }: { kind: "success" | "error"; children: React.ReactNode }) {
  const cls =
    kind === "success"
      ? "border-[var(--color-success)] bg-green-50 text-[var(--color-success)]"
      : "border-[var(--color-danger)] bg-red-50 text-[var(--color-danger)]";
  return (
    <div className={`mt-4 p-3 rounded-md border ${cls} text-sm`}>{children}</div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold border-t border-[var(--color-border)] pt-1" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)]"
      >
        {children}
      </select>
    </div>
  );
}

function Input({ name, label, defaultValue, type = "text" }: { name: string; label: string; defaultValue?: string; type?: string }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)]"
      />
    </div>
  );
}

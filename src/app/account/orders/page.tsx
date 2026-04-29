import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account/orders" },
};

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, total, status, fulfillment, created_at, items, tracking_number")
    .order("created_at", { ascending: false });

  if (!orders?.length) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-[var(--color-muted)] mt-2">You haven&apos;t placed any orders yet.</p>
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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <ul className="mt-6 space-y-4">
        {orders.map((o) => (
          <li
            key={o.id}
            className="rounded-lg border border-[var(--color-border)] p-4"
          >
            <div className="flex justify-between gap-3 items-start">
              <div>
                <Link
                  href={`/account/orders/${o.id}`}
                  className="font-semibold hover:underline"
                >
                  {o.order_number}
                </Link>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Placed {new Date(o.created_at).toLocaleDateString()} ·{" "}
                  <span className="capitalize">{o.status.replace("_", " ")}</span>
                  {" · "}
                  <span className="capitalize">{o.fulfillment.replace("_", " ")}</span>
                </p>
              </div>
              <p className="font-semibold">{formatPrice(o.total)}</p>
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">
              {(o.items as { product_name: string }[])
                ?.slice(0, 3)
                .map((i) => i.product_name)
                .join(" · ")}
              {o.items && (o.items as unknown[]).length > 3 ? " …" : ""}
            </p>
            {o.tracking_number ? (
              <p className="text-xs text-[var(--color-success)] mt-1">
                Tracking: {o.tracking_number}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

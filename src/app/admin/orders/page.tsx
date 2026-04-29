import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const supabase = createAdminClient();
  let query = supabase
    .from("orders")
    .select("id, order_number, total, status, fulfillment, email, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`order_number.ilike.%${q}%,email.ilike.%${q}%`);
  const { data: orders } = await query;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>

      <form className="mt-4 flex flex-wrap gap-2 items-center text-sm">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by order # or email"
          className="px-3 py-2 rounded-md border border-[var(--color-border)] flex-1 min-w-[240px]"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="px-3 py-2 rounded-md border border-[var(--color-border)]"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
          <option value="partially_refunded">Partially refunded</option>
          <option value="failed">Failed</option>
        </select>
        <button className="px-3 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)]">
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Fulfillment</th>
              <th>Placed</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders?.map((o) => (
              <tr key={o.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]">
                <td className="py-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                    {o.order_number}
                  </Link>
                </td>
                <td className="py-2">{o.email}</td>
                <td className="py-2 capitalize">{o.status.replace("_", " ")}</td>
                <td className="py-2 capitalize">{o.fulfillment.replace("_", " ")}</td>
                <td className="py-2">{new Date(o.created_at).toLocaleDateString()}</td>
                <td className="py-2 text-right font-semibold">{formatPrice(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders?.length ? (
          <p className="text-center text-[var(--color-muted)] py-8">No orders match.</p>
        ) : null}
      </div>
    </div>
  );
}

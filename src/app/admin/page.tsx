import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Admin dashboard",
  robots: { index: false, follow: false },
};

export default async function AdminDashboard() {
  const supabase = createAdminClient();

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceISO = since.toISOString();

  const [
    { count: orders30 },
    { data: revenueRows },
    { count: products },
    { count: customers },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sinceISO),
    supabase.from("orders").select("total").gte("created_at", sinceISO).eq("status", "paid"),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase
      .from("orders")
      .select("id, order_number, total, status, email, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const revenue30 = (revenueRows ?? []).reduce(
    (s, r) => s + Number(r.total ?? 0),
    0,
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-[var(--color-muted)] mt-1">Last 30 days</p>

      <div className="mt-6 grid sm:grid-cols-4 gap-4">
        <Stat label="Orders (30d)" value={String(orders30 ?? 0)} />
        <Stat label="Revenue (30d)" value={formatPrice(revenue30)} />
        <Stat label="Products" value={String(products ?? 0)} />
        <Stat label="Customers" value={String(customers ?? 0)} />
      </div>

      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recent orders</h2>
          <Link href="/admin/orders" className="text-sm text-[var(--color-brand-700)] hover:underline">
            All orders →
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {recent?.map((o) => (
            <li key={o.id} className="py-3 flex justify-between items-center text-sm">
              <span>
                <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                  {o.order_number}
                </Link>
                <span className="ml-3 text-[var(--color-muted)]">
                  {o.email} · {new Date(o.created_at).toLocaleDateString()} · {o.status}
                </span>
              </span>
              <span className="font-semibold">{formatPrice(o.total)}</span>
            </li>
          ))}
          {!recent?.length ? (
            <li className="py-6 text-center text-[var(--color-muted)]">No orders yet.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
    </div>
  );
}

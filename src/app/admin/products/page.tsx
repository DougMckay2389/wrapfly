import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Products",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; brand?: string; ok?: string }>;
}) {
  const { q, status, brand, ok } = await searchParams;
  const supabase = createAdminClient();

  let query = supabase
    .from("products")
    .select(
      "id, name, slug, sku, brand, base_price, cost_price, is_active, last_synced, images",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "hidden") query = query.eq("is_active", false);
  if (brand) query = query.eq("brand", brand);
  const { data: products, count } = await query;

  // Brand list for filter chip
  const { data: brandRows } = await supabase
    .from("products")
    .select("brand")
    .not("brand", "is", null)
    .limit(2000);
  const brands = Array.from(
    new Set((brandRows ?? []).map((r) => r.brand).filter(Boolean)),
  ).sort();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-[var(--color-muted)] mt-1 text-sm">
            {count ?? 0} products
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]"
        >
          <Plus className="h-4 w-4" /> New product
        </Link>
      </div>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          {ok}
        </div>
      ) : null}

      <form className="mt-4 flex flex-wrap gap-2 items-center text-sm">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name, SKU, or brand"
          className="px-3 py-2 rounded-md border border-[var(--color-border)] flex-1 min-w-[240px]"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="px-3 py-2 rounded-md border border-[var(--color-border)]"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
        </select>
        <select
          name="brand"
          defaultValue={brand ?? ""}
          className="px-3 py-2 rounded-md border border-[var(--color-border)]"
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <button className="px-3 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)]">
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Product</th>
              <th>Brand</th>
              <th>SKU</th>
              <th>Price</th>
              <th>Cost</th>
              <th>Status</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>
            {products?.map((p) => {
              const img = (p.images as string[] | null)?.[0];
              return (
                <tr key={p.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]">
                  <td className="py-2">
                    <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 hover:underline">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-8 w-8 rounded object-cover bg-[var(--color-muted-bg)]" />
                      ) : (
                        <span className="h-8 w-8 rounded bg-[var(--color-muted-bg)] inline-block" />
                      )}
                      <span className="font-medium">{p.name}</span>
                    </Link>
                  </td>
                  <td>{p.brand ?? "—"}</td>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td>{formatPrice(p.base_price)}</td>
                  <td>{p.cost_price ? formatPrice(p.cost_price) : "—"}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 text-xs ${p.is_active ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-[var(--color-success)]" : "bg-[var(--color-muted)]"}`} />
                      {p.is_active ? "Active" : "Hidden"}
                    </span>
                  </td>
                  <td className="text-xs text-[var(--color-muted)]">
                    {p.last_synced ? new Date(p.last_synced).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!products?.length ? (
          <p className="text-center text-[var(--color-muted)] py-8">No products match.</p>
        ) : null}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Products",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProducts() {
  const supabase = createAdminClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name, slug, sku, brand, base_price, is_active, last_synced, json_source_url")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
      <p className="text-[var(--color-muted)] mt-1 text-sm">
        Products are sourced from JSON feeds where available. Re-sync from
        a feed will be wired up in Phase 2.5; for now, edits to product copy
        and pricing happen in the Supabase dashboard.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Name</th>
              <th>Brand</th>
              <th>SKU</th>
              <th>Base price</th>
              <th>Status</th>
              <th>Last synced</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products?.map((p) => (
              <tr key={p.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 font-medium">
                  <Link href={`/p/${p.slug}`} className="hover:underline" target="_blank">
                    {p.name}
                  </Link>
                </td>
                <td>{p.brand ?? "—"}</td>
                <td className="font-mono text-xs">{p.sku}</td>
                <td>${Number(p.base_price).toFixed(2)}</td>
                <td>{p.is_active ? "Active" : "Hidden"}</td>
                <td className="text-xs text-[var(--color-muted)]">
                  {p.last_synced ? new Date(p.last_synced).toLocaleDateString() : "—"}
                </td>
                <td className="text-right">
                  {p.json_source_url ? (
                    <a
                      href={p.json_source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-[var(--color-muted)]"
                    >
                      Feed
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

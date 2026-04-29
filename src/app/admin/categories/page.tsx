import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Categories",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminCategories() {
  const supabase = createAdminClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, slug, path, level, display_order, is_active, image_url")
    .order("level")
    .order("display_order");

  // Count products per category for context
  const { data: counts } = await supabase
    .from("products")
    .select("category_id")
    .eq("is_active", true);
  const productCount = new Map<string, number>();
  for (const row of counts ?? []) {
    if (!row.category_id) continue;
    productCount.set(row.category_id, (productCount.get(row.category_id) ?? 0) + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="text-[var(--color-muted)] mt-1 text-sm">
            {categories?.length ?? 0} total · top level shows on the home page
          </p>
        </div>
        <Link
          href="/admin/categories/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]"
        >
          <Plus className="h-4 w-4" /> New category
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Name</th>
              <th>Path</th>
              <th>Level</th>
              <th>Order</th>
              <th>Products</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {categories?.map((c) => (
              <tr key={c.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]">
                <td className="py-2">
                  <Link href={`/admin/categories/${c.id}`} className="flex items-center gap-3 hover:underline">
                    {c.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.image_url} alt="" className="h-8 w-8 rounded object-cover bg-[var(--color-muted-bg)]" />
                    ) : (
                      <span className="h-8 w-8 rounded bg-[var(--color-muted-bg)] inline-block" />
                    )}
                    <span className="font-medium" style={{ paddingLeft: `${c.level * 12}px` }}>
                      {c.name}
                    </span>
                  </Link>
                </td>
                <td className="font-mono text-xs text-[var(--color-muted)]">{c.path}</td>
                <td>{c.level}</td>
                <td>{c.display_order}</td>
                <td>{productCount.get(c.id) ?? 0}</td>
                <td>
                  <span className={`inline-flex items-center gap-1 text-xs ${c.is_active ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${c.is_active ? "bg-[var(--color-success)]" : "bg-[var(--color-muted)]"}`} />
                    {c.is_active ? "Active" : "Hidden"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!categories?.length ? (
          <p className="text-center text-[var(--color-muted)] py-8">No categories yet.</p>
        ) : null}
      </div>
    </div>
  );
}

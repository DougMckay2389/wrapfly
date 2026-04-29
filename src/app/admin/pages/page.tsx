import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pages",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPages() {
  const supabase = createAdminClient();
  const { data: pages } = await supabase
    .from("content_pages")
    .select("id, slug, title, is_active, show_in_footer, display_order, updated_at")
    .order("display_order")
    .order("title");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pages</h1>
          <p className="text-[var(--color-muted)] mt-1 text-sm">
            About, FAQ, shipping, returns, terms — all editable here.
          </p>
        </div>
        <Link
          href="/admin/pages/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]"
        >
          <Plus className="h-4 w-4" /> New page
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Title</th>
              <th>URL</th>
              <th>Order</th>
              <th>Footer</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {pages?.map((p) => (
              <tr key={p.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]">
                <td className="py-2">
                  <Link href={`/admin/pages/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                </td>
                <td className="font-mono text-xs">/{p.slug}</td>
                <td>{p.display_order}</td>
                <td>{p.show_in_footer ? "Yes" : "No"}</td>
                <td>
                  <span className={`inline-flex items-center gap-1 text-xs ${p.is_active ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-[var(--color-success)]" : "bg-[var(--color-muted)]"}`} />
                    {p.is_active ? "Live" : "Draft"}
                  </span>
                </td>
                <td className="text-xs text-[var(--color-muted)]">
                  {new Date(p.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pages?.length ? (
          <p className="text-center text-[var(--color-muted)] py-8">No pages yet.</p>
        ) : null}
      </div>
    </div>
  );
}

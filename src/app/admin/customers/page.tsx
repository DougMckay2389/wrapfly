import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const { q, role } = await searchParams;
  const supabase = createAdminClient();

  let query = supabase
    .from("profiles")
    .select(
      "id, email, full_name, company, phone, is_admin, marketing_opt_in, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (q)
    query = query.or(
      `email.ilike.%${q}%,full_name.ilike.%${q}%,company.ilike.%${q}%`,
    );
  if (role === "admin") query = query.eq("is_admin", true);
  if (role === "customer") query = query.eq("is_admin", false);
  const { data: profiles, count } = await query;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-[var(--color-muted)] mt-1 text-sm">{count ?? 0} total</p>
        </div>
      </div>

      <form className="mt-4 flex flex-wrap gap-2 items-center text-sm">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name, email, or company"
          className="px-3 py-2 rounded-md border border-[var(--color-border)] flex-1 min-w-[240px]"
        />
        <select
          name="role"
          defaultValue={role ?? ""}
          className="px-3 py-2 rounded-md border border-[var(--color-border)]"
        >
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="admin">Admins</option>
        </select>
        <button className="px-3 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)]">
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Phone</th>
              <th>Joined</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {profiles?.map((p) => (
              <tr key={p.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted-bg)]">
                <td className="py-2">
                  <Link href={`/admin/customers/${p.id}`} className="font-medium hover:underline">
                    {p.full_name || "—"}
                  </Link>
                </td>
                <td>{p.email}</td>
                <td>{p.company ?? "—"}</td>
                <td>{p.phone ?? "—"}</td>
                <td className="text-xs text-[var(--color-muted)]">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td>
                  {p.is_admin ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-900)] font-medium">
                      Admin
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">Customer</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!profiles?.length ? (
          <p className="text-center text-[var(--color-muted)] py-8">No customers yet.</p>
        ) : null}
      </div>
    </div>
  );
}

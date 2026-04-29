import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminCustomers() {
  const supabase = createAdminClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, company, phone, is_admin, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
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
              <tr key={p.id} className="border-b border-[var(--color-border)]">
                <td className="py-2">{p.full_name ?? "—"}</td>
                <td>{p.email}</td>
                <td>{p.company ?? "—"}</td>
                <td>{p.phone ?? "—"}</td>
                <td className="text-xs text-[var(--color-muted)]">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td>{p.is_admin ? "Admin" : "Customer"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

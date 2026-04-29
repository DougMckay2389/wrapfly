import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Customer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function saveCustomer(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();
  await supabase
    .from("profiles")
    .update({
      full_name: String(formData.get("full_name") ?? "").trim() || null,
      company: String(formData.get("company") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      marketing_opt_in: formData.get("marketing_opt_in") === "on",
      is_admin: formData.get("is_admin") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  redirect(`/admin/customers/${id}?ok=1`);
}

export default async function AdminCustomerDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
  const supabase = createAdminClient();

  const [{ data: profile }, { data: orders }, { data: addresses }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, company, phone, is_admin, marketing_opt_in, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id, order_number, status, total, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("addresses")
      .select("id, label, full_name, address1, city, state, postal_code")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!profile) notFound();

  const lifetime = (orders ?? []).reduce(
    (sum, o) => sum + (o.status === "paid" || o.status === "shipped" || o.status === "delivered" ? Number(o.total) : 0),
    0,
  );
  const orderCount = orders?.length ?? 0;

  return (
    <div className="max-w-4xl">
      <Link href="/admin/customers" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All customers
      </Link>
      <div className="mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile.full_name || profile.email}
        </h1>
        <p className="text-[var(--color-muted)] mt-1">{profile.email}</p>
      </div>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          Saved.
        </div>
      ) : null}

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <Stat label="Orders" value={String(orderCount)} />
        <Stat label="Lifetime spend" value={formatPrice(lifetime)} />
        <Stat
          label="Joined"
          value={new Date(profile.created_at).toLocaleDateString()}
        />
      </div>

      <section className="mt-8 grid lg:grid-cols-[1fr_320px] gap-6">
        <div>
          <h2 className="font-semibold mb-3">Order history</h2>
          {orders?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                  <th className="py-2">Order</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-[var(--color-border)]">
                    <td className="py-2">
                      <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td className="capitalize">{o.status.replace("_", " ")}</td>
                    <td className="text-right font-semibold">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">No orders yet.</p>
          )}

          {addresses?.length ? (
            <div className="mt-8">
              <h2 className="font-semibold mb-3">Saved addresses</h2>
              <ul className="space-y-2 text-sm">
                {addresses.map((a) => (
                  <li key={a.id} className="border border-[var(--color-border)] rounded-md p-3">
                    <p className="font-medium">{a.label || a.full_name}</p>
                    <p className="text-[var(--color-muted)]">
                      {a.address1}, {a.city}, {a.state} {a.postal_code}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside>
          <form
            action={saveCustomer}
            className="border border-[var(--color-border)] rounded-lg p-5 space-y-3"
          >
            <h2 className="font-semibold">Edit customer</h2>
            <input type="hidden" name="id" value={profile.id} />
            <Field name="full_name" label="Full name" defaultValue={profile.full_name ?? ""} />
            <Field name="company" label="Company" defaultValue={profile.company ?? ""} />
            <Field name="phone" label="Phone" defaultValue={profile.phone ?? ""} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="marketing_opt_in"
                defaultChecked={profile.marketing_opt_in}
              />
              Subscribed to marketing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_admin" defaultChecked={profile.is_admin} />
              Admin role
            </label>
            <button className="w-full px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
              Save
            </button>
          </form>
        </aside>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
    </div>
  );
}

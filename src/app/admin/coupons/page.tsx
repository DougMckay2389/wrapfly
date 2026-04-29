import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Coupons",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function createCoupon(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = createAdminClient();
  await supabase.from("coupons").insert({
    code: String(formData.get("code") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || null,
    type: String(formData.get("type") ?? "percent"),
    value: Number(formData.get("value") ?? 0),
    min_subtotal: Number(formData.get("min_subtotal") ?? 0) || null,
    max_discount: Number(formData.get("max_discount") ?? 0) || null,
    usage_limit: Number(formData.get("usage_limit") ?? 0) || null,
    starts_at: String(formData.get("starts_at") ?? "") || null,
    ends_at: String(formData.get("ends_at") ?? "") || null,
    is_active: true,
  });
  redirect("/admin/coupons");
}

async function toggleCoupon(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("is_active") === "true";
  const supabase = createAdminClient();
  await supabase.from("coupons").update({ is_active: !isActive }).eq("id", id);
  redirect("/admin/coupons");
}

export default async function AdminCoupons() {
  const supabase = createAdminClient();
  const { data: coupons } = await supabase
    .from("coupons")
    .select("id, code, type, value, min_subtotal, usage_limit, uses, ends_at, is_active")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Coupons</h1>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="py-2">Code</th>
              <th>Discount</th>
              <th>Min</th>
              <th>Used</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {coupons?.map((c) => (
              <tr key={c.id} className="border-b border-[var(--color-border)]">
                <td className="py-2 font-mono">{c.code}</td>
                <td>{c.type === "percent" ? `${c.value}%` : `$${c.value}`}</td>
                <td>{c.min_subtotal ? `$${c.min_subtotal}` : "—"}</td>
                <td>{c.uses}{c.usage_limit ? ` / ${c.usage_limit}` : ""}</td>
                <td>{c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "—"}</td>
                <td>{c.is_active ? "Active" : "Disabled"}</td>
                <td className="text-right">
                  <form action={toggleCoupon}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="is_active" value={String(c.is_active)} />
                    <button className="text-xs underline">{c.is_active ? "Disable" : "Enable"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!coupons?.length ? (
          <p className="text-center text-[var(--color-muted)] py-6">No coupons yet.</p>
        ) : null}
      </div>

      <form action={createCoupon} className="mt-10 grid sm:grid-cols-3 gap-3 border-t border-[var(--color-border)] pt-6">
        <h2 className="sm:col-span-3 text-lg font-semibold">Create coupon</h2>
        <Input name="code" label="Code" required placeholder="WELCOME10" />
        <Select name="type" label="Type" defaultValue="percent">
          <option value="percent">Percent</option>
          <option value="fixed_amount">Fixed amount ($)</option>
          <option value="free_shipping">Free shipping</option>
        </Select>
        <Input name="value" label="Value" type="number" required />
        <Input name="min_subtotal" label="Minimum subtotal ($)" type="number" />
        <Input name="max_discount" label="Max discount ($)" type="number" />
        <Input name="usage_limit" label="Total usage limit" type="number" />
        <Input name="starts_at" label="Starts at" type="datetime-local" />
        <Input name="ends_at" label="Ends at" type="datetime-local" />
        <Input className="sm:col-span-3" name="description" label="Description (internal)" />
        <button className="sm:col-span-3 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]">
          Create coupon
        </button>
      </form>
    </div>
  );
}

function Input({ name, label, type = "text", required, defaultValue, placeholder, className }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm" />
    </div>
  );
}

function Select({ name, label, defaultValue, children }: { name: string; label: string; defaultValue?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm">
        {children}
      </select>
    </div>
  );
}

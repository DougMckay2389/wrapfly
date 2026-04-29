import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Addresses",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function createAddress(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/account/sign-in");
  await supabase.from("addresses").insert({
    user_id: user.id,
    label: String(formData.get("label") ?? "").trim() || null,
    full_name: String(formData.get("full_name") ?? ""),
    company: String(formData.get("company") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    address1: String(formData.get("address1") ?? ""),
    address2: String(formData.get("address2") ?? "") || null,
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? ""),
    postal_code: String(formData.get("postal_code") ?? ""),
    country: String(formData.get("country") ?? "US"),
  });
  redirect("/account/addresses");
}

async function deleteAddress(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/account/sign-in");
  const id = String(formData.get("id") ?? "");
  if (id) await supabase.from("addresses").delete().eq("id", id).eq("user_id", user.id);
  redirect("/account/addresses");
}

export default async function AddressesPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, label, full_name, address1, address2, city, state, postal_code, country, phone, is_default_shipping")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Addresses</h1>

      <ul className="mt-6 space-y-3">
        {addresses?.map((a) => (
          <li
            key={a.id}
            className="rounded-lg border border-[var(--color-border)] p-4 flex justify-between gap-4 text-sm"
          >
            <div>
              {a.label ? <p className="font-medium">{a.label}</p> : null}
              <p>{a.full_name}</p>
              <p>{a.address1}{a.address2 ? `, ${a.address2}` : ""}</p>
              <p>{a.city}, {a.state} {a.postal_code} · {a.country}</p>
              {a.phone ? <p className="text-[var(--color-muted)]">{a.phone}</p> : null}
            </div>
            <form action={deleteAddress}>
              <input type="hidden" name="id" value={a.id} />
              <button className="text-xs text-[var(--color-danger)] hover:underline">Delete</button>
            </form>
          </li>
        ))}
        {!addresses?.length ? (
          <li className="text-[var(--color-muted)]">No saved addresses yet.</li>
        ) : null}
      </ul>

      <form
        action={createAddress}
        className="mt-8 grid sm:grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-6 max-w-2xl"
      >
        <h2 className="sm:col-span-2 text-lg font-semibold">Add an address</h2>
        <Input name="label" label="Label (e.g. Home, Shop)" />
        <Input name="full_name" label="Full name" required />
        <Input name="company" label="Company" />
        <Input name="phone" label="Phone" type="tel" />
        <Input className="sm:col-span-2" name="address1" label="Address line 1" required />
        <Input className="sm:col-span-2" name="address2" label="Address line 2" />
        <Input name="city" label="City" required />
        <Input name="state" label="State" required />
        <Input name="postal_code" label="ZIP" required />
        <Input name="country" label="Country" defaultValue="US" required />
        <button
          type="submit"
          className="sm:col-span-2 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Save address
        </button>
      </form>
    </div>
  );
}

function Input({
  name,
  label,
  required,
  type = "text",
  defaultValue,
  className,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)]"
      />
    </div>
  );
}

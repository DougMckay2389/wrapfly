import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function createProduct(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(name);
  const brand = String(formData.get("brand") ?? "").trim() || null;
  const sku = String(formData.get("sku") ?? "").trim() || `WF-${Date.now()}`;
  const category_id = String(formData.get("category_id") ?? "") || null;
  const short_description = String(formData.get("short_description") ?? "").trim() || null;
  const base_price = Number(formData.get("base_price") ?? 0);
  const cost_price = Number(formData.get("cost_price") ?? 0) || null;
  const margin_percent = Number(formData.get("margin_percent") ?? 0) || null;
  const is_active = formData.get("is_active") === "on";

  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      slug,
      brand,
      sku,
      category_id,
      short_description,
      base_price,
      cost_price,
      margin_percent,
      is_active,
      images: [],
      tags: [],
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/admin/products/new?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/products/${data!.id}?ok=Created`);
}

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = createAdminClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, path")
    .eq("is_active", true)
    .order("path");

  return (
    <div className="max-w-2xl">
      <Link href="/admin/products" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All products
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New product</h1>
      <p className="text-[var(--color-muted)] mt-1 text-sm">
        Create a stub now, then add images, variants, and SEO on the next screen.
      </p>

      {error ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <form action={createProduct} className="mt-6 space-y-4">
        <Field name="name" label="Product name" required placeholder="3M™ 2080 Wrap Series" />
        <Field name="slug" label="URL slug" hint="Optional. Auto-generated from name if blank." />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="brand" label="Brand" placeholder="3M" />
          <Field name="sku" label="SKU" hint="Auto-generated if blank." />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1" htmlFor="category_id">Category</label>
          <select
            id="category_id"
            name="category_id"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
          >
            <option value="">— Uncategorized —</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.path || c.name}</option>
            ))}
          </select>
        </div>
        <Field name="short_description" label="Short description" />
        <div className="grid sm:grid-cols-3 gap-3">
          <Field name="base_price" label="Sell price ($)" type="number" step="0.01" defaultValue="0" required />
          <Field name="cost_price" label="Cost ($)" type="number" step="0.01" />
          <Field name="margin_percent" label="Margin (%)" type="number" step="0.1" defaultValue="30" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked />
          Active (visible on storefront)
        </label>
        <button className="w-full sm:w-auto px-5 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
          Create product
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  step,
  required,
  hint,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
      {hint ? <p className="text-xs text-[var(--color-muted)] mt-1">{hint}</p> : null}
    </div>
  );
}

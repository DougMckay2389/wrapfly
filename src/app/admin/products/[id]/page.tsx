import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatPrice, slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  brand: string | null;
  category_id: string | null;
  description: string | null;
  short_description: string | null;
  base_price: number;
  cost_price: number | null;
  margin_percent: number | null;
  images: string[] | null;
  tags: string[] | null;
  is_active: boolean;
  meta_title: string | null;
  meta_description: string | null;
  variant_dimensions: unknown;
  variant_options: unknown;
  grimco_url: string | null;
  json_source_url: string | null;
  last_synced: string | null;
  created_at: string;
};

async function saveProduct(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(name);
  const brand = String(formData.get("brand") ?? "").trim() || null;
  const sku = String(formData.get("sku") ?? "").trim() || null;
  const category_id = String(formData.get("category_id") ?? "") || null;
  const short_description =
    String(formData.get("short_description") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const base_price = Number(formData.get("base_price") ?? 0);
  const cost_price = Number(formData.get("cost_price") ?? 0) || null;
  const margin_percent = Number(formData.get("margin_percent") ?? 0) || null;
  const meta_title = String(formData.get("meta_title") ?? "").trim() || null;
  const meta_description =
    String(formData.get("meta_description") ?? "").trim() || null;
  const is_active = formData.get("is_active") === "on";
  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const imagesRaw = String(formData.get("images") ?? "").trim();
  const images = imagesRaw
    ? imagesRaw.split(/\r?\n/).map((u) => u.trim()).filter(Boolean)
    : [];

  await supabase
    .from("products")
    .update({
      name,
      slug,
      brand,
      sku,
      category_id,
      short_description,
      description,
      base_price,
      cost_price,
      margin_percent,
      meta_title,
      meta_description,
      is_active,
      tags,
      images,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  redirect(`/admin/products/${id}?ok=1`);
}

async function recomputePrice(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();
  const { data: p } = await supabase
    .from("products")
    .select("cost_price, margin_percent")
    .eq("id", id)
    .maybeSingle();
  if (p?.cost_price && p?.margin_percent != null) {
    const newPrice = Number(p.cost_price) * (1 + Number(p.margin_percent) / 100);
    await supabase
      .from("products")
      .update({ base_price: Math.round(newPrice * 100) / 100 })
      .eq("id", id);
  }
  redirect(`/admin/products/${id}?ok=Price+recomputed`);
}

async function deleteProduct(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();
  await supabase.from("products").delete().eq("id", id);
  redirect("/admin/products?ok=Deleted");
}

export default async function AdminProductEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
  const supabase = createAdminClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, slug, sku, brand, category_id, description, short_description, base_price, cost_price, margin_percent, images, tags, is_active, meta_title, meta_description, variant_dimensions, variant_options, grimco_url, json_source_url, last_synced, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, path")
      .eq("is_active", true)
      .order("path"),
  ]);

  if (!product) notFound();
  const p = product as ProductRow;
  const variantOptions = (p.variant_options as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="max-w-4xl">
      <Link href="/admin/products" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All products
      </Link>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
        <Link
          href={`/p/${p.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-brand-700)] hover:underline"
        >
          View on storefront <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          {ok === "1" ? "Saved." : ok}
        </div>
      ) : null}

      <form action={saveProduct} className="mt-6 grid lg:grid-cols-[1fr_320px] gap-6">
        <input type="hidden" name="id" value={p.id} />

        <div className="space-y-6">
          <Card title="Title & description">
            <Field name="name" label="Name" defaultValue={p.name} required />
            <Field name="slug" label="URL slug" defaultValue={p.slug} hint="Used in /p/<slug>. Leave blank to derive from name." />
            <Field name="short_description" label="Short description" defaultValue={p.short_description ?? ""} />
            <Textarea name="description" label="Long description" defaultValue={p.description ?? ""} rows={8} />
          </Card>

          <Card title="Pricing & cost">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field name="base_price" label="Sell price ($)" type="number" step="0.01" defaultValue={String(p.base_price)} />
              <Field name="cost_price" label="Cost price ($)" type="number" step="0.01" defaultValue={String(p.cost_price ?? "")} hint="Your cost from supplier." />
              <Field name="margin_percent" label="Margin (%)" type="number" step="0.1" defaultValue={String(p.margin_percent ?? "")} hint="Used to recompute price below." />
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-2">
              Profit per unit: {p.cost_price ? formatPrice(Number(p.base_price) - Number(p.cost_price)) : "—"}
            </p>
          </Card>

          <Card title="Images" subtitle="One URL per line. Mirrored to Supabase Storage during import; you can also paste external URLs.">
            <Textarea
              name="images"
              label="Image URLs"
              defaultValue={(p.images ?? []).join("\n")}
              rows={4}
            />
          </Card>

          <Card title="SEO" subtitle="Override the default title/description tags for this product page.">
            <Field name="meta_title" label="Meta title" defaultValue={p.meta_title ?? ""} />
            <Textarea name="meta_description" label="Meta description" defaultValue={p.meta_description ?? ""} rows={2} />
          </Card>

          <Card title="Variants" subtitle="Variant options are managed by the importer for now. Edit pricing here, edit dimensions via the Supabase table.">
            <p className="text-sm text-[var(--color-muted)]">
              {variantOptions.length ? `${variantOptions.length} variant rows` : "No variants — base product only."}
            </p>
            {p.json_source_url ? (
              <p className="text-xs mt-2">
                Source feed:{" "}
                <a className="underline" href={p.json_source_url} target="_blank" rel="noopener noreferrer">
                  {p.json_source_url}
                </a>
              </p>
            ) : null}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Status">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={p.is_active} />
              Visible on storefront
            </label>
          </Card>

          <Card title="Organization">
            <Field name="brand" label="Brand" defaultValue={p.brand ?? ""} />
            <Field name="sku" label="SKU" defaultValue={p.sku ?? ""} />
            <div>
              <label className="text-sm font-medium block mb-1" htmlFor="category_id">Category</label>
              <select
                id="category_id"
                name="category_id"
                defaultValue={p.category_id ?? ""}
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
              >
                <option value="">— Uncategorized —</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>{c.path || c.name}</option>
                ))}
              </select>
            </div>
            <Field name="tags" label="Tags" defaultValue={(p.tags ?? []).join(", ")} hint="Comma-separated. Add 'featured' to highlight on home page." />
          </Card>

          <Card title="Save changes">
            <button className="w-full px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
              Save
            </button>
          </Card>
        </aside>
      </form>

      <div className="mt-8 grid sm:grid-cols-2 gap-3 max-w-3xl">
        <form action={recomputePrice}>
          <input type="hidden" name="id" value={p.id} />
          <button className="w-full px-4 py-2 rounded-md border border-[var(--color-border)] text-sm hover:border-[var(--color-brand-900)]">
            Recompute sell price from cost × margin
          </button>
        </form>
        <form action={deleteProduct} onSubmit={undefined}>
          <input type="hidden" name="id" value={p.id} />
          <button
            className="w-full px-4 py-2 rounded-md border border-[var(--color-danger)] text-[var(--color-danger)] text-sm hover:bg-red-50 inline-flex items-center justify-center gap-2"
            // Confirmation handled at the storefront-data layer; you can wire
            // a client component for a JS confirm if desired.
          >
            <Trash2 className="h-4 w-4" /> Delete product
          </button>
        </form>
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--color-border)] rounded-lg p-5 space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {subtitle ? <p className="text-xs text-[var(--color-muted)] mt-0.5">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  step,
  required,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  step?: string;
  required?: boolean;
  hint?: string;
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
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
      {hint ? <p className="text-xs text-[var(--color-muted)] mt-1">{hint}</p> : null}
    </div>
  );
}

function Textarea({
  name,
  label,
  defaultValue,
  rows = 4,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm font-mono"
      />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Edit category",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function saveCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(name);
  const description = String(formData.get("description") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const meta_title = String(formData.get("meta_title") ?? "").trim() || null;
  const meta_description = String(formData.get("meta_description") ?? "").trim() || null;
  const display_order = Number(formData.get("display_order") ?? 0);
  const is_active = formData.get("is_active") === "on";
  const parent_id = String(formData.get("parent_id") ?? "") || null;

  // Compute level + path from parent
  let level = 0;
  let path = slug;
  if (parent_id) {
    const { data: parent } = await supabase
      .from("categories")
      .select("level, path")
      .eq("id", parent_id)
      .maybeSingle();
    if (parent) {
      level = parent.level + 1;
      path = `${parent.path}/${slug}`;
    }
  }

  await supabase
    .from("categories")
    .update({
      name,
      slug,
      description,
      image_url,
      meta_title,
      meta_description,
      display_order,
      is_active,
      parent_id,
      level,
      path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  redirect(`/admin/categories/${id}?ok=1`);
}

async function deleteCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();
  // Detach any products first; deleting a category shouldn't break products.
  await supabase.from("products").update({ category_id: null }).eq("category_id", id);
  await supabase.from("categories").delete().eq("id", id);
  redirect("/admin/categories?ok=Deleted");
}

export default async function AdminCategoryEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
  const supabase = createAdminClient();
  const [{ data: category }, { data: parents }] = await Promise.all([
    supabase
      .from("categories")
      .select(
        "id, name, slug, parent_id, level, image_url, description, display_order, is_active, path, meta_title, meta_description",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, path")
      .order("path"),
  ]);
  if (!category) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/admin/categories" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All categories
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{category.name}</h1>
      <p className="text-[var(--color-muted)] text-sm font-mono mt-1">/c/{category.path}</p>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          {ok === "1" ? "Saved." : ok}
        </div>
      ) : null}

      <form action={saveCategory} className="mt-6 space-y-4">
        <input type="hidden" name="id" value={category.id} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="name" label="Name" defaultValue={category.name} required />
          <Field name="slug" label="URL slug" defaultValue={category.slug} hint="Used in /c/<path>." />
        </div>

        <div>
          <label htmlFor="parent_id" className="text-sm font-medium block mb-1">Parent category</label>
          <select
            id="parent_id"
            name="parent_id"
            defaultValue={category.parent_id ?? ""}
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
          >
            <option value="">— Top level —</option>
            {parents?.filter((p) => p.id !== category.id).map((p) => (
              <option key={p.id} value={p.id}>{p.path}</option>
            ))}
          </select>
        </div>

        <Field name="description" label="Description" defaultValue={category.description ?? ""} />
        <Field name="image_url" label="Image URL" defaultValue={category.image_url ?? ""} hint="Tile image on the home page and category index." />

        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="display_order" label="Display order" type="number" defaultValue={String(category.display_order)} />
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input type="checkbox" name="is_active" defaultChecked={category.is_active} />
            Active
          </label>
        </div>

        <div className="border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold mb-2 text-sm uppercase tracking-wider text-[var(--color-muted)]">SEO</h2>
          <Field name="meta_title" label="Meta title" defaultValue={category.meta_title ?? ""} />
          <Field name="meta_description" label="Meta description" defaultValue={category.meta_description ?? ""} />
        </div>

        <div className="flex gap-3">
          <button className="px-5 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
            Save
          </button>
        </div>
      </form>

      <form action={deleteCategory} className="mt-8 pt-6 border-t border-[var(--color-border)]">
        <input type="hidden" name="id" value={category.id} />
        <p className="text-xs text-[var(--color-muted)] mb-2">
          Deletes this category. Products inside will be kept and moved to Uncategorized.
        </p>
        <button className="px-4 py-2 rounded-md border border-[var(--color-danger)] text-[var(--color-danger)] text-sm hover:bg-red-50">
          Delete category
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
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
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
      {hint ? <p className="text-xs text-[var(--color-muted)] mt-1">{hint}</p> : null}
    </div>
  );
}

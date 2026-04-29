import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New category",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function createCategory(formData: FormData) {
  "use server";
  await requireAdmin();
  const supabase = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(name);
  const parent_id = String(formData.get("parent_id") ?? "") || null;
  const description = String(formData.get("description") ?? "").trim() || null;
  const image_url = String(formData.get("image_url") ?? "").trim() || null;
  const display_order = Number(formData.get("display_order") ?? 0);

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

  const { data, error } = await supabase
    .from("categories")
    .insert({
      name,
      slug,
      parent_id,
      level,
      path,
      description,
      image_url,
      display_order,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    redirect(`/admin/categories/new?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/categories/${data!.id}?ok=Created`);
}

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = createAdminClient();
  const { data: parents } = await supabase
    .from("categories")
    .select("id, path")
    .order("path");

  return (
    <div className="max-w-2xl">
      <Link href="/admin/categories" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All categories
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New category</h1>

      {error ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <form action={createCategory} className="mt-6 space-y-4">
        <Field name="name" label="Name" required />
        <Field name="slug" label="URL slug" hint="Optional. Auto-generated from name." />
        <div>
          <label htmlFor="parent_id" className="text-sm font-medium block mb-1">Parent</label>
          <select
            id="parent_id"
            name="parent_id"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
          >
            <option value="">— Top level —</option>
            {parents?.map((p) => (
              <option key={p.id} value={p.id}>{p.path}</option>
            ))}
          </select>
        </div>
        <Field name="description" label="Description" />
        <Field name="image_url" label="Image URL" />
        <Field name="display_order" label="Display order" type="number" defaultValue="0" />
        <button className="px-5 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
          Create
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  hint?: string;
  defaultValue?: string;
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

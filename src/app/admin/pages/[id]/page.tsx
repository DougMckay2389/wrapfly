import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Edit page",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function savePage(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();

  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(title);
  const body_md = String(formData.get("body_md") ?? "");
  const meta_title = String(formData.get("meta_title") ?? "").trim() || null;
  const meta_description = String(formData.get("meta_description") ?? "").trim() || null;
  const display_order = Number(formData.get("display_order") ?? 0);
  const is_active = formData.get("is_active") === "on";
  const show_in_footer = formData.get("show_in_footer") === "on";

  await supabase
    .from("content_pages")
    .update({
      title,
      slug,
      body_md,
      meta_title,
      meta_description,
      display_order,
      is_active,
      show_in_footer,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  redirect(`/admin/pages/${id}?ok=1`);
}

async function deletePage(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const supabase = createAdminClient();
  await supabase.from("content_pages").delete().eq("id", id);
  redirect("/admin/pages?ok=Deleted");
}

export default async function AdminPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const { ok } = await searchParams;
  const supabase = createAdminClient();
  const { data: page } = await supabase
    .from("content_pages")
    .select("id, slug, title, body_md, meta_title, meta_description, display_order, is_active, show_in_footer")
    .eq("id", id)
    .maybeSingle();
  if (!page) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/admin/pages" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All pages
      </Link>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        {page.is_active ? (
          <Link
            href={`/${page.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-brand-700)] hover:underline"
          >
            View on storefront <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          {ok === "1" ? "Saved." : ok}
        </div>
      ) : null}

      <form action={savePage} className="mt-6 space-y-4">
        <input type="hidden" name="id" value={page.id} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="title" label="Title" defaultValue={page.title} required />
          <Field name="slug" label="URL slug" defaultValue={page.slug} hint="Page lives at /<slug>" />
        </div>
        <div>
          <label htmlFor="body_md" className="text-sm font-medium block mb-1">Body (Markdown)</label>
          <textarea
            id="body_md"
            name="body_md"
            rows={18}
            defaultValue={page.body_md}
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm font-mono"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4">
          <Field name="meta_title" label="Meta title" defaultValue={page.meta_title ?? ""} />
          <Field name="meta_description" label="Meta description" defaultValue={page.meta_description ?? ""} />
          <Field name="display_order" label="Display order" type="number" defaultValue={String(page.display_order)} />
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={page.is_active} />
              Live
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="show_in_footer" defaultChecked={page.show_in_footer} />
              Show in footer
            </label>
          </div>
        </div>
        <button className="px-5 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
          Save
        </button>
      </form>

      <form action={deletePage} className="mt-8 pt-6 border-t border-[var(--color-border)]">
        <input type="hidden" name="id" value={page.id} />
        <button className="px-4 py-2 rounded-md border border-[var(--color-danger)] text-[var(--color-danger)] text-sm hover:bg-red-50">
          Delete page
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

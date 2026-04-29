import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/utils";

export const metadata: Metadata = {
  title: "New page",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function createPage(formData: FormData) {
  "use server";
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim() || slugify(title);
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("content_pages")
    .insert({
      title,
      slug,
      body_md: `# ${title}\n\nWrite content here in Markdown.\n`,
      is_active: false,
      show_in_footer: true,
    })
    .select("id")
    .single();
  if (error) {
    redirect(`/admin/pages/new?error=${encodeURIComponent(error.message)}`);
  }
  redirect(`/admin/pages/${data!.id}?ok=Created`);
}

export default async function NewPagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl">
      <Link href="/admin/pages" className="text-sm text-[var(--color-muted)] hover:underline">
        ← All pages
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New page</h1>

      {error ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <form action={createPage} className="mt-6 space-y-4">
        <Field name="title" label="Title" required placeholder="Frequently asked questions" />
        <Field name="slug" label="URL slug" hint="Optional. Page will live at /<slug>." />
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
  required,
  hint,
  placeholder,
}: {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <input
        id={name}
        name={name}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
      {hint ? <p className="text-xs text-[var(--color-muted)] mt-1">{hint}</p> : null}
    </div>
  );
}

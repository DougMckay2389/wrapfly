import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Email templates",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function saveTemplate(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const subject = String(formData.get("subject") ?? "");
  const body_mdx = String(formData.get("body_mdx") ?? "");
  const is_active = formData.get("is_active") === "on";
  const supabase = createAdminClient();
  await supabase
    .from("email_templates")
    .update({ subject, body_mdx, is_active })
    .eq("id", id);
  redirect("/admin/email-templates?ok=1");
}

export default async function EmailTemplatesAdmin({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const supabase = createAdminClient();
  const { data: templates } = await supabase
    .from("email_templates")
    .select("id, event, subject, body_mdx, is_active, updated_at")
    .order("event");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Email templates</h1>
      <p className="text-[var(--color-muted)] mt-1 text-sm">
        Subjects and body text for each transactional email. Bodies use simple
        placeholder syntax like <code>{"{{order_number}}"}</code>; the rendering
        layer in <code>src/lib/email.ts</code> uses well-tested HTML templates
        already, so think of these as overrides for plain-text or future
        React-Email-rendered variants.
      </p>

      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          Saved.
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {templates?.map((t) => (
          <form
            key={t.id}
            action={saveTemplate}
            className="rounded-lg border border-[var(--color-border)] p-4 space-y-3"
          >
            <input type="hidden" name="id" value={t.id} />
            <div className="flex justify-between items-center">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                {t.event}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={t.is_active}
                />
                Active
              </label>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Subject</label>
              <input
                name="subject"
                defaultValue={t.subject}
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Body</label>
              <textarea
                name="body_mdx"
                defaultValue={t.body_mdx}
                rows={6}
                className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm font-mono"
              />
            </div>
            <button className="px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
              Save
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function updateProfile(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/account/sign-in");
  await supabase
    .from("profiles")
    .update({
      full_name: String(formData.get("full_name") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim() || null,
      company: String(formData.get("company") ?? "").trim() || null,
      marketing_opt_in: formData.get("marketing_opt_in") === "on",
    })
    .eq("id", user.id);
  redirect("/account/profile?ok=1");
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await requireUser();
  const { ok } = await searchParams;
  const profile = await getProfile();

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <p className="text-[var(--color-muted)] mt-1">
        Email: <code>{profile?.email}</code>
      </p>
      {ok ? (
        <div className="mt-4 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          Profile saved.
        </div>
      ) : null}
      <form action={updateProfile} className="mt-6 space-y-4">
        <Field label="Full name" name="full_name" defaultValue={profile?.full_name ?? ""} />
        <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ""} type="tel" />
        <Field label="Company" name="company" defaultValue={profile?.company ?? ""} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="marketing_opt_in"
            defaultChecked={profile?.marketing_opt_in ?? false}
          />
          Send me product updates and offers
        </label>
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Save
        </button>
      </form>
    </div>
  );
}

function Field({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue?: string; type?: string }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)]"
      />
    </div>
  );
}

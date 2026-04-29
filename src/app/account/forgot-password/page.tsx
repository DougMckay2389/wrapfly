import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account/forgot-password" },
};

async function reset(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/callback?next=/account/profile"),
  });
  // Always show "if the address exists, we sent an email" — no enumeration.
  redirect("/account/forgot-password?ok=1");
}

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  return (
    <div className="container-wf py-12 max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">Reset password</h1>
      <p className="text-[var(--color-muted)] mt-2">
        Enter your email and we&apos;ll send a link to reset your password.
      </p>

      {ok ? (
        <div className="mt-6 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          If an account exists for that email, a reset link is on the way.
        </div>
      ) : null}

      <form action={reset} className="mt-6 space-y-4">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full px-3 py-2 rounded-md border border-[var(--color-border)]"
        />
        <button
          type="submit"
          className="w-full px-4 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Send reset link
        </button>
      </form>
      <div className="mt-6 text-sm">
        <Link href="/account/sign-in" className="text-[var(--color-brand-700)] hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

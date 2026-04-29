import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account/sign-up" },
};

async function signUp(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: absoluteUrl("/auth/callback"),
    },
  });
  if (error) {
    redirect(`/account/sign-up?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/account/sign-up?ok=1");
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  return (
    <div className="container-wf py-12 max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">Create account</h1>
      <p className="text-[var(--color-muted)] mt-2">
        Track orders, save addresses, and check out fast.
      </p>

      {error ? (
        <div className="mt-6 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="mt-6 p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          Check your email to confirm your address, then sign in.
        </div>
      ) : null}

      <form action={signUp} className="mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1" htmlFor="full_name">
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
          />
          <p className="text-xs text-[var(--color-muted)] mt-1">Minimum 8 characters.</p>
        </div>
        <button
          type="submit"
          className="w-full px-4 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Create account
        </button>
      </form>

      <div className="mt-6 text-sm">
        Already have an account?{" "}
        <Link href="/account/sign-in" className="text-[var(--color-brand-700)] hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}

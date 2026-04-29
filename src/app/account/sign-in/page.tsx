import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mergeGuestCartIntoUser } from "@/lib/cart";
import { mergeGuestWishlistIntoUser } from "@/lib/wishlist";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account/sign-in" },
};

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("redirect") ?? "");
  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    redirect(`/account/sign-in?error=${encodeURIComponent(error.message)}`);
  }
  // Merge any guest cart + wishlist into the now-authenticated user.
  if (signInData.user) {
    await Promise.all([
      mergeGuestCartIntoUser().catch(() => undefined),
      mergeGuestWishlistIntoUser(signInData.user.id).catch(() => undefined),
    ]);
  }
  // If a specific redirect was requested (e.g. ?redirect=/cart), honor it.
  // Otherwise, send admins straight to the admin dashboard and customers to
  // their account dashboard.
  let target = requested || "/account";
  if (!requested && signInData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", signInData.user.id)
      .maybeSingle();
    if (profile?.is_admin) target = "/admin";
  }
  redirect(target);
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const { error, redirect: redirectTo } = await searchParams;
  return (
    <div className="container-wf py-12 max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-[var(--color-muted)] mt-2">
        Welcome back. Sign in to view orders and check out faster.
      </p>

      {error ? (
        <div className="mt-6 p-3 rounded-md border border-[var(--color-danger)] bg-red-50 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <form action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="redirect" value={redirectTo ?? ""} />
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
            autoComplete="current-password"
            className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
          />
        </div>
        <button
          type="submit"
          className="w-full px-4 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          Sign in
        </button>
      </form>

      <div className="mt-6 flex justify-between text-sm">
        <Link href="/account/forgot-password" className="text-[var(--color-brand-700)] hover:underline">
          Forgot password?
        </Link>
        <Link href="/account/sign-up" className="text-[var(--color-brand-700)] hover:underline">
          Create account
        </Link>
      </div>
    </div>
  );
}

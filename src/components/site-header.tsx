import Link from "next/link";
import { ShoppingCart, Search, User, ShieldCheck } from "lucide-react";
import { readCartCount } from "@/lib/cart";
import { getProfile } from "@/lib/auth";
import { CategoryMegaMenu } from "@/components/category-mega-menu";

export async function SiteHeader() {
  // Best-effort: cart lookup may fail when middleware hasn't run yet
  // (e.g. during static prerender). Default to 0 in that case.
  let cartCount = 0;
  try {
    cartCount = await readCartCount();
  } catch {
    cartCount = 0;
  }
  // Best-effort: profile lookup also fails outside a request scope.
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  try {
    profile = await getProfile();
  } catch {
    profile = null;
  }
  const accountHref = profile ? "/account" : "/account/sign-in";
  const accountLabel = profile
    ? `Signed in as ${profile.email}`
    : "Sign in";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="container-wf flex h-16 items-center gap-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-xl tracking-tight text-[var(--color-brand-900)]"
          aria-label="Wrapfly home"
        >
          <span className="inline-block h-7 w-7 rounded-md bg-[var(--color-brand-900)]" />
          Wrapfly
        </Link>

        <CategoryMegaMenu />

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/search"
            className="p-2 rounded-md hover:bg-[var(--color-muted-bg)]"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </Link>
          {profile?.is_admin ? (
            <Link
              href="/admin"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-900)] text-xs font-semibold hover:bg-[var(--color-brand-200)]"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </Link>
          ) : null}
          <Link
            href={accountHref}
            className="p-2 rounded-md hover:bg-[var(--color-muted-bg)]"
            aria-label={accountLabel}
            title={accountLabel}
          >
            <User className="h-5 w-5" />
          </Link>
          <Link
            href="/cart"
            className="p-2 rounded-md hover:bg-[var(--color-muted-bg)] relative"
            aria-label={`Cart (${cartCount} item${cartCount === 1 ? "" : "s"})`}
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent-600)] text-white text-[10px] font-semibold flex items-center justify-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  );
}

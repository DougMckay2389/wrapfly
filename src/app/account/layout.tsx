import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Account", href: "/account" }]} />
      <div className="container-wf pb-16 grid lg:grid-cols-[220px_1fr] gap-8">
        <aside className="lg:sticky lg:top-20 self-start">
          <nav aria-label="Account" className="flex lg:flex-col gap-1 text-sm overflow-x-auto">
            <Link href="/account" className="px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]">
              Overview
            </Link>
            <Link href="/account/orders" className="px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]">
              Orders
            </Link>
            <Link href="/account/addresses" className="px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]">
              Addresses
            </Link>
            <Link href="/account/profile" className="px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]">
              Profile
            </Link>
            <form action="/account/sign-out" method="post" className="contents">
              <button
                type="submit"
                className="px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)] text-left text-[var(--color-danger)]"
              >
                Sign out
              </button>
            </form>
          </nav>
        </aside>
        <section>{children}</section>
      </div>
    </>
  );
}

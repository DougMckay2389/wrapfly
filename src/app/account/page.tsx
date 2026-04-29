import type { Metadata } from "next";
import Link from "next/link";
import { Package, MapPin, User as UserIcon } from "lucide-react";
import { requireUser, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account" },
};

export const dynamic = "force-dynamic";

export default async function AccountHome() {
  await requireUser();
  const profile = await getProfile();
  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("orders")
    .select("order_number, total, status, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.
      </h1>
      <p className="text-[var(--color-muted)] mt-1">
        Here&apos;s a quick look at your account.
      </p>

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <Tile href="/account/orders" icon={Package} title="Recent orders" body={`${recent?.length ?? 0} order${(recent?.length ?? 0) === 1 ? "" : "s"}`} />
        <Tile href="/account/addresses" icon={MapPin} title="Addresses" body="Save addresses for fast checkout" />
        <Tile href="/account/profile" icon={UserIcon} title="Profile" body={profile?.email ?? ""} />
      </div>

      {recent?.length ? (
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-3">Recent orders</h2>
          <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {recent.map((o) => (
              <li key={o.order_number} className="py-3 flex justify-between items-center text-sm">
                <span>
                  <Link href={`/account/orders`} className="font-medium hover:underline">
                    {o.order_number}
                  </Link>
                  <span className="ml-3 text-[var(--color-muted)]">
                    {new Date(o.created_at).toLocaleDateString()} · {o.status}
                  </span>
                </span>
                <span className="font-semibold">{formatPrice(o.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="block p-4 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-brand-900)] transition-colors"
    >
      <Icon className="h-5 w-5 text-[var(--color-brand-700)]" />
      <p className="mt-2 font-semibold">{title}</p>
      <p className="text-sm text-[var(--color-muted)] mt-0.5">{body}</p>
    </Link>
  );
}

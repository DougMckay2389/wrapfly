import Link from "next/link";
import {
  Package,
  Tag,
  Mail,
  Box,
  Users,
  BarChart3,
  FolderTree,
  FileText,
  Settings as SettingsIcon,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="container-wf py-6 grid lg:grid-cols-[220px_1fr] gap-8">
      <aside className="lg:sticky lg:top-20 self-start">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
          Admin
        </div>
        <nav aria-label="Admin" className="flex lg:flex-col gap-1 text-sm overflow-x-auto">
          <Item href="/admin" icon={BarChart3} label="Dashboard" />
          <Item href="/admin/orders" icon={Package} label="Orders" />
          <Item href="/admin/products" icon={Box} label="Products" />
          <Item href="/admin/categories" icon={FolderTree} label="Categories" />
          <Item href="/admin/coupons" icon={Tag} label="Discounts" />
          <Item href="/admin/customers" icon={Users} label="Customers" />
          <Item href="/admin/pages" icon={FileText} label="Pages" />
          <Item href="/admin/email-templates" icon={Mail} label="Email templates" />
          <Item href="/admin/settings" icon={SettingsIcon} label="Settings" />
        </nav>
        <div className="mt-6 text-xs text-[var(--color-muted)]">
          <Link href="/" className="hover:underline">← Back to storefront</Link>
        </div>
      </aside>
      <section>{children}</section>
    </div>
  );
}

function Item({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

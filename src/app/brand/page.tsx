import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { createAdminClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "All Brands",
  description:
    "Shop by brand at Wrapfly — 3M, Avery Dennison, Oracal, Briteline, Mimaki, Epson and more. Wholesale pricing on premium materials and equipment.",
  alternates: { canonical: "/brand" },
};

type BrandRow = {
  brand: string;
  product_count: number;
};

export default async function BrandsIndex() {
  const supabase = createAdminClient();
  // Aggregate active products by brand
  const { data: rows } = await supabase
    .from("products")
    .select("brand")
    .eq("is_active", true)
    .not("brand", "is", null);

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.brand) continue;
    counts.set(r.brand, (counts.get(r.brand) ?? 0) + 1);
  }
  const brands: BrandRow[] = [...counts.entries()]
    .map(([brand, product_count]) => ({ brand, product_count }))
    .sort((a, b) => b.product_count - a.product_count || a.brand.localeCompare(b.brand));

  return (
    <>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Brands", href: "/brand" }]} />
      <div className="container-wf pb-16">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Shop by brand
        </h1>
        <p className="text-[var(--color-muted)] mt-2 max-w-2xl">
          {brands.length} brands stocked. Authentic materials direct from manufacturers
          with same-day shipping on most orders.
        </p>

        {brands.length === 0 ? (
          <p className="mt-10 text-[var(--color-muted)]">No brands yet.</p>
        ) : (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {brands.map((b) => (
              <Link
                key={b.brand}
                href={`/brand/${slugify(b.brand)}`}
                className="block rounded-lg border border-[var(--color-border)] bg-white p-4 hover:border-[var(--color-brand-700)] hover:shadow-sm transition"
              >
                <p className="font-semibold text-[var(--color-brand-900)]">{b.brand}</p>
                <p className="text-xs text-[var(--color-muted)] mt-1">
                  {b.product_count} product{b.product_count === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

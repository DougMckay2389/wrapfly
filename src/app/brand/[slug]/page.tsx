import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductCard } from "@/components/product-card";
import { createAdminClient } from "@/lib/supabase/server";
import { absoluteUrl, slugify } from "@/lib/utils";

export const revalidate = 600;

type Params = { params: Promise<{ slug: string }> };

async function loadBrand(slug: string) {
  const supabase = createAdminClient();
  // Brand is stored as free text on products. We resolve a slug back by
  // looking for any product whose slugified brand matches.
  const { data: probe } = await supabase
    .from("products")
    .select("brand")
    .not("brand", "is", null)
    .limit(1000);
  const brandName = (probe ?? [])
    .map((r) => r.brand!)
    .find((b) => slugify(b) === slug);
  if (!brandName) return null;

  const { data: products } = await supabase
    .from("products")
    .select("id, name, slug, brand, base_price, images, short_description, category_id")
    .eq("is_active", true)
    .eq("brand", brandName)
    .order("created_at", { ascending: false });

  return { brandName, products: products ?? [] };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadBrand(slug);
  if (!data) return { title: "Brand not found" };
  const { brandName, products } = data;
  const description =
    `Shop ${brandName} at Wrapfly — ${products.length} authentic ${brandName} products with wholesale pricing and fast shipping. ` +
    `Vinyl wraps, sign materials, and print supplies trusted by sign shops and wrap installers.`;
  return {
    title: brandName,
    description,
    alternates: { canonical: `/brand/${slug}` },
    openGraph: {
      title: `${brandName} | Wrapfly`,
      description,
      url: `/brand/${slug}`,
      type: "website",
    },
  };
}

export default async function BrandPage({ params }: Params) {
  const { slug } = await params;
  const data = await loadBrand(slug);
  if (!data) notFound();
  const { brandName, products } = data;

  // Schema.org Brand + ItemList for SEO
  const brandLd = {
    "@context": "https://schema.org",
    "@type": "Brand",
    name: brandName,
    url: absoluteUrl(`/brand/${slug}`),
  };
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.slice(0, 50).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/p/${p.slug}`),
      name: p.name,
    })),
  };

  return (
    <>
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Brands", href: "/brand" },
        { label: brandName, href: `/brand/${slug}` },
      ]} />
      <div className="container-wf pb-16">
        <header className="pb-6">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {brandName}
          </h1>
          <p className="text-[var(--color-muted)] mt-2 max-w-3xl">
            {products.length} authentic {brandName} product{products.length === 1 ? "" : "s"} stocked.
            Wholesale pricing for sign shops and wrap installers, with same-day shipping on orders before 2pm CT.
          </p>
        </header>

        {products.length ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {products.map((p) => (
              <ProductCard
                key={p.slug}
                slug={p.slug}
                name={p.name}
                brand={p.brand}
                basePrice={p.base_price}
                image={(p.images as string[])?.[0]}
              />
            ))}
          </div>
        ) : (
          <p className="text-[var(--color-muted)] py-8">
            No active products from {brandName} yet.{" "}
            <Link href="/c" className="underline">Browse all categories</Link>.
          </p>
        )}
      </div>

      <Script
        id={`ld-brand-${slug}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(brandLd) }}
      />
      <Script
        id={`ld-brand-list-${slug}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
    </>
  );
}

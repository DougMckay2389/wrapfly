import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { VariantSelector } from "@/components/variant-selector";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/utils";
import type {
  Product,
  ProductVariant,
  Category,
} from "@/lib/types";

export const revalidate = 600;

type Params = { params: Promise<{ slug: string }> };

async function loadProduct(slug: string) {
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select(
      "id, name, slug, sku, category_id, brand, description, short_description, base_price, images, specifications, resources, variant_dimensions, variant_options, tags, is_active, meta_title, meta_description, rating_avg, review_count, enriched_features",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle<Product>();

  if (!product) return null;

  const { data: variants } = await supabase
    .from("product_variants")
    .select(
      "id, sku, combination, price, compare_price, stock_qty, image_url, is_available",
    )
    .eq("product_id", product.id)
    .order("price");

  // Build category trail for breadcrumbs.
  const trail: Crumb[] = [{ label: "Home", href: "/" }];
  if (product.category_id) {
    const { data: leaf } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, path")
      .eq("id", product.category_id)
      .maybeSingle<Category>();
    if (leaf) {
      const chain: { name: string; path: string }[] = [
        { name: leaf.name, path: leaf.path },
      ];
      let cursor: Pick<Category, "id" | "parent_id" | "path" | "name"> | null = leaf;
      while (cursor?.parent_id) {
        const { data: parentRow } = await supabase
          .from("categories")
          .select("id, name, slug, parent_id, path")
          .eq("id", cursor.parent_id)
          .maybeSingle<Category>();
        const parent = parentRow as Category | null;
        if (!parent) break;
        chain.unshift({ name: parent.name, path: parent.path });
        cursor = parent;
      }
      for (const c of chain) trail.push({ label: c.name, href: `/c/${c.path}` });
    }
  }
  trail.push({ label: product.name, href: `/p/${product.slug}` });

  return { product, variants: (variants ?? []) as ProductVariant[], trail };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) return { title: "Product not found" };
  const { product } = data;
  // If meta_title is set, treat it as a complete title (already has brand);
  // otherwise let the root layout's template append " | Wrapfly".
  const title = product.meta_title ?? product.name;
  const titleField = product.meta_title
    ? { absolute: product.meta_title }
    : product.name;
  const description =
    product.meta_description ??
    product.short_description ??
    `Buy ${product.name} at Wrapfly — premium quality with fast shipping.`;
  const url = `/p/${product.slug}`;
  const ogImage = product.images?.[0];
  return {
    title: titleField,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) notFound();
  const { product, variants, trail } = data;

  // Cheapest in-stock variant for "from" pricing on the schema.
  const inStock = variants.filter((v) => v.is_available && v.stock_qty > 0);
  const cheapest = inStock.reduce<ProductVariant | undefined>(
    (acc, v) => (acc == null || v.price < acc.price ? v : acc),
    undefined,
  );
  const priceLow = cheapest?.price ?? product.base_price;
  const priceHigh = inStock.length
    ? Math.max(...inStock.map((v) => v.price))
    : product.base_price;

  // Schema.org Product with offers (or AggregateOffer if a range).
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    brand: product.brand
      ? { "@type": "Brand", name: product.brand }
      : undefined,
    description:
      product.meta_description ??
      product.short_description ??
      product.description ??
      undefined,
    image: product.images,
    url: absoluteUrl(`/p/${product.slug}`),
    aggregateRating:
      product.rating_avg && product.review_count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: product.rating_avg,
            reviewCount: product.review_count,
          }
        : undefined,
    offers:
      inStock.length > 1 && priceLow !== priceHigh
        ? {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: priceLow,
            highPrice: priceHigh,
            offerCount: inStock.length,
            availability: "https://schema.org/InStock",
          }
        : {
            "@type": "Offer",
            priceCurrency: "USD",
            price: priceLow,
            availability: inStock.length
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            url: absoluteUrl(`/p/${product.slug}`),
            itemCondition: "https://schema.org/NewCondition",
          },
  };

  return (
    <>
      <Breadcrumbs items={trail} />
      <div className="container-wf pb-16">
        <VariantSelector product={product} variants={variants} />

        <section className="mt-16 grid lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-10">
            {product.description ? (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight mb-3">
                  About {product.name}
                </h2>
                <div className="prose prose-slate max-w-none whitespace-pre-line text-[var(--color-fg)]">
                  {product.description}
                </div>
              </div>
            ) : null}

            {product.enriched_features?.length ? (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight mb-3">
                  Key features
                </h2>
                <ul className="space-y-2 list-disc pl-5 text-[var(--color-fg)]">
                  {product.enriched_features.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {product.specifications?.length ? (
              <div>
                <h2 className="text-2xl font-semibold tracking-tight mb-3">
                  Specifications
                </h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  {product.specifications.map((s, i) => (
                    <div
                      key={i}
                      className="flex justify-between gap-4 py-2 border-b border-[var(--color-border)]"
                    >
                      <dt className="text-[var(--color-muted)]">{s.label}</dt>
                      <dd className="font-medium text-right">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>

          {product.resources?.length ? (
            <aside>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
                Downloads & resources
              </h2>
              <ul className="space-y-2">
                {product.resources.map((r, i) => (
                  <li key={i}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)] text-sm"
                    >
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-[var(--color-muted)] truncate mt-0.5">
                        {r.url}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </section>
      </div>

      <Script
        id={`ld-product-${product.slug}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
    </>
  );
}

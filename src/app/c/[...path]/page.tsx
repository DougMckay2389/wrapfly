import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryCard } from "@/components/category-card";
import { ProductCard } from "@/components/product-card";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/utils";

export const revalidate = 600;

type Params = { params: Promise<{ path: string[] }> };

async function loadCategory(path: string[]) {
  const supabase = await createClient();
  const fullPath = path.join("/");

  const { data: category } = await supabase
    .from("categories")
    .select("id, name, slug, description, image_url, path, level, parent_id, meta_title, meta_description")
    .eq("path", fullPath)
    .eq("is_active", true)
    .maybeSingle();

  if (!category) return null;

  const [{ data: subs }, { data: products }] = await Promise.all([
    supabase
      .from("categories")
      .select("name, slug, description, image_url, path")
      .eq("parent_id", category.id)
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("products")
      .select("name, slug, brand, base_price, images")
      .eq("category_id", category.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(48),
  ]);

  // Build breadcrumb chain by walking up parent_id.
  const trail: Crumb[] = [{ label: "Home", href: "/" }];
  let cursor = category;
  const chain: typeof category[] = [category];
  while (cursor.parent_id) {
    const { data: parent } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, path")
      .eq("id", cursor.parent_id)
      .single();
    if (!parent) break;
    chain.unshift(parent as typeof category);
    cursor = parent as typeof category;
  }
  for (const c of chain) trail.push({ label: c.name, href: `/c/${c.path}` });

  return { category, subs: subs ?? [], products: products ?? [], trail };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { path } = await params;
  const data = await loadCategory(path);
  if (!data) return { title: "Category not found" };
  const { category } = data;
  const description =
    category.meta_description ??
    category.description ??
    `Shop ${category.name} at Wrapfly — premium materials with fast shipping and trade pricing.`;
  const url = `/c/${category.path}`;
  // If meta_title is set, treat it as already-complete (don't append brand).
  // Otherwise pass a plain string so the layout's "%s | Wrapfly" template runs.
  const titleField = category.meta_title
    ? { absolute: category.meta_title }
    : category.name;
  return {
    title: titleField,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: category.meta_title ?? `${category.name} | Wrapfly`,
      description,
      url,
      type: "website",
    },
  };
}

export default async function CategoryPage({ params }: Params) {
  const { path } = await params;
  const data = await loadCategory(path);
  if (!data) notFound();
  const { category, subs, products, trail } = data;

  // ItemList JSON-LD for category pages helps Google build product carousels.
  const itemListLd = products.length
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: products.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: absoluteUrl(`/p/${p.slug}`),
          name: p.name,
        })),
      }
    : null;

  return (
    <>
      <Breadcrumbs items={trail} />
      <div className="container-wf">
        <header className="pb-6">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {category.name}
          </h1>
          {category.description ? (
            <p className="mt-2 max-w-3xl text-[var(--color-muted)]">
              {category.description}
            </p>
          ) : null}
        </header>

        {subs.length ? (
          <section className="pb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
              Sub-categories
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {subs.map((s) => (
                <CategoryCard
                  key={s.slug}
                  href={`/c/${s.path}`}
                  name={s.name}
                  description={s.description}
                  imageUrl={s.image_url}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="pb-16">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              {products.length ? `${products.length} products` : "Products"}
            </h2>
          </div>
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
              No products in this category yet — they’re being onboarded. Check back soon.
            </p>
          )}
        </section>
      </div>

      {itemListLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
        />
      ) : null}
    </>
  );
}

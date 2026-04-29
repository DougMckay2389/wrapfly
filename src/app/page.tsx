import Link from "next/link";
import { ArrowRight, Truck, Shield, Headphones, Zap } from "lucide-react";
import { CategoryCard } from "@/components/category-card";
import { ProductCard } from "@/components/product-card";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 600; // 10 min ISR

type TopCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  path: string;
  level: number;
};

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: topCats }, { data: subCats }, { data: featured }, { data: newest }, { data: prods }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, slug, description, image_url, path, level")
        .eq("level", 0)
        .eq("is_active", true)
        .order("display_order"),
      // Pull all subcategories with products for the secondary grid
      supabase
        .from("categories")
        .select("id, name, slug, path, image_url, parent_id")
        .eq("level", 1)
        .eq("is_active", true)
        .order("display_order"),
      // Editor-curated highlights (tagged "featured" in admin)
      supabase
        .from("products")
        .select("name, slug, brand, base_price, images")
        .eq("is_active", true)
        .contains("tags", ["featured"])
        .order("created_at", { ascending: false })
        .limit(8),
      // New arrivals fallback if no featured products exist yet
      supabase
        .from("products")
        .select("name, slug, brand, base_price, images")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(8),
      // For computing per-category counts
      supabase
        .from("products")
        .select("category_id")
        .eq("is_active", true),
    ]);

  // Build a recursive product count per category (including descendants).
  // Walk every product → its leaf category → all ancestor categories.
  const counts = new Map<string, number>();
  const allCats = [...(topCats ?? []), ...(subCats ?? [])];
  const byId = new Map<string, { id: string; path: string }>();
  for (const c of allCats) byId.set(c.id, { id: c.id, path: c.path });
  const idsByPath = new Map<string, string>();
  for (const c of allCats) idsByPath.set(c.path, c.id);

  for (const p of prods ?? []) {
    if (!p.category_id) continue;
    const leaf = byId.get(p.category_id);
    if (!leaf) continue;
    const parts = leaf.path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const id = idsByPath.get(prefix);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  // Group subcategories by parent for the popular-subcategories strip
  type SubCat = {
    id: string;
    name: string;
    slug: string;
    path: string;
    image_url: string | null;
    parent_id: string | null;
  };
  const subsByParent = new Map<string, SubCat[]>();
  for (const s of (subCats as SubCat[] | null) ?? []) {
    if (!s.parent_id) continue;
    const arr = subsByParent.get(s.parent_id) ?? [];
    arr.push(s);
    subsByParent.set(s.parent_id, arr);
  }

  const top = (topCats ?? []) as TopCategory[];

  return (
    <>
      {/* Hero */}
      <section className="bg-[var(--color-brand-900)] text-white">
        <div className="container-wf py-16 md:py-24 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-brand-300)]">
              Wholesale supplier
            </p>
            <h1 className="mt-4 text-4xl md:text-5xl font-semibold leading-tight tracking-tight">
              Premium materials for sign shops and wrap installers.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-[var(--color-brand-200)]">
              3M, Avery, Oracal, and the brands you trust — vinyl, substrates,
              equipment, and accessories. <strong className="text-white">Same-day shipping</strong>{" "}
              on orders placed before 2pm CT.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/c/vinyl-rolls"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-white text-[var(--color-brand-900)] font-semibold hover:bg-[var(--color-brand-100)]"
              >
                Shop Vinyl Rolls <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/c"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-white/20 hover:bg-white/10 font-semibold"
              >
                Browse all categories
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Truck, label: "Fast shipping", body: "Most orders ship same day from US warehouses." },
              { icon: Shield, label: "Authentic stock", body: "Direct relationships with 3M, Avery, Oracal." },
              { icon: Zap, label: "Pro pricing", body: "Trade pricing on roll quantities and bulk orders." },
              { icon: Headphones, label: "Real support", body: "Wrap installers on staff. Call for product help." },
            ].map(({ icon: Icon, label, body }) => (
              <div
                key={label}
                className="p-4 rounded-lg bg-white/5 border border-white/10"
              >
                <Icon className="h-5 w-5 text-[var(--color-brand-300)]" />
                <p className="mt-2 font-semibold">{label}</p>
                <p className="text-sm text-[var(--color-brand-300)] mt-1">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top-level categories */}
      <section className="container-wf py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Shop by category
            </h2>
            <p className="text-[var(--color-muted)] mt-1">
              Everything sign shops, wrap installers, and print pros need.
            </p>
          </div>
          <Link
            href="/c"
            className="text-sm font-medium text-[var(--color-brand-900)] hover:underline"
          >
            See all
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {top.map((c) => (
            <CategoryCard
              key={c.slug}
              href={`/c/${c.path}`}
              name={c.name}
              slug={c.slug}
              description={c.description}
              imageUrl={c.image_url}
              productCount={counts.get(c.id)}
            />
          ))}
        </div>
      </section>

      {/* Quick browse strip — first few populated subcategories per top-level */}
      <section className="bg-[var(--color-muted-bg)] border-y border-[var(--color-border)]">
        <div className="container-wf py-12">
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight mb-6">
            Popular subcategories
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {top.map((parent) => {
              const subs = subsByParent.get(parent.id) ?? [];
              const populated = subs
                .map((s) => ({ ...s, count: counts.get(s.id) ?? 0 }))
                .filter((s) => s.count > 0)
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
              if (!populated.length) return null;
              return (
                <div
                  key={parent.id}
                  className="rounded-lg bg-white border border-[var(--color-border)] p-4"
                >
                  <Link
                    href={`/c/${parent.path}`}
                    className="font-semibold text-sm hover:underline"
                  >
                    {parent.name} →
                  </Link>
                  <ul className="mt-3 space-y-1.5">
                    {populated.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/c/${s.path}`}
                          className="flex items-center justify-between text-sm text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
                        >
                          <span className="truncate pr-2">{s.name}</span>
                          <span className="text-xs text-[var(--color-muted)] shrink-0">
                            {s.count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Featured (editor-picked) — only shown if any product is tagged 'featured' */}
      {featured?.length ? (
        <section className="container-wf py-16">
          <div className="flex items-end justify-between mb-8">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Featured
            </h2>
            <Link
              href="/search"
              className="text-sm font-medium text-[var(--color-brand-900)] hover:underline"
            >
              See more
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {featured.map((p) => (
              <ProductCard
                key={p.slug}
                slug={p.slug}
                name={p.name}
                brand={p.brand}
                basePrice={p.base_price}
                image={(p.images as string[])?.[0]}
                badge="Featured"
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* New arrivals — always visible */}
      {newest?.length ? (
        <section className="container-wf pb-16">
          <div className="flex items-end justify-between mb-8">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              New arrivals
            </h2>
            <Link
              href="/search"
              className="text-sm font-medium text-[var(--color-brand-900)] hover:underline"
            >
              See more
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {newest.map((p) => (
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
        </section>
      ) : null}
    </>
  );
}

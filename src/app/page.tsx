import Link from "next/link";
import { ArrowRight, Truck, Shield, Headphones, Zap } from "lucide-react";
import { CategoryCard } from "@/components/category-card";
import { ProductCard } from "@/components/product-card";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 600; // 10 min ISR

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: categories }, { data: featured }] = await Promise.all([
    supabase
      .from("categories")
      .select("name, slug, description, image_url, path, level")
      .eq("level", 0)
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("products")
      .select("name, slug, brand, base_price, images")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

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

      {/* Categories */}
      <section className="container-wf py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Shop by category
            </h2>
            <p className="text-[var(--color-muted)] mt-1">
              Everything sign shops need under one roof.
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
          {categories?.map((c) => (
            <CategoryCard
              key={c.slug}
              href={`/c/${c.path}`}
              name={c.name}
              description={c.description}
              imageUrl={c.image_url}
            />
          ))}
        </div>
      </section>

      {/* Featured products */}
      {featured?.length ? (
        <section className="container-wf pb-16">
          <div className="flex items-end justify-between mb-8">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Featured products
            </h2>
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
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

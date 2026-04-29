import type { Metadata } from "next";
import Link from "next/link";
import { CategoryCard } from "@/components/category-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "All Categories",
  description:
    "Browse every category at Wrapfly — vinyl wraps, substrates, sign supplies, equipment, inks, apparel, automotive films, and more.",
  alternates: { canonical: "/c" },
};

export default async function AllCategoriesPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, slug, description, image_url, path, level, parent_id")
    .eq("is_active", true)
    .order("level")
    .order("display_order");

  const roots = categories?.filter((c) => c.level === 0) ?? [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Categories", href: "/c" }]} />
      <div className="container-wf pb-16">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          All categories
        </h1>
        <p className="text-[var(--color-muted)] mt-2 max-w-2xl">
          Browse our full catalog of materials and supplies.
        </p>

        <div className="mt-10 space-y-12">
          {roots.map((root) => {
            const subs = categories?.filter((c) => c.parent_id === root.id) ?? [];
            return (
              <section key={root.slug}>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="text-xl font-semibold">{root.name}</h2>
                  <Link
                    href={`/c/${root.path}`}
                    className="text-sm text-[var(--color-brand-700)] hover:underline"
                  >
                    Shop all in {root.name} →
                  </Link>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {subs.length
                    ? subs.map((c) => (
                        <CategoryCard
                          key={c.slug}
                          href={`/c/${c.path}`}
                          name={c.name}
                          slug={c.slug}
                          description={c.description}
                          imageUrl={c.image_url}
                        />
                      ))
                    : (
                        <CategoryCard
                          href={`/c/${root.path}`}
                          name={root.name}
                          slug={root.slug}
                          description={root.description}
                          imageUrl={root.image_url}
                        />
                      )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

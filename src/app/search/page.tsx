import type { Metadata } from "next";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const title = q ? `Search results for "${q}"` : "Search";
  return {
    title,
    description: q
      ? `Wrapfly search results for "${q}" — vinyl, substrates, equipment, and accessories.`
      : "Search Wrapfly's full catalog of vinyl, substrates, sign supplies, equipment, and accessories.",
    alternates: { canonical: q ? `/search?q=${encodeURIComponent(q)}` : "/search" },
    robots: { index: false, follow: true },
  };
}

type SP = {
  q?: string;
  brand?: string;
  cat?: string;
  min?: string;
  max?: string;
  sort?: string;
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  base_price: number;
  images: string[] | null;
  category_id: string | null;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const brandFilter = sp.brand ?? "";
  const catFilter = sp.cat ?? "";
  const minPrice = sp.min ? Number(sp.min) : undefined;
  const maxPrice = sp.max ? Number(sp.max) : undefined;
  const sort = sp.sort ?? "relevance";

  const supabase = await createClient();
  let results: ProductRow[] = [];
  const ran = query.length >= 2;

  if (ran) {
    const safe = query.replace(/[%_]/g, "");
    const like = `%${safe}%`;
    let q = supabase
      .from("products")
      .select("id, name, slug, brand, base_price, images, category_id")
      .eq("is_active", true)
      .or(
        [
          `name.ilike.${like}`,
          `brand.ilike.${like}`,
          `sku.ilike.${like}`,
          `short_description.ilike.${like}`,
        ].join(","),
      )
      .limit(200);
    if (brandFilter) q = q.eq("brand", brandFilter);
    if (minPrice !== undefined && !isNaN(minPrice)) q = q.gte("base_price", minPrice);
    if (maxPrice !== undefined && !isNaN(maxPrice)) q = q.lte("base_price", maxPrice);
    if (sort === "price_asc") q = q.order("base_price", { ascending: true });
    else if (sort === "price_desc") q = q.order("base_price", { ascending: false });
    else if (sort === "newest") q = q.order("created_at", { ascending: false });

    const { data } = await q;
    results = (data ?? []) as ProductRow[];
  }

  // Apply category filter post-fetch (path-based) so descendants are included
  let categoryById = new Map<string, { id: string; name: string; path: string }>();
  let pathById = new Map<string, string>();
  if (ran) {
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name, path, level")
      .eq("is_active", true);
    for (const c of cats ?? []) {
      categoryById.set(c.id, { id: c.id, name: c.name, path: c.path });
      pathById.set(c.id, c.path);
    }
    if (catFilter) {
      results = results.filter((p) => {
        if (!p.category_id) return false;
        const path = pathById.get(p.category_id);
        if (!path) return false;
        return path === catFilter || path.startsWith(`${catFilter}/`);
      });
    }
  }

  // Build facet counts from the un-faceted result set
  const brandCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const p of results) {
    if (p.brand) brandCounts.set(p.brand, (brandCounts.get(p.brand) ?? 0) + 1);
    if (p.category_id) {
      const path = pathById.get(p.category_id);
      if (!path) continue;
      const top = path.split("/")[0];
      catCounts.set(top, (catCounts.get(top) ?? 0) + 1);
    }
  }
  const topBrands = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);

  function buildHref(overrides: Partial<SP>) {
    const merged: SP = { ...sp, ...overrides };
    const pairs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return pairs.length ? `/search?${pairs.join("&")}` : "/search";
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Search", href: "/search" },
        ]}
      />
      <div className="container-wf pb-16">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          {query ? `Results for "${query}"` : "Search Wrapfly"}
        </h1>

        <form
          action="/search"
          method="get"
          role="search"
          className="mt-6 flex gap-2 max-w-2xl"
        >
          <div className="flex-1 relative">
            <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
            <input
              name="q"
              type="search"
              defaultValue={query}
              placeholder="3M wrap, banner film, plotter cutter…"
              autoComplete="off"
              required
              minLength={2}
              className="w-full pl-9 pr-3 py-2.5 rounded-md border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-900)]"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
          >
            Search
          </button>
        </form>

        {!ran ? (
          <p className="text-sm text-[var(--color-muted)] mt-4">
            {query ? "Type at least 2 characters." : "Search by product name, brand, or SKU."}
          </p>
        ) : (
          <div className="mt-8 grid lg:grid-cols-[240px_1fr] gap-8">
            {/* Facet sidebar */}
            <aside className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-2">
                  Sort
                </p>
                <div className="space-y-1">
                  {[
                    ["relevance", "Relevance"],
                    ["newest", "Newest"],
                    ["price_asc", "Price: low to high"],
                    ["price_desc", "Price: high to low"],
                  ].map(([v, l]) => (
                    <Link
                      key={v}
                      href={buildHref({ sort: v })}
                      className={`block text-sm px-2 py-1 rounded ${sort === v ? "bg-[var(--color-brand-100)] font-medium text-[var(--color-brand-900)]" : "text-[var(--color-brand-700)] hover:bg-[var(--color-muted-bg)]"}`}
                    >
                      {l}
                    </Link>
                  ))}
                </div>
              </div>

              {topCats.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-2">
                    Category
                  </p>
                  <div className="space-y-1">
                    {catFilter ? (
                      <Link href={buildHref({ cat: "" })} className="block text-xs underline text-[var(--color-muted)] mb-1">
                        Clear
                      </Link>
                    ) : null}
                    {topCats.map(([path, n]) => {
                      const cat = [...categoryById.values()].find((c) => c.path === path);
                      const label = cat?.name ?? path;
                      const active = catFilter === path;
                      return (
                        <Link
                          key={path}
                          href={buildHref({ cat: active ? "" : path })}
                          className={`flex items-center justify-between text-sm px-2 py-1 rounded ${active ? "bg-[var(--color-brand-100)] font-medium text-[var(--color-brand-900)]" : "text-[var(--color-brand-700)] hover:bg-[var(--color-muted-bg)]"}`}
                        >
                          <span>{label}</span>
                          <span className="text-xs text-[var(--color-muted)]">{n}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {topBrands.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-2">
                    Brand
                  </p>
                  <div className="space-y-1">
                    {brandFilter ? (
                      <Link href={buildHref({ brand: "" })} className="block text-xs underline text-[var(--color-muted)] mb-1">
                        Clear
                      </Link>
                    ) : null}
                    {topBrands.map(([b, n]) => {
                      const active = brandFilter === b;
                      return (
                        <Link
                          key={b}
                          href={buildHref({ brand: active ? "" : b })}
                          className={`flex items-center justify-between text-sm px-2 py-1 rounded ${active ? "bg-[var(--color-brand-100)] font-medium text-[var(--color-brand-900)]" : "text-[var(--color-brand-700)] hover:bg-[var(--color-muted-bg)]"}`}
                        >
                          <span>{b}</span>
                          <span className="text-xs text-[var(--color-muted)]">{n}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <form action="/search" method="get" className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Price
                </p>
                <input type="hidden" name="q" value={query} />
                {brandFilter ? <input type="hidden" name="brand" value={brandFilter} /> : null}
                {catFilter ? <input type="hidden" name="cat" value={catFilter} /> : null}
                {sort !== "relevance" ? <input type="hidden" name="sort" value={sort} /> : null}
                <div className="flex gap-2">
                  <input
                    name="min"
                    type="number"
                    step="1"
                    placeholder="Min"
                    defaultValue={sp.min ?? ""}
                    className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-sm"
                  />
                  <input
                    name="max"
                    type="number"
                    step="1"
                    placeholder="Max"
                    defaultValue={sp.max ?? ""}
                    className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-sm"
                  />
                </div>
                <button className="text-xs px-3 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-brand-900)]">
                  Apply
                </button>
              </form>
            </aside>

            <section>
              <p className="text-sm text-[var(--color-muted)]">
                {results.length} result{results.length === 1 ? "" : "s"}
              </p>
              {results.length ? (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-5">
                  {results.map((p) => (
                    <ProductCard
                      key={p.slug}
                      slug={p.slug}
                      name={p.name}
                      brand={p.brand}
                      basePrice={p.base_price}
                      image={(p.images as string[] | null)?.[0] ?? null}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-10 text-center text-[var(--color-muted)]">
                  <p>No products matched.</p>
                  <p className="mt-2 text-sm">
                    Try a brand name (3M, Avery, Magnum), a product family
                    (vinyl wrap, banner, magnetic, latex), or browse by{" "}
                    <Link href="/c" className="underline">
                      category
                    </Link>
                    .
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

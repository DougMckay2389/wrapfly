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
    robots: { index: false, follow: true }, // search-result pages typically shouldn't be indexed
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string }>;
}) {
  const { q, brand } = await searchParams;
  const query = (q ?? "").trim();

  const supabase = await createClient();
  let results: Array<{
    name: string;
    slug: string;
    brand: string | null;
    base_price: number;
    images: string[];
  }> = [];

  if (query.length >= 2) {
    // Build a Postgres OR filter: name ilike, brand ilike, sku ilike,
    // short_description ilike. Tags filter as a separate path so we hit
    // the GIN-friendly array op.
    const safe = query.replace(/[%_]/g, ""); // strip wildcards from user input
    const like = `%${safe}%`;
    const { data } = await supabase
      .from("products")
      .select("name, slug, brand, base_price, images")
      .eq("is_active", true)
      .or(
        [
          `name.ilike.${like}`,
          `brand.ilike.${like}`,
          `sku.ilike.${like}`,
          `short_description.ilike.${like}`,
        ].join(","),
      )
      .limit(60);
    results = (data as typeof results) ?? [];

    if (brand) {
      results = results.filter((p) => p.brand === brand);
    }
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

        {query.length >= 2 ? (
          <>
            <p className="text-sm text-[var(--color-muted)] mt-4">
              {results.length} result{results.length === 1 ? "" : "s"}
              {brand ? ` for brand ${brand}` : ""}
            </p>
            {results.length ? (
              <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {results.map((p) => (
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
              <div className="mt-10 text-center text-[var(--color-muted)]">
                <p>No products matched.</p>
                <p className="mt-2 text-sm">
                  Try a brand name (3M, Avery, Magnum), a product family (
                  vinyl wrap, banner, magnetic, latex), or browse by{" "}
                  <Link href="/c" className="underline">
                    category
                  </Link>
                  .
                </p>
              </div>
            )}
          </>
        ) : query ? (
          <p className="text-sm text-[var(--color-muted)] mt-4">
            Type at least 2 characters.
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)] mt-4">
            Search by product name, brand, or SKU.
          </p>
        )}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Heart, Trash2, ShoppingCart } from "lucide-react";
import { redirect } from "next/navigation";
import { readWishlist, removeFromWishlist } from "@/lib/wishlist";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Saved items",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function removeAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (id) await removeFromWishlist(id);
  redirect("/account/wishlist");
}

export default async function WishlistPage() {
  const items = await readWishlist();

  return (
    <div className="container-wf py-12 max-w-4xl">
      <div className="flex items-center gap-3">
        <Heart className="h-6 w-6 text-[var(--color-brand-700)]" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Saved items
        </h1>
      </div>
      <p className="text-[var(--color-muted)] mt-2 text-sm">
        Things you saved for later. Move them to your cart when you&apos;re ready.
      </p>

      {items.length === 0 ? (
        <div className="mt-10 p-8 border border-dashed border-[var(--color-border)] rounded-xl text-center">
          <Heart className="h-8 w-8 mx-auto text-[var(--color-muted)]" />
          <p className="mt-3 text-[var(--color-muted)]">
            No saved items yet. Tap{" "}
            <strong>Save for later</strong> on any product page to start a list.
          </p>
          <Link
            href="/c"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]"
          >
            Browse categories
          </Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {items.map((it) => {
            const img = it.product.images?.[0];
            const price = it.variant?.price ?? it.product.base_price;
            const combo = it.variant?.combination ?? {};
            return (
              <li key={it.id} className="py-4 flex gap-4 items-center">
                <Link
                  href={`/p/${it.product.slug}`}
                  className="shrink-0 h-20 w-20 rounded-md overflow-hidden bg-[var(--color-muted-bg)]"
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/p/${it.product.slug}`}
                    className="font-medium hover:underline line-clamp-1"
                  >
                    {it.product.name}
                  </Link>
                  {it.product.brand ? (
                    <p className="text-xs text-[var(--color-muted)]">
                      {it.product.brand}
                    </p>
                  ) : null}
                  {Object.keys(combo).length ? (
                    <p className="text-xs text-[var(--color-muted)] mt-1">
                      {Object.values(combo).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <p className="font-semibold whitespace-nowrap">
                  {formatPrice(price)}
                </p>
                <form action="/api/cart/add" method="post">
                  <input type="hidden" name="product_id" value={it.product_id} />
                  <input
                    type="hidden"
                    name="variant_id"
                    value={it.variant_id ?? ""}
                  />
                  <input type="hidden" name="quantity" value="1" />
                  <button
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-xs font-semibold hover:bg-[var(--color-brand-800)]"
                    title="Move to cart"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    Add to cart
                  </button>
                </form>
                <form action={removeAction}>
                  <input type="hidden" name="id" value={it.id} />
                  <button
                    className="p-2 rounded-md text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-red-50"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

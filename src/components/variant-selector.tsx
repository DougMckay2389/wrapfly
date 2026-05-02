"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import type {
  Combination,
  DimensionOption,
  Product,
  ProductVariant,
} from "@/lib/types";
import { formatPrice, cn } from "@/lib/utils";
import { ALL_FINISHES, getFinishes, prettySize, type Finish } from "@/lib/finishes";
import { SaveForLaterButton } from "@/components/save-for-later-button";

type Props = {
  product: Pick<
    Product,
    "id" | "name" | "base_price" | "variant_dimensions" | "variant_options" | "images"
  >;
  variants: Pick<
    ProductVariant,
    | "id"
    | "sku"
    | "combination"
    | "price"
    | "compare_price"
    | "stock_qty"
    | "is_available"
    | "image_url"
  >[];
};

/**
 * Rich variant matrix with three layers, matching the base44 reference UI:
 *
 *   1. SIZE toggles (iOS-style switches)
 *   2. FINISH filter pills (derived from swatch URL / color name)
 *   3. COLOR GRID — each card shows swatch + price + color label + size
 *
 * Picking a card finalises the (size, color) selection. Cards for combos
 * with no variant row, or that are out of stock, render disabled. The hero
 * gallery on the left and the price/SKU panel update live as the selection
 * changes.
 */
export function VariantSelector({ product, variants }: Props) {
  const dims = product.variant_dimensions ?? [];
  const opts = product.variant_options ?? {};
  const sizeOpts: DimensionOption[] = opts.size ?? [];
  const colorOpts: DimensionOption[] = opts.color ?? [];

  // Initial selection: first IN-STOCK variant, falling back to first option.
  const initial: Combination = useMemo(() => {
    const firstAvail = variants.find(
      (v) => v.is_available && v.stock_qty > 0,
    );
    if (firstAvail) return firstAvail.combination;
    const sel: Combination = {};
    if (sizeOpts[0]) sel.size = sizeOpts[0].value;
    if (colorOpts[0]) sel.color = colorOpts[0].value;
    for (const d of dims) {
      if (!sel[d] && opts[d]?.[0]) sel[d] = opts[d][0].value;
    }
    return sel;
  }, [variants, dims, opts, sizeOpts, colorOpts]);

  const [selection, setSelection] = useState<Combination>(initial);
  const [activeFinish, setActiveFinish] = useState<Finish | null>(null);

  // Index variants by combo key for O(1) lookup.
  const variantByKey = useMemo(() => {
    const m = new Map<string, (typeof variants)[number]>();
    for (const v of variants) {
      m.set(comboKey(v.combination, dims), v);
    }
    return m;
  }, [variants, dims]);

  // Per-color: cheapest variant for the currently-selected size (for the
  // price shown on the card).
  function variantFor(colorValue: string): (typeof variants)[number] | undefined {
    const partial: Combination = { ...selection, color: colorValue };
    return variantByKey.get(comboKey(partial, dims));
  }

  // Which finishes are actually present given selected size?
  // (Hide finish chips that have zero matching colors with stock.)
  const finishesPresent = useMemo(() => {
    const set = new Set<Finish>();
    for (const c of colorOpts) {
      const v = variantFor(c.value);
      if (!v) continue;
      for (const f of getFinishes(c)) set.add(f);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, colorOpts, selection.size]);

  // Filtered + sorted color list — available first, then unavailable last.
  const colorsToRender = useMemo(() => {
    const filtered = activeFinish
      ? colorOpts.filter((c) => getFinishes(c).includes(activeFinish))
      : colorOpts;
    return filtered.slice().sort((a, b) => {
      const va = variantFor(a.value);
      const vb = variantFor(b.value);
      const aa = !!(va?.is_available && va.stock_qty > 0);
      const bb = !!(vb?.is_available && vb.stock_qty > 0);
      if (aa !== bb) return aa ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorOpts, activeFinish, variants, selection.size]);

  const selectedVariant = variantByKey.get(comboKey(selection, dims));
  const fullySelected = dims.every((d) => Boolean(selection[d]));
  const inStock =
    !!selectedVariant && selectedVariant.is_available && selectedVariant.stock_qty > 0;

  const displayedPrice = selectedVariant?.price ?? product.base_price ?? 0;
  const displayedImage =
    selectedVariant?.image_url ??
    swatchForSelection(opts, selection) ??
    product.images?.[0] ??
    null;

  function pickSize(value: string) {
    setSelection((prev) => ({ ...prev, size: value }));
  }
  function pickColor(value: string) {
    setSelection((prev) => ({ ...prev, color: value }));
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Left — gallery */}
      <div className="space-y-3">
        <div className="aspect-square w-full rounded-xl bg-[var(--color-muted-bg)] overflow-hidden border border-[var(--color-border)] relative">
          {displayedImage ? (
            <Image
              src={displayedImage}
              alt={`${product.name} ${Object.values(selection).join(" ")}`}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-contain"
            />
          ) : null}
        </div>
        {product.images?.length ? (
          <div className="grid grid-cols-5 gap-2">
            {product.images.slice(0, 5).map((src) => (
              <div
                key={src}
                className="aspect-square rounded-md bg-[var(--color-muted-bg)] overflow-hidden border border-[var(--color-border)] relative"
              >
                <Image src={src} alt="" fill sizes="120px" className="object-contain" />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Right — selectors + buy box */}
      <div className="space-y-6">
        {/* Price + SKU + stock */}
        <div>
          <div className="flex items-baseline gap-3">
            <p className="text-3xl font-semibold tracking-tight">
              {formatPrice(displayedPrice)}
            </p>
            {selectedVariant?.compare_price &&
            selectedVariant.compare_price > selectedVariant.price ? (
              <p className="text-base text-[var(--color-muted)] line-through">
                {formatPrice(selectedVariant.compare_price)}
              </p>
            ) : null}
          </div>
          {selectedVariant?.sku ? (
            <p className="text-xs text-[var(--color-muted)] mt-1">
              SKU: {selectedVariant.sku}
            </p>
          ) : null}
          <p
            className={cn(
              "mt-2 text-sm font-medium",
              fullySelected
                ? inStock
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-danger)]"
                : "text-[var(--color-muted)]",
            )}
          >
            {!fullySelected
              ? "Select all options"
              : inStock
                ? "In stock — ships in 1–2 business days"
                : "Currently unavailable in this combination"}
          </p>
        </div>

        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Select variant
        </h3>

        {/* Size toggles */}
        {sizeOpts.length ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {sizeOpts.map((s) => (
              <SizeToggle
                key={s.value}
                label={prettySize(s.label)}
                active={selection.size === s.value}
                onClick={() => pickSize(s.value)}
              />
            ))}
          </div>
        ) : null}

        {/* Finish filter */}
        {colorOpts.length ? (
          <div>
            <p className="text-sm font-medium mb-2">Filter by finish</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FinishToggle
                label="All"
                active={activeFinish === null}
                onClick={() => setActiveFinish(null)}
              />
              {ALL_FINISHES.filter((f) => finishesPresent.has(f)).map((f) => (
                <FinishToggle
                  key={f}
                  label={f}
                  active={activeFinish === f}
                  onClick={() => setActiveFinish(activeFinish === f ? null : f)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Color grid — two layouts.
            "thumbnail" mode: each color has its own swatch image (3M 2080 etc.)
            "compact"   mode: no per-color images (inks etc.) — use color-dot
                              cards with text only, denser grid. */}
        {colorOpts.length ? (
          (() => {
            const swatchCount = colorOpts.filter((c) => !!c.swatch).length;
            const useThumbnails = swatchCount >= Math.ceil(colorOpts.length / 2);
            const sizeLabel = selection.size
              ? prettySize(
                  sizeOpts.find((s) => s.value === selection.size)?.label ??
                    String(selection.size),
                )
              : "";

            if (useThumbnails) {
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[640px] overflow-y-auto pr-1">
                  {colorsToRender.map((c) => {
                    const v = variantFor(c.value);
                    const available = !!(v && v.is_available && v.stock_qty > 0);
                    const selected = selection.color === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        disabled={!available}
                        onClick={() => available && pickColor(c.value)}
                        className={cn(
                          "group relative text-left rounded-lg overflow-hidden border transition",
                          available ? "bg-white" : "bg-[var(--color-muted-bg)] cursor-not-allowed",
                          selected && available
                            ? "border-[var(--color-brand-900)] ring-2 ring-[var(--color-brand-900)] ring-offset-1"
                            : available
                              ? "border-[var(--color-border)] hover:border-[var(--color-brand-900)]"
                              : "border-[var(--color-border)]/50",
                        )}
                      >
                        <div className="aspect-[4/3] bg-[var(--color-muted-bg)] relative">
                          {c.swatch ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.swatch}
                              alt={c.label}
                              className={cn(
                                "absolute inset-0 w-full h-full object-cover transition",
                                !available && "grayscale opacity-30",
                              )}
                              loading="lazy"
                            />
                          ) : null}
                          {!available ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-muted-bg)]/60 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                              Unavailable
                            </div>
                          ) : null}
                        </div>
                        <div className="p-2.5">
                          <p
                            className={cn(
                              "text-base font-semibold",
                              available
                                ? "text-[var(--color-accent-700)]"
                                : "text-[var(--color-muted)]",
                            )}
                          >
                            {v ? formatPrice(v.price) : "—"}
                          </p>
                          <p
                            className={cn(
                              "text-sm font-medium line-clamp-1",
                              available
                                ? "text-[var(--color-brand-900)]"
                                : "text-[var(--color-muted)]",
                            )}
                          >
                            {c.label}
                          </p>
                          {sizeLabel ? (
                            <p className="text-xs text-[var(--color-muted)] line-clamp-1">
                              {sizeLabel}
                            </p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            }

            // Compact mode (no thumbnails): tight 2-column list with color dot.
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[640px] overflow-y-auto pr-1">
                {colorsToRender.map((c) => {
                  const v = variantFor(c.value);
                  const available = !!(v && v.is_available && v.stock_qty > 0);
                  const selected = selection.color === c.value;
                  const dot = colorDot(c.label);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      disabled={!available}
                      onClick={() => available && pickColor(c.value)}
                      className={cn(
                        "group flex items-center gap-3 text-left rounded-lg border px-3 py-2.5 transition",
                        available ? "bg-white" : "bg-[var(--color-muted-bg)] cursor-not-allowed",
                        selected && available
                          ? "border-[var(--color-brand-900)] ring-2 ring-[var(--color-brand-900)] ring-offset-1"
                          : available
                            ? "border-[var(--color-border)] hover:border-[var(--color-brand-900)]"
                            : "border-[var(--color-border)]/50",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block h-7 w-7 rounded-full border border-[var(--color-border)] shrink-0",
                          !available && "grayscale opacity-50",
                        )}
                        style={{ background: dot }}
                      />
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            "block text-sm font-semibold leading-tight line-clamp-1",
                            available
                              ? "text-[var(--color-brand-900)]"
                              : "text-[var(--color-muted)]",
                          )}
                        >
                          {c.label}
                        </span>
                        {sizeLabel ? (
                          <span
                            className={cn(
                              "block text-xs leading-tight",
                              available
                                ? "text-[var(--color-muted)]"
                                : "text-[var(--color-muted)]/70",
                            )}
                          >
                            {sizeLabel}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-semibold shrink-0",
                          available
                            ? "text-[var(--color-accent-700)]"
                            : "text-[var(--color-muted)]",
                        )}
                      >
                        {available && v
                          ? formatPrice(v.price)
                          : !available
                            ? "—"
                            : v
                              ? formatPrice(v.price)
                              : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()
        ) : null}

        <div className="flex items-center gap-3 pt-2">
          <AddToCartButton
            productId={product.id}
            variantId={selectedVariant?.id}
            disabled={!fullySelected || !inStock}
          />
          <SaveForLaterButton
            productId={product.id}
            variantId={selectedVariant?.id}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* iOS-style toggle switch + finish filter pill                               */
/* -------------------------------------------------------------------------- */

function SizeToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className="inline-flex items-center gap-2 group"
    >
      <span
        className={cn(
          "inline-block relative shrink-0 rounded-full",
          active
            ? "bg-[color:#22c55e]"
            : "bg-[var(--color-brand-200)] group-hover:bg-[var(--color-brand-300)]",
        )}
        style={{
          width: 44,
          height: 24,
          transition: "background-color 200ms",
        }}
      >
        <span
          className="rounded-full bg-white shadow"
          style={{
            position: "absolute",
            top: 2,
            left: active ? 22 : 2,
            width: 20,
            height: 20,
            transition: "left 180ms ease",
          }}
        />
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          active
            ? "text-[var(--color-brand-900)]"
            : "text-[var(--color-muted)] group-hover:text-[var(--color-brand-900)]",
        )}
      >
        {label}
      </span>
    </button>
  );
}

function FinishToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className="inline-flex items-center gap-2 group"
    >
      <span
        className={cn(
          "inline-block relative shrink-0 rounded-full",
          active
            ? "bg-[color:#22c55e]"
            : "bg-[var(--color-brand-200)] group-hover:bg-[var(--color-brand-300)]",
        )}
        style={{
          width: 44,
          height: 24,
          transition: "background-color 200ms",
        }}
      >
        <span
          className="rounded-full bg-white shadow"
          style={{
            position: "absolute",
            top: 2,
            left: active ? 22 : 2,
            width: 20,
            height: 20,
            transition: "left 180ms ease",
          }}
        />
      </span>
      <span
        className={cn(
          "text-sm",
          active
            ? "font-semibold text-[var(--color-brand-900)]"
            : "text-[var(--color-muted)] group-hover:text-[var(--color-brand-900)]",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function comboKey(combo: Combination, dims: string[]): string {
  return dims.map((d) => `${d}=${combo[d] ?? ""}`).join("|");
}

/** Map a human color label to a CSS background. Used by the compact
 *  (no-swatch) variant card to render a small color dot. Falls back to
 *  a neutral grey for unrecognized labels — purposefully simple, not a
 *  perfect palette. */
function colorDot(label: string): string {
  const k = label.toLowerCase().trim();
  // Exact matches first
  const map: Record<string, string> = {
    black: "#0a0a0a",
    "light black": "#3f3f46",
    white: "#ffffff",
    cyan: "#06b6d4",
    "light cyan": "#67e8f9",
    magenta: "#d946ef",
    "light magenta": "#f0abfc",
    yellow: "#facc15",
    orange: "#fb923c",
    red: "#ef4444",
    blue: "#3b82f6",
    green: "#22c55e",
    silver:
      "linear-gradient(135deg,#d1d5db 0%,#f9fafb 50%,#9ca3af 100%)",
    "metallic silver":
      "linear-gradient(135deg,#9ca3af 0%,#f3f4f6 50%,#6b7280 100%)",
    gold:
      "linear-gradient(135deg,#d97706 0%,#fde68a 50%,#a16207 100%)",
    "cleaning cartridge": "#e5e7eb",
    cleaner: "#e5e7eb",
    clear:
      "linear-gradient(135deg,#f3f4f6 0%,#ffffff 50%,#e5e7eb 100%)",
  };
  if (map[k]) return map[k];
  // Try keyword matches for unrecognized labels
  for (const [kw, val] of Object.entries(map)) {
    if (k.includes(kw)) return val;
  }
  return "#cbd5e1"; // neutral grey fallback
}

function swatchForSelection(
  opts: Record<string, DimensionOption[]>,
  sel: Combination,
): string | null {
  const colorValue = sel.color;
  if (!colorValue) return null;
  const found = opts.color?.find((o) => o.value === colorValue);
  return found?.swatch ?? null;
}

function AddToCartButton({
  productId,
  variantId,
  disabled,
}: {
  productId: string;
  variantId: string | undefined;
  disabled: boolean;
}) {
  return (
    <form action="/api/cart/add" method="post" className="flex-1">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="variant_id" value={variantId ?? ""} />
      <input type="hidden" name="quantity" value="1" />
      <button
        type="submit"
        disabled={disabled}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md text-sm font-semibold transition",
          disabled
            ? "bg-[var(--color-brand-300)] text-white cursor-not-allowed"
            : "bg-[var(--color-brand-900)] text-white hover:bg-[var(--color-brand-800)]",
        )}
      >
        <ShoppingCart className="h-4 w-4" />
        Add to cart
      </button>
    </form>
  );
}

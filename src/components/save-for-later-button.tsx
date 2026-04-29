"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  productId: string;
  variantId: string | undefined;
  initialSaved?: boolean;
};

/**
 * Toggles a wishlist item. Uses fetch with the `x-fetch` header so the API
 * route returns JSON instead of redirecting; we update local state from the
 * response. Falls back gracefully on error.
 */
export function SaveForLaterButton({
  productId,
  variantId,
  initialSaved = false,
}: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    startTransition(async () => {
      try {
        const body = new FormData();
        body.append("product_id", productId);
        if (variantId) body.append("variant_id", variantId);
        const res = await fetch("/api/wishlist/toggle", {
          method: "POST",
          body,
          headers: { "x-fetch": "1" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { added: boolean };
        setSaved(data.added);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={saved}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-3 rounded-md border text-sm font-medium transition",
        saved
          ? "bg-[var(--color-brand-100)] border-[var(--color-brand-700)] text-[var(--color-brand-900)]"
          : "border-[var(--color-border)] hover:border-[var(--color-brand-900)]",
        pending && "opacity-60 cursor-wait",
      )}
      title={err ?? (saved ? "Saved — click to remove" : "Save for later")}
    >
      <Heart
        className={cn("h-4 w-4", saved && "fill-current")}
        strokeWidth={saved ? 1.5 : 2}
      />
      {saved ? "Saved" : "Save for later"}
    </button>
  );
}

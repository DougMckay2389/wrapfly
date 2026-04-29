"use client";

import { useEffect, useState } from "react";

/**
 * Live-updating cart badge. Starts from the server-rendered count, then
 * listens for a custom `wf:cart-changed` window event (dispatched by the
 * add-to-cart form interceptor) and refetches /api/cart/count.
 *
 * Also re-checks on tab focus so the badge stays accurate across windows.
 */
export function CartCountBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch("/api/cart/count", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { count: number };
        if (!cancelled) setCount(j.count);
      } catch {
        /* ignore */
      }
    }
    function onChange() { void refresh(); }
    function onFocus() { void refresh(); }

    window.addEventListener("wf:cart-changed", onChange);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("wf:cart-changed", onChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent-600)] text-white text-[10px] font-semibold flex items-center justify-center">
      {count > 99 ? "99+" : count}
    </span>
  );
}

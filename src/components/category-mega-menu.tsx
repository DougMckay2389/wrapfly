import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-rendered mega-menu. Fetches active top-level categories and their
 * children once, then renders a CSS-only hover dropdown for each top-level
 * link. Children are limited to keep the dropdown manageable.
 */

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  path: string;
  level: number;
  parent_id: string | null;
  display_order: number;
};

export async function CategoryMegaMenu() {
  const supabase = await createClient();
  const { data: cats } = await supabase
    .from("categories")
    .select("id, name, slug, path, level, parent_id, display_order")
    .eq("is_active", true)
    .lte("level", 1)
    .order("level")
    .order("display_order");

  const list = (cats ?? []) as CategoryRow[];
  const tops = list.filter((c) => c.level === 0);
  const subsByParent = new Map<string, CategoryRow[]>();
  for (const c of list) {
    if (c.level === 1 && c.parent_id) {
      const arr = subsByParent.get(c.parent_id) ?? [];
      arr.push(c);
      subsByParent.set(c.parent_id, arr);
    }
  }

  return (
    <nav
      className="hidden lg:flex items-center gap-1 text-sm"
      aria-label="Categories"
    >
      {tops.map((parent) => {
        const subs = subsByParent.get(parent.id) ?? [];
        return (
          <div key={parent.id} className="relative group">
            <Link
              href={`/c/${parent.path}`}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] hover:bg-[var(--color-muted-bg)] transition-colors"
            >
              {parent.name}
              {subs.length ? (
                <ChevronDown className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
              ) : null}
            </Link>

            {subs.length ? (
              <div
                className="absolute left-0 top-full pt-2 z-50 invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150"
                style={{ minWidth: 280 }}
              >
                <div className="rounded-xl border border-[var(--color-border)] bg-white shadow-xl overflow-hidden">
                  <div className="grid grid-cols-1 gap-0.5 p-2 max-h-[420px] overflow-y-auto">
                    {subs.map((s) => (
                      <Link
                        key={s.id}
                        href={`/c/${s.path}`}
                        className="block px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)] text-sm text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)]"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                  <Link
                    href={`/c/${parent.path}`}
                    className="block px-4 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-muted-bg)] text-xs font-semibold text-[var(--color-brand-900)] hover:bg-[var(--color-brand-100)]"
                  >
                    Browse all {parent.name} →
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

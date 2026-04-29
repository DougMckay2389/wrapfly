"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronRight, ChevronDown } from "lucide-react";

type Cat = {
  id: string;
  name: string;
  path: string;
  level: number;
  parent_id: string | null;
};

/**
 * Slide-in mobile nav. Trigger lives in the header on small screens.
 * Tapping a top-level row expands its children inline (accordion style)
 * so users can drill in without losing context.
 */
export function MobileNav({ categories }: { categories: Cat[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tops = categories.filter((c) => c.level === 0);
  const subsByParent = new Map<string, Cat[]>();
  for (const c of categories) {
    if (c.level === 1 && c.parent_id) {
      const arr = subsByParent.get(c.parent_id) ?? [];
      arr.push(c);
      subsByParent.set(c.parent_id, arr);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="lg:hidden p-2 rounded-md hover:bg-[var(--color-muted-bg)]"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          {/* Drawer */}
          <div className="relative ml-auto h-full w-[85vw] max-w-[360px] bg-white shadow-xl flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--color-border)]">
              <span className="font-semibold">Categories</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-2 rounded-md hover:bg-[var(--color-muted-bg)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              {tops.map((parent) => {
                const subs = subsByParent.get(parent.id) ?? [];
                const isOpen = expanded.has(parent.id);
                return (
                  <div key={parent.id} className="border-b border-[var(--color-border)]">
                    <div className="flex items-center">
                      <Link
                        href={`/c/${parent.path}`}
                        onClick={() => setOpen(false)}
                        className="flex-1 px-4 py-3 font-medium text-[var(--color-brand-900)]"
                      >
                        {parent.name}
                      </Link>
                      {subs.length ? (
                        <button
                          type="button"
                          onClick={() => toggle(parent.id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} ${parent.name}`}
                          className="p-3 text-[var(--color-muted)]"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                    </div>
                    {isOpen && subs.length ? (
                      <ul className="bg-[var(--color-muted-bg)] py-1">
                        {subs.map((s) => (
                          <li key={s.id}>
                            <Link
                              href={`/c/${s.path}`}
                              onClick={() => setOpen(false)}
                              className="block px-6 py-2.5 text-sm text-[var(--color-brand-700)] hover:bg-white"
                            >
                              {s.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-[var(--color-border)] p-3 space-y-1 text-sm">
              <Link
                href="/search"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]"
              >
                Search
              </Link>
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]"
              >
                Account
              </Link>
              <Link
                href="/cart"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded-md hover:bg-[var(--color-muted-bg)]"
              >
                Cart
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

import Link from "next/link";
import Script from "next/script";
import { ChevronRight } from "lucide-react";
import { absoluteUrl } from "@/lib/utils";

export type Crumb = { label: string; href: string };

/**
 * Visual breadcrumbs + JSON-LD BreadcrumbList for SEO rich results.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: absoluteUrl(c.href),
    })),
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className="container-wf py-3 text-sm">
        <ol className="flex flex-wrap items-center gap-1 text-[var(--color-muted)]">
          {items.map((c, i) => (
            <li key={c.href} className="flex items-center gap-1">
              {i > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              ) : null}
              {i === items.length - 1 ? (
                <span aria-current="page" className="text-[var(--color-fg)]">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="hover:text-[var(--color-fg)]">
                  {c.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <Script
        id={`ld-bc-${items[items.length - 1].href}`}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
    </>
  );
}

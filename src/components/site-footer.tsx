import Link from "next/link";
import { NAV } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--color-border)] bg-[var(--color-muted-bg)]">
      <div className="container-wf py-12 grid gap-10 grid-cols-2 md:grid-cols-4">
        {Object.entries(NAV.footer).map(([heading, links]) => (
          <div key={heading}>
            <h2 className="text-sm font-semibold text-[var(--color-brand-900)] mb-3">
              {heading}
            </h2>
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-[var(--color-brand-600)] hover:text-[var(--color-brand-900)]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-border)]">
        <div className="container-wf py-6 text-xs text-[var(--color-muted)] flex flex-col md:flex-row justify-between gap-2">
          <span>© {new Date().getFullYear()} Wrapfly. All rights reserved.</span>
          <span>Premium materials for sign shops, wrap installers, and print pros.</span>
        </div>
      </div>
    </footer>
  );
}

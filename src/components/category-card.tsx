import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Props = {
  href: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
};

export function CategoryCard({ href, name, description, imageUrl }: Props) {
  return (
    <Link
      href={href}
      className="group relative block rounded-xl overflow-hidden bg-[var(--color-muted-bg)] border border-[var(--color-border)] hover:shadow-[var(--shadow-pop)] transition-shadow"
    >
      <div
        className="aspect-[4/3] bg-cover bg-center"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
        aria-hidden
      />
      <div className="p-5">
        <h3 className="font-semibold text-lg text-[var(--color-brand-900)]">
          {name}
        </h3>
        {description ? (
          <p className="text-sm text-[var(--color-muted)] mt-1 line-clamp-2">
            {description}
          </p>
        ) : null}
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-900)] group-hover:gap-2 transition-all">
          Shop {name}
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";

type Props = {
  slug: string;
  name: string;
  brand?: string | null;
  basePrice: number;
  image?: string | null;
  badge?: string | null;
};

export function ProductCard({ slug, name, brand, basePrice, image, badge }: Props) {
  return (
    <Link
      href={`/p/${slug}`}
      className="group block rounded-xl overflow-hidden border border-[var(--color-border)] bg-white hover:shadow-[var(--shadow-pop)] transition-shadow"
    >
      <div className="relative aspect-square bg-[var(--color-muted-bg)]">
        {image ? (
          <Image
            src={image}
            alt={name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 25vw, 320px"
            className="object-contain p-3 group-hover:scale-[1.02] transition-transform"
          />
        ) : null}
        {badge ? (
          <span className="absolute top-3 left-3 text-[10px] font-semibold uppercase tracking-wider bg-[var(--color-accent-600)] text-white px-2 py-0.5 rounded-full">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="p-4">
        {brand ? (
          <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
            {brand}
          </p>
        ) : null}
        <h3 className="text-sm font-medium text-[var(--color-brand-900)] line-clamp-2 mt-0.5">
          {name}
        </h3>
        <p className="mt-2 font-semibold text-[var(--color-brand-900)]">
          From {formatPrice(basePrice)}
        </p>
      </div>
    </Link>
  );
}

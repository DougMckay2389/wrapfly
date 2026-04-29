import Link from "next/link";
import {
  ArrowRight,
  Layers,
  Square,
  Flag,
  SignpostBig,
  Printer,
  Shirt,
  Car,
  Droplet,
  Box,
  type LucideIcon,
} from "lucide-react";

type Props = {
  href: string;
  name: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  productCount?: number;
};

/** Map known top-level slugs to a representative icon + accent color. */
const ICON_BY_SLUG: Record<string, { icon: LucideIcon; gradient: string }> = {
  "vinyl-rolls":           { icon: Layers,     gradient: "from-blue-500/20 to-cyan-500/10" },
  "substrates":            { icon: Square,     gradient: "from-slate-500/20 to-slate-300/10" },
  "banners":               { icon: Flag,       gradient: "from-amber-500/20 to-orange-400/10" },
  "signs-supplies":        { icon: SignpostBig,gradient: "from-emerald-500/20 to-teal-400/10" },
  "equipment":             { icon: Printer,    gradient: "from-indigo-500/20 to-blue-400/10" },
  "apparel-screen-printing": { icon: Shirt,    gradient: "from-rose-500/20 to-pink-400/10" },
  "automotive-films":      { icon: Car,        gradient: "from-red-500/20 to-orange-500/10" },
  "inks-accessories":      { icon: Droplet,    gradient: "from-violet-500/20 to-fuchsia-400/10" },
};

export function CategoryCard({
  href,
  name,
  slug,
  description,
  imageUrl,
  productCount,
}: Props) {
  const fallback = (slug ? ICON_BY_SLUG[slug] : undefined) ?? {
    icon: Box,
    gradient: "from-slate-500/20 to-slate-300/10",
  };
  const Icon = fallback.icon;

  return (
    <Link
      href={href}
      className="group relative block rounded-xl overflow-hidden bg-white border border-[var(--color-border)] hover:border-[var(--color-brand-300)] hover:shadow-lg transition-all"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          </>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${fallback.gradient} flex items-center justify-center`}>
            <Icon className="h-16 w-16 text-[var(--color-brand-900)] opacity-40" strokeWidth={1.25} />
          </div>
        )}
        {productCount !== undefined && productCount > 0 ? (
          <span className="absolute top-3 right-3 inline-flex items-center px-2 py-0.5 rounded-full bg-white/90 backdrop-blur text-xs font-semibold text-[var(--color-brand-900)]">
            {productCount} item{productCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div className="p-5">
        <h3 className="font-semibold text-lg text-[var(--color-brand-900)] group-hover:text-[var(--color-brand-700)] transition-colors">
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

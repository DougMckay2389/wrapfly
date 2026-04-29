import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-wf py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        404
      </p>
      <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-3 text-[var(--color-muted)]">
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <Link
        href="/"
        className="inline-flex mt-6 px-5 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
      >
        Back to home
      </Link>
    </div>
  );
}

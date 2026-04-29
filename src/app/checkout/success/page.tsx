import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Order placed",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderNumber } = await searchParams;
  const supabase = await createClient();
  const { data: order } = orderNumber
    ? await supabase
        .from("orders")
        .select("order_number, total, email, items, square_receipt_url, shipping_address")
        .eq("order_number", orderNumber)
        .maybeSingle()
    : { data: null };

  return (
    <div className="container-wf py-12 max-w-2xl">
      <CheckCircle2 className="h-10 w-10 text-[var(--color-success)]" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Thanks for your order!</h1>
      {order ? (
        <p className="mt-2 text-[var(--color-muted)]">
          Order <strong>{order.order_number}</strong> · Total{" "}
          {formatPrice(order.total)} · We&apos;ve sent a confirmation to{" "}
          {order.email}.
        </p>
      ) : (
        <p className="mt-2 text-[var(--color-muted)]">
          We&apos;ve received your payment and emailed your receipt.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/account/orders"
          className="px-5 py-3 rounded-md bg-[var(--color-brand-900)] text-white font-semibold hover:bg-[var(--color-brand-800)]"
        >
          View my orders
        </Link>
        {order?.square_receipt_url ? (
          <a
            href={order.square_receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-3 rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand-900)] font-semibold"
          >
            Square receipt
          </a>
        ) : null}
        <Link
          href="/"
          className="px-5 py-3 rounded-md hover:bg-[var(--color-muted-bg)] font-semibold"
        >
          Continue shopping
        </Link>
      </div>
    </div>
  );
}

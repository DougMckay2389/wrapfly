import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyWebhookSignature } from "@/lib/square";

/**
 * Square webhook receiver.
 *
 * Subscribe to the `payment.updated` and `refund.updated` events in your
 * Square dashboard, point them at:
 *   https://wrapfly.com/api/webhooks/square
 * and copy the signature key into the SQUARE_WEBHOOK_SIGNATURE_KEY secret.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("x-square-hmacsha256-signature");
  const url = request.url;

  const valid = await verifyWebhookSignature({
    signatureHeader: sig,
    notificationUrl: url,
    body,
  });
  if (!valid) return new NextResponse("invalid signature", { status: 401 });

  let event: { type: string; data?: { object?: Record<string, unknown> } } | null = null;
  try {
    event = JSON.parse(body);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  if (!event) return new NextResponse("ok");

  const supabase = createAdminClient();

  switch (event.type) {
    case "payment.updated":
    case "payment.created": {
      const payment = (event.data?.object as { payment?: { id?: string; status?: string } })?.payment;
      if (payment?.id) {
        const status = (payment.status ?? "").toUpperCase();
        const next =
          status === "COMPLETED" || status === "APPROVED"
            ? "paid"
            : status === "FAILED"
              ? "failed"
              : status === "CANCELED"
                ? "cancelled"
                : null;
        if (next) {
          await supabase
            .from("orders")
            .update({ status: next, paid_at: next === "paid" ? new Date().toISOString() : undefined })
            .eq("square_payment_id", payment.id);
        }
      }
      break;
    }
    case "refund.updated":
    case "refund.created": {
      const refund = (event.data?.object as { refund?: { payment_id?: string; status?: string; amount_money?: { amount?: number } } })?.refund;
      if (refund?.payment_id && refund.status === "COMPLETED") {
        const { data: order } = await supabase
          .from("orders")
          .select("id, total")
          .eq("square_payment_id", refund.payment_id)
          .maybeSingle();
        if (order) {
          const refundedCents = refund.amount_money?.amount ?? 0;
          const fully = refundedCents >= Math.round(Number(order.total) * 100);
          await supabase
            .from("orders")
            .update({
              status: fully ? "refunded" : "partially_refunded",
              refunded_at: new Date().toISOString(),
            })
            .eq("id", order.id);
        }
      }
      break;
    }
    default:
      // Ignore unknown event types.
      break;
  }

  return new NextResponse("ok");
}

import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream the order ledger as CSV for accounting / spreadsheet review. */
export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const since = url.searchParams.get("since");

  const supabase = createAdminClient();
  let q = supabase
    .from("orders")
    .select(
      "order_number, status, fulfillment, email, subtotal, discount_total, shipping_total, tax_total, total, coupon_code, square_payment_id, tracking_carrier, tracking_number, shipping_address, created_at, paid_at, shipped_at, delivered_at, cancelled_at, refunded_at",
    )
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (since) q = q.gte("created_at", since);
  const { data: orders } = await q;

  const headers = [
    "order_number","status","fulfillment","email","subtotal","discount_total",
    "shipping_total","tax_total","total","coupon_code","square_payment_id",
    "tracking_carrier","tracking_number","ship_to_name","ship_to_city","ship_to_state",
    "ship_to_postal","created_at","paid_at","shipped_at","delivered_at","cancelled_at","refunded_at",
  ];

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows: string[] = [headers.join(",")];
  for (const o of orders ?? []) {
    const ship = (o.shipping_address as Record<string, string> | null) ?? {};
    rows.push(
      [
        o.order_number,
        o.status,
        o.fulfillment,
        o.email,
        o.subtotal,
        o.discount_total,
        o.shipping_total,
        o.tax_total,
        o.total,
        o.coupon_code ?? "",
        o.square_payment_id ?? "",
        o.tracking_carrier ?? "",
        o.tracking_number ?? "",
        ship.full_name ?? "",
        ship.city ?? "",
        ship.state ?? "",
        ship.postal_code ?? "",
        o.created_at,
        o.paid_at ?? "",
        o.shipped_at ?? "",
        o.delivered_at ?? "",
        o.cancelled_at ?? "",
        o.refunded_at ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  const body = rows.join("\n");
  const filename = `wrapfly-orders-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

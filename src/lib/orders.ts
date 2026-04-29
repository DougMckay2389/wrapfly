import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Cart, CartItem } from "@/lib/types";
import type { SquarePayment } from "@/lib/square";

/**
 * Generates a human-friendly order number like WF-2026-0001.
 * Race-safe-ish: we use the count of orders this calendar year + 1.
 * Good enough for low-volume; for high volume swap to a Postgres sequence.
 */
async function nextOrderNumber(): Promise<string> {
  const supabase = createAdminClient();
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const { count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", yearStart);
  const n = (count ?? 0) + 1;
  return `WF-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
}

export type Address = {
  full_name: string;
  company?: string;
  phone?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postal_code: string;
  country?: string;
  email?: string;
};

export async function createOrderFromCart(args: {
  cart: Cart;
  email: string;
  shipping: Address;
  billing: Address;
  shippingTotal: number;
  taxTotal: number;
  payment: SquarePayment;
}) {
  const supabase = createAdminClient();
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  const items = args.cart.items as CartItem[];
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = Number(args.cart.discount ?? 0);
  const total = +(subtotal - discount + args.shippingTotal + args.taxTotal).toFixed(2);
  const orderNumber = await nextOrderNumber();

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      user_id: user?.id ?? null,
      email: args.email,
      status: "paid",
      fulfillment: "unfulfilled",
      subtotal,
      discount_total: discount,
      coupon_code: args.cart.coupon_code ?? null,
      shipping_total: args.shippingTotal,
      tax_total: args.taxTotal,
      total,
      currency: "USD",
      square_payment_id: args.payment.id,
      square_order_id: args.payment.order_id ?? null,
      square_receipt_url: args.payment.receipt_url ?? null,
      shipping_address: args.shipping,
      billing_address: args.billing,
      items,
      paid_at: new Date().toISOString(),
    })
    .select("id, order_number, total")
    .single();

  if (error) throw new Error(error.message);

  // Normalised line items
  await supabase.from("order_items").insert(
    items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      variant_id: i.variant_id,
      product_name: i.product_name,
      variant_sku: i.variant_sku,
      combination: i.combination,
      unit_price: i.price,
      quantity: i.quantity,
      line_total: +(i.price * i.quantity).toFixed(2),
      image_url: i.image_url,
    })),
  );

  // Decrement stock for each variant.
  for (const item of items) {
    const { data: v } = await supabase
      .from("product_variants")
      .select("stock_qty")
      .eq("id", item.variant_id)
      .maybeSingle();
    const next = Math.max(0, (v?.stock_qty ?? 0) - item.quantity);
    await supabase
      .from("product_variants")
      .update({ stock_qty: next, is_available: next > 0 })
      .eq("id", item.variant_id);
  }

  // Bump coupon usage if applied.
  if (args.cart.coupon_code) {
    await supabase.rpc;
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id, uses")
      .eq("code", args.cart.coupon_code)
      .maybeSingle();
    if (coupon) {
      await supabase
        .from("coupons")
        .update({ uses: (coupon.uses ?? 0) + 1 })
        .eq("id", coupon.id);
    }
  }

  // Clear the cart.
  await supabase
    .from("carts")
    .update({ items: [], subtotal: 0, coupon_code: null, discount: 0 })
    .eq("id", args.cart.id);

  return order;
}

import { NextResponse } from "next/server";
import { readCart } from "@/lib/cart";
import { createPayment } from "@/lib/square";
import { createOrderFromCart, type Address } from "@/lib/orders";
import { sendOrderConfirmation } from "@/lib/email";

export async function POST(request: Request) {
  const form = await request.formData();
  const cart = await readCart();
  if (!cart || !cart.items.length) {
    return NextResponse.redirect(new URL("/cart", request.url), { status: 303 });
  }

  const sourceId = String(form.get("source_id") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!sourceId || !email) {
    return NextResponse.redirect(
      new URL("/checkout?error=Missing+payment+details", request.url),
      { status: 303 },
    );
  }

  const shipping: Address = {
    full_name: String(form.get("ship_full_name") ?? ""),
    company: String(form.get("ship_company") ?? "") || undefined,
    phone: String(form.get("ship_phone") ?? "") || undefined,
    address1: String(form.get("ship_address1") ?? ""),
    address2: String(form.get("ship_address2") ?? "") || undefined,
    city: String(form.get("ship_city") ?? ""),
    state: String(form.get("ship_state") ?? ""),
    postal_code: String(form.get("ship_postal_code") ?? ""),
    country: String(form.get("ship_country") ?? "US"),
    email,
  };
  const billing: Address = shipping; // billing-same-as-shipping for v1.

  const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = Number(cart.discount ?? 0);
  const shippingTotal = subtotal - discount >= 250 ? 0 : 15;
  const taxTotal = 0;
  const total = +(subtotal - discount + shippingTotal + taxTotal).toFixed(2);
  const amountCents = Math.round(total * 100);

  let payment;
  try {
    payment = await createPayment({
      sourceId,
      amountCents,
      buyerEmail: email,
      note: `Wrapfly cart ${cart.id}`,
      referenceId: cart.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Payment failed";
    return NextResponse.redirect(
      new URL(`/checkout?error=${encodeURIComponent(msg)}`, request.url),
      { status: 303 },
    );
  }

  let order;
  try {
    order = await createOrderFromCart({
      cart,
      email,
      shipping,
      billing,
      shippingTotal,
      taxTotal,
      payment,
    });
  } catch (e) {
    // Payment went through but order creation failed — log and surface
    // a contact message. Operator can manually reconcile.
    const msg = e instanceof Error ? e.message : "Order error";
    console.error("[checkout] order creation failed after payment", msg);
    return NextResponse.redirect(
      new URL(
        `/checkout?error=${encodeURIComponent(
          "Payment succeeded but we couldn't save your order. We'll be in touch — your card was charged.",
        )}`,
        request.url,
      ),
      { status: 303 },
    );
  }

  // Fire-and-forget the order confirmation email. Don't block the redirect.
  sendOrderConfirmation({ orderId: order.id }).catch((err) =>
    console.error("[checkout] order email failed:", err),
  );

  return NextResponse.redirect(
    new URL(`/checkout/success?order=${order.order_number}`, request.url),
    { status: 303 },
  );
}

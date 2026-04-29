import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Cart, CartItem, Combination } from "@/lib/types";

/**
 * Cart helpers. The cart row is keyed by either `user_id` (for signed-in
 * customers) or a `guest_token` cookie. When a guest signs in, we merge
 * their guest cart into their user cart (see `mergeGuestCartIntoUser`).
 *
 * IMPORTANT: cart writes use the SERVICE ROLE (admin) client so they
 * bypass RLS. Necessary because guest carts have user_id = null which
 * the user-scoped RLS policy can't authorise. Security model: we trust
 * our own server code, and the wf_guest cookie is server-set + httpOnly.
 */

const GUEST_COOKIE = "wf_guest";

/** Identify the current viewer — user.id if signed in, else the guest token. */
async function viewerKey(): Promise<{
  user_id: string | null;
  guest_token: string | null;
}> {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (user) return { user_id: user.id, guest_token: null };

  const cookieStore = await cookies();
  let token = cookieStore.get(GUEST_COOKIE)?.value ?? null;
  if (!token) {
    token = randomUUID();
    cookieStore.set(GUEST_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return { user_id: null, guest_token: token };
}

/** Returns the existing cart for this request, creating one if needed. */
export async function getOrCreateCart(): Promise<Cart> {
  const admin = createAdminClient();
  const v = await viewerKey();

  // 1. Try to find an existing cart for this viewer.
  const lookup = v.user_id
    ? admin.from("carts").select("*").eq("user_id", v.user_id).maybeSingle()
    : admin.from("carts").select("*").eq("guest_token", v.guest_token!).maybeSingle();
  const { data: existing } = await lookup;
  if (existing) return existing as Cart;

  // 2. Create a fresh cart row.
  const { data: created, error } = await admin
    .from("carts")
    .insert({
      user_id: v.user_id,
      guest_token: v.guest_token,
      items: [],
      subtotal: 0,
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Could not create cart: ${error.message}`);
  }
  return created as Cart;
}

/** Total quantity across all line items, or 0 if cart is empty. */
export async function readCartCount(): Promise<number> {
  const cart = await readCart();
  if (!cart) return 0;
  return (cart.items as CartItem[]).reduce((s, i) => s + (i.quantity ?? 0), 0);
}

/** Reads the cart without creating one. Returns null if none exists. */
export async function readCart(): Promise<Cart | null> {
  const admin = createAdminClient();
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (user) {
    const { data } = await admin
      .from("carts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    return (data as Cart | null) ?? null;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  const { data } = await admin
    .from("carts")
    .select("*")
    .eq("guest_token", token)
    .maybeSingle();
  return (data as Cart | null) ?? null;
}

function lineKey(productId: string, variantId: string): string {
  return `${productId}::${variantId}`;
}

function recompute(items: CartItem[], discount = 0): number {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return Math.max(0, +(subtotal - discount).toFixed(2));
}

export async function addItem(productId: string, variantId: string, qty = 1) {
  if (qty <= 0) return;
  const admin = createAdminClient();
  const cart = await getOrCreateCart();

  const { data: variant } = await admin
    .from("product_variants")
    .select("id, sku, combination, price, image_url, stock_qty, is_available, product_id")
    .eq("id", variantId)
    .maybeSingle();
  if (!variant || !variant.is_available || variant.stock_qty <= 0) {
    throw new Error("This option is currently unavailable.");
  }
  const { data: product } = await admin
    .from("products")
    .select("id, name, images")
    .eq("id", variant.product_id)
    .maybeSingle();
  if (!product) throw new Error("Product not found.");

  const items: CartItem[] = [...(cart.items ?? [])];
  const key = lineKey(product.id, variant.id);
  const existing = items.find((i) => lineKey(i.product_id, i.variant_id) === key);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + qty, variant.stock_qty);
  } else {
    items.push({
      product_id: product.id,
      variant_id: variant.id,
      product_name: product.name,
      variant_sku: variant.sku,
      combination: variant.combination as Combination,
      price: variant.price,
      quantity: Math.min(qty, variant.stock_qty),
      image_url:
        variant.image_url ?? (product.images as string[])?.[0] ?? null,
    });
  }
  const subtotal = recompute(items, cart.discount ?? 0);
  await admin.from("carts").update({ items, subtotal }).eq("id", cart.id);
}

export async function updateQty(variantId: string, qty: number) {
  const admin = createAdminClient();
  const cart = await getOrCreateCart();
  let items: CartItem[] = [...(cart.items ?? [])];
  if (qty <= 0) {
    items = items.filter((i) => i.variant_id !== variantId);
  } else {
    items = items.map((i) =>
      i.variant_id === variantId ? { ...i, quantity: qty } : i,
    );
  }
  const subtotal = recompute(items, cart.discount ?? 0);
  await admin.from("carts").update({ items, subtotal }).eq("id", cart.id);
}

export async function removeItem(variantId: string) {
  await updateQty(variantId, 0);
}

export async function clearCart() {
  const admin = createAdminClient();
  const cart = await readCart();
  if (!cart) return;
  await admin
    .from("carts")
    .update({ items: [], subtotal: 0, coupon_code: null, discount: 0 })
    .eq("id", cart.id);
}

export async function applyCoupon(code: string) {
  const admin = createAdminClient();
  const cart = await getOrCreateCart();
  const { data: coupon } = await admin
    .from("coupons")
    .select(
      "code, type, value, min_subtotal, max_discount, starts_at, ends_at, usage_limit, uses, is_active",
    )
    .eq("code", code.trim())
    .eq("is_active", true)
    .maybeSingle();
  if (!coupon) throw new Error("Invalid coupon code.");
  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now)
    throw new Error("This coupon is not active yet.");
  if (coupon.ends_at && new Date(coupon.ends_at) < now)
    throw new Error("This coupon has expired.");
  if (coupon.usage_limit && coupon.uses >= coupon.usage_limit)
    throw new Error("This coupon is no longer available.");

  const subtotal = (cart.items ?? []).reduce(
    (s, i) => s + i.price * i.quantity,
    0,
  );
  if (coupon.min_subtotal && subtotal < Number(coupon.min_subtotal))
    throw new Error(`Add more to your cart to use this coupon.`);

  let discount = 0;
  if (coupon.type === "percent")
    discount = +(subtotal * (Number(coupon.value) / 100)).toFixed(2);
  else if (coupon.type === "fixed_amount") discount = Number(coupon.value);
  if (coupon.max_discount) discount = Math.min(discount, Number(coupon.max_discount));

  await admin
    .from("carts")
    .update({
      coupon_code: coupon.code,
      discount,
      subtotal: recompute(cart.items ?? [], discount),
    })
    .eq("id", cart.id);
}

export async function removeCoupon() {
  const admin = createAdminClient();
  const cart = await getOrCreateCart();
  await admin
    .from("carts")
    .update({
      coupon_code: null,
      discount: 0,
      subtotal: recompute(cart.items ?? [], 0),
    })
    .eq("id", cart.id);
}

/** Merges a guest's cart into the freshly-signed-in user's cart. */
export async function mergeGuestCartIntoUser() {
  const admin = createAdminClient();
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return;
  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_COOKIE)?.value;
  if (!token) return;

  const { data: guestCart } = await admin
    .from("carts")
    .select("id, items")
    .eq("guest_token", token)
    .maybeSingle();
  if (!guestCart || !(guestCart.items as CartItem[])?.length) return;

  const userCart = await getOrCreateCart();
  const merged: CartItem[] = [...((userCart.items as CartItem[]) ?? [])];
  for (const it of guestCart.items as CartItem[]) {
    const i = merged.find(
      (m) =>
        m.product_id === it.product_id && m.variant_id === it.variant_id,
    );
    if (i) i.quantity += it.quantity;
    else merged.push(it);
  }
  await admin
    .from("carts")
    .update({
      items: merged,
      subtotal: recompute(merged, userCart.discount ?? 0),
    })
    .eq("id", userCart.id);
  await admin.from("carts").delete().eq("id", guestCart.id);
  cookieStore.delete(GUEST_COOKIE);
}

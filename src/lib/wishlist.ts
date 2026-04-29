"use server";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth";

/**
 * Wishlist (a.k.a. "save for later") backed by Supabase. Mirrors the cart's
 * viewer model: authenticated users are keyed by user_id; anonymous shoppers
 * by a `wf_guest` cookie. On sign-in, the merge helper rolls the guest list
 * into the user's permanent list.
 */

const GUEST_COOKIE = "wf_guest";

async function viewerKey(): Promise<{ user_id: string | null; guest_key: string | null }> {
  const user = await getUser();
  if (user) return { user_id: user.id, guest_key: null };
  const jar = await cookies();
  let g = jar.get(GUEST_COOKIE)?.value;
  if (!g) {
    g = crypto.randomUUID();
    jar.set(GUEST_COOKIE, g, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return { user_id: null, guest_key: g };
}

export type WishlistItemView = {
  id: string;
  product_id: string;
  variant_id: string | null;
  created_at: string;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    base_price: number;
    images: string[] | null;
    is_active: boolean;
  };
  variant?: {
    id: string;
    sku: string;
    price: number;
    combination: Record<string, string>;
  } | null;
};

export async function readWishlist(): Promise<WishlistItemView[]> {
  const { user_id, guest_key } = await viewerKey();
  const supabase = createAdminClient();
  let q = supabase
    .from("wishlist_items")
    .select(
      "id, product_id, variant_id, created_at, " +
        "product:products!inner(id, name, slug, brand, base_price, images, is_active), " +
        "variant:product_variants(id, sku, price, combination)",
    )
    .order("created_at", { ascending: false });
  if (user_id) q = q.eq("user_id", user_id);
  else if (guest_key) q = q.eq("guest_key", guest_key);
  const { data } = await q;
  return (data ?? []) as unknown as WishlistItemView[];
}

export async function readWishlistCount(): Promise<number> {
  const { user_id, guest_key } = await viewerKey();
  const supabase = createAdminClient();
  let q = supabase
    .from("wishlist_items")
    .select("*", { count: "exact", head: true });
  if (user_id) q = q.eq("user_id", user_id);
  else if (guest_key) q = q.eq("guest_key", guest_key);
  const { count } = await q;
  return count ?? 0;
}

export async function isSaved(productId: string, variantId: string | null): Promise<boolean> {
  const { user_id, guest_key } = await viewerKey();
  const supabase = createAdminClient();
  let q = supabase
    .from("wishlist_items")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId);
  q = variantId ? q.eq("variant_id", variantId) : q.is("variant_id", null);
  if (user_id) q = q.eq("user_id", user_id);
  else if (guest_key) q = q.eq("guest_key", guest_key);
  const { count } = await q;
  return (count ?? 0) > 0;
}

export async function toggleWishlist(
  productId: string,
  variantId: string | null,
): Promise<{ added: boolean }> {
  const { user_id, guest_key } = await viewerKey();
  const supabase = createAdminClient();

  // Check existing
  let existing = supabase
    .from("wishlist_items")
    .select("id")
    .eq("product_id", productId);
  existing = variantId ? existing.eq("variant_id", variantId) : existing.is("variant_id", null);
  if (user_id) existing = existing.eq("user_id", user_id);
  else if (guest_key) existing = existing.eq("guest_key", guest_key);
  const { data: row } = await existing.maybeSingle();

  if (row) {
    await supabase.from("wishlist_items").delete().eq("id", row.id);
    return { added: false };
  }
  await supabase.from("wishlist_items").insert({
    user_id,
    guest_key,
    product_id: productId,
    variant_id: variantId,
  });
  return { added: true };
}

export async function removeFromWishlist(itemId: string): Promise<void> {
  const { user_id, guest_key } = await viewerKey();
  const supabase = createAdminClient();
  let q = supabase.from("wishlist_items").delete().eq("id", itemId);
  if (user_id) q = q.eq("user_id", user_id);
  else if (guest_key) q = q.eq("guest_key", guest_key);
  await q;
}

/** Merge a guest wishlist into the signed-in user's wishlist. */
export async function mergeGuestWishlistIntoUser(userId: string): Promise<void> {
  const jar = await cookies();
  const g = jar.get(GUEST_COOKIE)?.value;
  if (!g) return;
  const supabase = createAdminClient();
  // Move every guest row to user_id (ignoring conflicts on the unique index).
  await supabase.rpc("merge_guest_wishlist", {
    p_guest_key: g,
    p_user_id: userId,
  });
}

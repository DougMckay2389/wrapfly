import { NextResponse } from "next/server";
import { toggleWishlist } from "@/lib/wishlist";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const productId = String(form.get("product_id") ?? "");
  const variantId = String(form.get("variant_id") ?? "") || null;
  if (!productId) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 });
  }
  const result = await toggleWishlist(productId, variantId);
  // If the form is submitted as a normal HTML POST (no AJAX), redirect back.
  const referer = req.headers.get("referer");
  if (referer && !req.headers.get("x-fetch")) {
    return NextResponse.redirect(referer, { status: 303 });
  }
  return NextResponse.json(result);
}

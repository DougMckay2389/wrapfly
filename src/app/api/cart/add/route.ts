import { NextResponse } from "next/server";
import { addItem } from "@/lib/cart";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  const form = await request.formData();
  const productId = String(form.get("product_id") ?? "");
  const variantId = String(form.get("variant_id") ?? "");
  const quantity = Number(form.get("quantity") ?? 1);
  if (!productId || !variantId) {
    return NextResponse.redirect(new URL("/cart?error=missing", request.url), {
      status: 303,
    });
  }
  try {
    await addItem(productId, variantId, quantity);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not add item";
    return NextResponse.redirect(
      new URL(`/cart?error=${encodeURIComponent(msg)}`, request.url),
      { status: 303 },
    );
  }
  revalidatePath("/cart");
  return NextResponse.redirect(new URL("/cart", request.url), { status: 303 });
}

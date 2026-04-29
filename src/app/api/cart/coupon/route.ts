import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { applyCoupon, removeCoupon } from "@/lib/cart";

export async function POST(request: Request) {
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const action = String(form.get("action") ?? "apply");
  try {
    if (action === "remove") await removeCoupon();
    else await applyCoupon(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Coupon error";
    return NextResponse.redirect(
      new URL(`/cart?coupon_error=${encodeURIComponent(msg)}`, request.url),
      { status: 303 },
    );
  }
  revalidatePath("/cart");
  return NextResponse.redirect(new URL("/cart", request.url), { status: 303 });
}

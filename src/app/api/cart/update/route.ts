import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateQty } from "@/lib/cart";

export async function POST(request: Request) {
  const form = await request.formData();
  const variantId = String(form.get("variant_id") ?? "");
  const qty = Number(form.get("quantity") ?? 0);
  if (!variantId) return new NextResponse("missing", { status: 400 });
  await updateQty(variantId, qty);
  revalidatePath("/cart");
  return NextResponse.redirect(new URL("/cart", request.url), { status: 303 });
}

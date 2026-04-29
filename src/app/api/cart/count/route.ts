import { NextResponse } from "next/server";
import { readCartCount } from "@/lib/cart";

export const runtime = "nodejs";

export async function GET() {
  try {
    const count = await readCartCount();
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}

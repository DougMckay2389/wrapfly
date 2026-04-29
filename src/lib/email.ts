import { createAdminClient } from "@/lib/supabase/server";
import { absoluteUrl, formatPrice } from "@/lib/utils";
import type { CartItem } from "@/lib/types";

/**
 * Resend transactional email.
 * Uses the REST API directly (no SDK dependency = clean Workers build).
 *
 * Templates:
 *   - HTML rendered inline by simple template functions below.
 *   - Future iteration: load from `email_templates` table + render with
 *     React Email server-side. For now we ship working defaults.
 */

const FROM = process.env.RESEND_FROM_EMAIL ?? "Wrapfly <orders@wrapfly.com>";

async function send(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  bcc?: string[];
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping send to", args.to);
    return;
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
      bcc: args.bcc,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Resend ${resp.status}: ${txt}`);
  }
}

/* -------------------------- Order Confirmation --------------------------- */

export async function sendOrderConfirmation(args: { orderId: string }) {
  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "order_number, email, total, subtotal, discount_total, shipping_total, tax_total, items, shipping_address, square_receipt_url",
    )
    .eq("id", args.orderId)
    .maybeSingle();
  if (!order) return;

  const items = order.items as CartItem[];
  const itemsHtml = items
    .map(
      (i) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
            <strong>${escape(i.product_name)}</strong><br>
            <span style="color:#64748b;font-size:12px;">
              ${Object.values(i.combination ?? {}).map(escape).join(" · ")} × ${i.quantity}
            </span>
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;">
            ${formatPrice(i.price * i.quantity)}
          </td>
        </tr>`,
    )
    .join("");

  const ship = order.shipping_address as Record<string, string> | null;
  const html = baseEmail({
    title: `Order ${order.order_number} confirmed`,
    bodyHtml: `
      <p>Thanks for your order — we got it and your card was charged.</p>
      <h2 style="margin-top:32px;font-size:18px;">Order ${escape(order.order_number)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${itemsHtml}</table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
        <tr><td>Subtotal</td><td style="text-align:right;">${formatPrice(order.subtotal)}</td></tr>
        ${
          Number(order.discount_total) > 0
            ? `<tr><td>Discount</td><td style="text-align:right;color:#16a34a;">−${formatPrice(order.discount_total)}</td></tr>`
            : ""
        }
        <tr><td>Shipping</td><td style="text-align:right;">${formatPrice(order.shipping_total)}</td></tr>
        ${
          Number(order.tax_total) > 0
            ? `<tr><td>Tax</td><td style="text-align:right;">${formatPrice(order.tax_total)}</td></tr>`
            : ""
        }
        <tr><td style="font-weight:600;border-top:1px solid #e2e8f0;padding-top:8px;">Total</td>
        <td style="text-align:right;font-weight:600;border-top:1px solid #e2e8f0;padding-top:8px;">${formatPrice(order.total)}</td></tr>
      </table>
      ${
        ship
          ? `<h3 style="margin-top:32px;font-size:14px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Ship to</h3>
             <p style="margin-top:8px;font-size:14px;line-height:1.5;">
               ${escape(ship.full_name)}<br>
               ${ship.company ? `${escape(ship.company)}<br>` : ""}
               ${escape(ship.address1)}<br>
               ${ship.address2 ? `${escape(ship.address2)}<br>` : ""}
               ${escape(ship.city)}, ${escape(ship.state)} ${escape(ship.postal_code)}<br>
               ${escape(ship.country ?? "US")}
             </p>`
          : ""
      }
      <p style="margin-top:32px;">
        <a href="${absoluteUrl(`/account/orders`)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;">View order</a>
        ${order.square_receipt_url ? `&nbsp;<a href="${order.square_receipt_url}" style="display:inline-block;padding:10px 18px;border:1px solid #e2e8f0;color:#0f172a;text-decoration:none;border-radius:6px;">Square receipt</a>` : ""}
      </p>`,
  });

  await send({
    to: order.email,
    subject: `Order ${order.order_number} confirmed`,
    html,
  });

  // Internal notification.
  if (process.env.ADMIN_NOTIFY_EMAIL) {
    await send({
      to: process.env.ADMIN_NOTIFY_EMAIL,
      subject: `[Wrapfly] New order ${order.order_number} — ${formatPrice(order.total)}`,
      html: `<p>New order <strong>${escape(order.order_number)}</strong> from ${escape(order.email)} for ${formatPrice(order.total)}.</p>`,
    }).catch(() => {});
  }
}

/* ---------------------------- Order Shipped ------------------------------ */

export async function sendOrderShipped(args: {
  orderId: string;
  trackingNumber: string;
  carrier?: string;
}) {
  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("order_number, email, total")
    .eq("id", args.orderId)
    .maybeSingle();
  if (!order) return;

  const html = baseEmail({
    title: "Your order is on the way",
    bodyHtml: `
      <p>Good news — your order <strong>${escape(order.order_number)}</strong> has shipped.</p>
      <p style="font-size:18px;margin-top:16px;">Tracking: <strong>${escape(args.trackingNumber)}</strong>${args.carrier ? ` (${escape(args.carrier)})` : ""}</p>
      <p style="margin-top:24px;">
        <a href="${absoluteUrl("/account/orders")}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;">View order</a>
      </p>`,
  });
  await send({ to: order.email, subject: `Your Wrapfly order has shipped — ${order.order_number}`, html });
}

/* ----------------------------- Refund ------------------------------------ */

export async function sendOrderRefunded(args: { orderId: string; amount: number }) {
  const supabase = createAdminClient();
  const { data: order } = await supabase
    .from("orders")
    .select("order_number, email")
    .eq("id", args.orderId)
    .maybeSingle();
  if (!order) return;
  const html = baseEmail({
    title: "Refund processed",
    bodyHtml: `
      <p>We&apos;ve issued a refund of <strong>${formatPrice(args.amount)}</strong> for order <strong>${escape(order.order_number)}</strong>.</p>
      <p>Refunds typically appear on your card statement within 5–10 business days.</p>`,
  });
  await send({ to: order.email, subject: `Refund processed — ${order.order_number}`, html });
}

/* ---------------------------- Templates ---------------------------------- */

function baseEmail({ title, bodyHtml }: { title: string; bodyHtml: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
          <a href="${absoluteUrl("/")}" style="text-decoration:none;color:#0f172a;font-weight:700;font-size:20px;">Wrapfly</a>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;">${escape(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
          Need help? Reply to this email or visit <a href="${absoluteUrl("/help/faq")}" style="color:#475569;">our help center</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escape(s: string | undefined | null): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

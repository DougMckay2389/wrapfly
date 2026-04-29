import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  getAllSettings,
  setSetting,
  type StoreInfo,
  type ShippingConfig,
  type TaxConfig,
  type PaymentsConfig,
  type AnnouncementConfig,
} from "@/lib/site-settings";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function saveStore(formData: FormData) {
  "use server";
  await requireAdmin();
  const value: StoreInfo = {
    name: String(formData.get("name") ?? ""),
    support_email: String(formData.get("support_email") ?? ""),
    support_phone: String(formData.get("support_phone") ?? ""),
    address: String(formData.get("address") ?? ""),
  };
  await setSetting("store", value);
  redirect("/admin/settings?ok=Store");
}

async function saveShipping(formData: FormData) {
  "use server";
  await requireAdmin();
  const value: ShippingConfig = {
    flat_rate: Number(formData.get("flat_rate") ?? 0),
    free_over: Number(formData.get("free_over") ?? 0),
    cutoff_time: String(formData.get("cutoff_time") ?? ""),
  };
  await setSetting("shipping", value);
  redirect("/admin/settings?ok=Shipping");
}

async function saveTax(formData: FormData) {
  "use server";
  await requireAdmin();
  const value: TaxConfig = {
    rate: Number(formData.get("rate") ?? 0),
    inclusive: formData.get("inclusive") === "on",
    note: String(formData.get("note") ?? ""),
  };
  await setSetting("tax", value);
  redirect("/admin/settings?ok=Tax");
}

async function savePayments(formData: FormData) {
  "use server";
  await requireAdmin();
  const value: PaymentsConfig = {
    processor: (formData.get("processor") as "square" | "stripe") ?? "square",
    environment:
      (formData.get("environment") as "sandbox" | "production") ?? "sandbox",
  };
  await setSetting("payments", value);
  redirect("/admin/settings?ok=Payments");
}

async function saveAnnouncement(formData: FormData) {
  "use server";
  await requireAdmin();
  const value: AnnouncementConfig = {
    text: String(formData.get("text") ?? ""),
    enabled: formData.get("enabled") === "on",
  };
  await setSetting("announcement", value);
  redirect("/admin/settings?ok=Announcement");
}

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const s = await getAllSettings();

  return (
    <div className="space-y-10 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-[var(--color-muted)] mt-1 text-sm">
          Store-wide configuration. Changes apply immediately to the live site.
        </p>
      </div>

      {ok ? (
        <div className="p-3 rounded-md border border-[var(--color-success)] bg-green-50 text-sm text-[var(--color-success)]">
          {ok} settings saved.
        </div>
      ) : null}

      <Section title="Store details" subtitle="Name, support contact, address shown in the footer and emails.">
        <form action={saveStore} className="grid sm:grid-cols-2 gap-3">
          <Field name="name" label="Store name" defaultValue={s.store.name} />
          <Field name="support_email" label="Support email" defaultValue={s.store.support_email} type="email" />
          <Field name="support_phone" label="Support phone" defaultValue={s.store.support_phone} />
          <Field name="address" label="Mailing address" defaultValue={s.store.address} />
          <div className="sm:col-span-2"><Save /></div>
        </form>
      </Section>

      <Section title="Shipping" subtitle="Default flat-rate calculator used at checkout.">
        <form action={saveShipping} className="grid sm:grid-cols-3 gap-3">
          <Field name="flat_rate" label="Flat rate ($)" defaultValue={String(s.shipping.flat_rate)} type="number" step="0.01" />
          <Field name="free_over" label="Free shipping over ($)" defaultValue={String(s.shipping.free_over)} type="number" step="0.01" />
          <Field name="cutoff_time" label="Same-day cutoff" defaultValue={s.shipping.cutoff_time} />
          <div className="sm:col-span-3"><Save /></div>
        </form>
      </Section>

      <Section title="Tax" subtitle="Single default tax rate. Per-state rates can be added later.">
        <form action={saveTax} className="grid sm:grid-cols-3 gap-3">
          <Field name="rate" label="Default tax rate (%)" defaultValue={String(s.tax.rate)} type="number" step="0.01" />
          <Toggle name="inclusive" label="Tax-inclusive prices" defaultChecked={s.tax.inclusive} />
          <Field name="note" label="Disclosure text" defaultValue={s.tax.note} className="sm:col-span-3" />
          <div className="sm:col-span-3"><Save /></div>
        </form>
      </Section>

      <Section title="Payments" subtitle="Active payment processor. Switch when ready to migrate from Square to Stripe.">
        <form action={savePayments} className="grid sm:grid-cols-2 gap-3">
          <Select name="processor" label="Processor" defaultValue={s.payments.processor}>
            <option value="square">Square</option>
            <option value="stripe">Stripe (coming soon)</option>
          </Select>
          <Select name="environment" label="Environment" defaultValue={s.payments.environment}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </Select>
          <div className="sm:col-span-2"><Save /></div>
        </form>
      </Section>

      <Section title="Announcement bar" subtitle="One-line banner shown above the header.">
        <form action={saveAnnouncement} className="grid sm:grid-cols-3 gap-3">
          <Field name="text" label="Text" defaultValue={s.announcement.text} className="sm:col-span-2" />
          <Toggle name="enabled" label="Show on site" defaultChecked={s.announcement.enabled} />
          <div className="sm:col-span-3"><Save /></div>
        </form>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--color-border)] rounded-lg p-5">
      <h2 className="font-semibold">{title}</h2>
      {subtitle ? <p className="text-xs text-[var(--color-muted)] mt-0.5 mb-4">{subtitle}</p> : null}
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  step,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  step?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      />
    </div>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium block mb-1">{label}</label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm self-end pb-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

function Save() {
  return (
    <button className="px-4 py-2 rounded-md bg-[var(--color-brand-900)] text-white text-sm font-semibold hover:bg-[var(--color-brand-800)]">
      Save
    </button>
  );
}

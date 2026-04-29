import { createAdminClient } from "@/lib/supabase/server";

/**
 * Typed access to the site_settings key/value store.
 *
 * site_settings is a single Postgres table with shape (key text, value jsonb).
 * Each key holds a small JSON blob — store info, shipping rates, tax rates,
 * announcement bar, etc. — so we can add new admin-controlled config without
 * a migration each time.
 */

export type StoreInfo = {
  name: string;
  support_email: string;
  support_phone: string;
  address: string;
};

export type ShippingConfig = {
  flat_rate: number;
  free_over: number;
  cutoff_time: string;
};

export type TaxConfig = {
  rate: number;
  inclusive: boolean;
  note: string;
};

export type PaymentsConfig = {
  processor: "square" | "stripe";
  environment: "sandbox" | "production";
};

export type AnnouncementConfig = {
  text: string;
  enabled: boolean;
};

const DEFAULTS = {
  store: {
    name: "Wrapfly",
    support_email: "support@wrapfly.com",
    support_phone: "",
    address: "",
  } as StoreInfo,
  shipping: {
    flat_rate: 12,
    free_over: 250,
    cutoff_time: "2:00 PM CT",
  } as ShippingConfig,
  tax: { rate: 0, inclusive: false, note: "" } as TaxConfig,
  payments: {
    processor: "square",
    environment: "sandbox",
  } as PaymentsConfig,
  announcement: {
    text: "Same-day shipping on orders before 2pm CT",
    enabled: true,
  } as AnnouncementConfig,
};

type SettingsMap = typeof DEFAULTS;

export async function getSetting<K extends keyof SettingsMap>(
  key: K,
): Promise<SettingsMap[K]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", key as string)
    .maybeSingle();
  if (!data?.value) return DEFAULTS[key];
  return { ...DEFAULTS[key], ...(data.value as object) } as SettingsMap[K];
}

export async function setSetting<K extends keyof SettingsMap>(
  key: K,
  value: SettingsMap[K],
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("site_settings")
    .upsert(
      { key: key as string, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

export async function getAllSettings() {
  const supabase = createAdminClient();
  const { data } = await supabase.from("site_settings").select("key, value");
  const out: Partial<Record<keyof SettingsMap, unknown>> = {};
  for (const row of data ?? []) {
    out[row.key as keyof SettingsMap] = row.value;
  }
  // Fill in defaults for anything missing
  return {
    store: { ...DEFAULTS.store, ...((out.store as object) ?? {}) } as StoreInfo,
    shipping: {
      ...DEFAULTS.shipping,
      ...((out.shipping as object) ?? {}),
    } as ShippingConfig,
    tax: { ...DEFAULTS.tax, ...((out.tax as object) ?? {}) } as TaxConfig,
    payments: {
      ...DEFAULTS.payments,
      ...((out.payments as object) ?? {}),
    } as PaymentsConfig,
    announcement: {
      ...DEFAULTS.announcement,
      ...((out.announcement as object) ?? {}),
    } as AnnouncementConfig,
  };
}

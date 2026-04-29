/**
 * Shared domain types — keep in sync with the Postgres schema.
 * For full DB types, run `npx supabase gen types typescript` once the project
 * is linked locally; that generates a matching `database.types.ts`.
 */

export type UUID = string;

export type Category = {
  id: UUID;
  base44_id: string | null;
  name: string;
  slug: string;
  parent_id: UUID | null;
  level: number;
  icon: string | null;
  image_url: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  path: string;
  meta_title: string | null;
  meta_description: string | null;
};

export type SpecRow = { label: string; value: string };
export type ResourceRow = { name: string; url: string; type: string };
export type DimensionOption = {
  value: string;
  label: string;
  swatch?: string | null;
};
export type VariantOptions = Record<string, DimensionOption[]>;
export type Combination = Record<string, string>;

export type Product = {
  id: UUID;
  base44_id: string | null;
  name: string;
  slug: string;
  sku: string;
  category_id: UUID | null;
  brand: string | null;
  description: string | null;
  short_description: string | null;
  base_price: number;
  images: string[];
  specifications: SpecRow[];
  resources: ResourceRow[];
  variant_dimensions: string[];
  variant_options: VariantOptions;
  tags: string[];
  is_active: boolean;
  meta_title: string | null;
  meta_description: string | null;
  rating_avg: number | null;
  review_count: number;
  enriched_summary: string | null;
  enriched_features: string[] | null;
  created_at: string;
  updated_at: string;
};

export type ProductVariant = {
  id: UUID;
  base44_id: string | null;
  product_id: UUID;
  sku: string;
  combination: Combination;
  price: number;
  compare_price: number | null;
  stock_qty: number;
  weight_oz: number | null;
  image_url: string | null;
  images: string[];
  is_available: boolean;
};

export type CartItem = {
  product_id: UUID;
  variant_id: UUID;
  product_name: string;
  variant_sku: string;
  combination: Combination;
  price: number;
  quantity: number;
  image_url: string | null;
};

export type Cart = {
  id: UUID;
  user_id: UUID | null;
  guest_token: string | null;
  items: CartItem[];
  subtotal: number;
  coupon_code: string | null;
  discount: number;
};

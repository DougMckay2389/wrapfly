/**
 * Wrap-vinyl finish detection.
 *
 * The 3M / Avery / Oracal feeds don't expose a `finish` field on each
 * color — but the swatch image URL almost always encodes it
 * (e.g. `3M_2080_SW_Gloss_Black.png`, `3M_2080_SW_Satin_Apple_Green.png`,
 * `3M_2080_SW_High_Gloss_Blue_Raspberry.png`,
 * `3M_2080_SW_Carbon_Fiber_Anthracite.png`).
 *
 * `getFinishes()` parses the URL and color label and returns the list of
 * finishes that apply (a color can be Matte AND Metallic, for example).
 */

export const ALL_FINISHES = [
  "Gloss",
  "Hi Gloss",
  "Matte",
  "Satin",
  "Metallic",
  "Carbon Fiber",
  "Brushed",
] as const;

export type Finish = (typeof ALL_FINISHES)[number];

const SOURCE_PATTERNS: Array<[RegExp, Finish]> = [
  [/(^|[_\s-])high[_\s-]?gloss([_\s-]|$)/i, "Hi Gloss"],
  [/(^|[_\s-])hi[_\s-]?gloss([_\s-]|$)/i, "Hi Gloss"],
  [/(^|[_\s-])gloss([_\s-]|$)/i, "Gloss"],
  [/(^|[_\s-])matte?([_\s-]|$)/i, "Matte"],
  [/(^|[_\s-])satin([_\s-]|$)/i, "Satin"],
  [/(^|[_\s-])brushed([_\s-]|$)/i, "Brushed"],
  [/(^|[_\s-])metallic([_\s-]|$)/i, "Metallic"],
  [/(^|[_\s-])carbon[_\s-]?fiber([_\s-]|$)/i, "Carbon Fiber"],
];

/**
 * Returns the unique set of finishes that apply to a given color option.
 * Looks at the swatch URL filename (most reliable) and the label/value text
 * (catches things like "Black Metallic" where the swatch URL doesn't say
 * "Metallic").
 */
export function getFinishes(opt: {
  value?: string | null;
  label?: string | null;
  swatch?: string | null;
}): Finish[] {
  const haystack = [opt.value, opt.label, opt.swatch]
    .filter(Boolean)
    .join(" ");
  const out = new Set<Finish>();
  for (const [re, finish] of SOURCE_PATTERNS) {
    if (re.test(haystack)) out.add(finish);
  }
  // If we found nothing, default to Gloss (the most common finish for
  // unannotated colors like "Boat Blue" or "Cosmic Blue").
  if (out.size === 0) out.add("Gloss");
  return Array.from(out);
}

/**
 * Renders a friendlier size label by stripping the redundant width.
 *   "60 \" x 25 yd"  →  "25 yd"
 *   "60\" x 1 yd"     →  "1 yd"
 *   "60in x 50yd"     →  "50yd"
 */
export function prettySize(raw: string): string {
  return raw
    .replace(/^\d+\s*["”'']?\s*x\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

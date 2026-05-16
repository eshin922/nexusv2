// Slice 8 sub-step 5 hot-fix — client-side validation for percent fields.
//
// Every percent field in the schema is `numeric(5,4)`, which caps stored
// values at ±9.9999 (= ±999.99% in display). A user typing 3025% (decimal
// 30.25) overflows, and Postgres throws `numeric_field_overflow` (SQL
// state 22003) which surfaced as a Next.js error page during sub-step 5
// smoke testing.
//
// Defense in depth:
//   1. UI validates before save fires (this module).
//   2. Action layer's runAction translates 22003 → VALIDATION_ERROR
//      (action-result.ts) so a malformed bypass still returns a
//      structured error, not a 500.
//   3. The store action receives the validated/normalized decimal, so
//      optimistic recompute never sees junk.
//
// We accept up to ±999% (decimal ±9.99) — slightly conservative against
// the actual 9.9999 ceiling, leaving headroom and using round numbers in
// error messages.

const MAX_DECIMAL = 9.99;

// markup: packaging_inputs.markup_pct,
//         freight_legs.{freight,duty,tariff}_markup_pct (Slice R6.2
//         per-component pills)
//         (natural min 0; never negative).
// adj:    quotes.global_price_adj_pct
//         (negative discounts are valid; bounds are symmetric).
// rate:   freight_legs.customs.{duty_pct,tariff_pct} (Slice R6.2 JSONB),
//         firm_settings.target_margin_pct, firm_settings.floor_margin_pct
//         (natural min 0; never negative).
export type PercentFieldType = "markup" | "adj" | "rate";

const ALLOW_NEGATIVE: Record<PercentFieldType, boolean> = {
  markup: false,
  adj: true,
  rate: false,
};

const LABEL: Record<PercentFieldType, string> = {
  markup: "Markup",
  adj: "Adjustment",
  rate: "Rate",
};

export type PercentValidation =
  | { valid: true; normalized: number }
  | { valid: false; message: string };

/**
 * Validate a decimal-form percent (0.30 = 30%) against numeric(5,4) bounds.
 *
 * Caller responsibility: pre-parse the input string and convert to decimal
 * (divide by 100 for percent-display inputs like freight/customs/global;
 * pass directly for raw-decimal inputs like packaging markup).
 *
 * Empty / null input is the caller's concern — pass through to the store
 * as null without invoking this validator. Only validate non-empty values.
 *
 * Error message renders bounds in percent display (% suffix) regardless
 * of input convention, since that's what the user sees in the UI.
 */
export function validatePercentDecimal(
  decimal: number,
  fieldType: PercentFieldType,
): PercentValidation {
  if (!Number.isFinite(decimal)) {
    return { valid: false, message: "Enter a numeric value." };
  }
  const min = ALLOW_NEGATIVE[fieldType] ? -MAX_DECIMAL : 0;
  const max = MAX_DECIMAL;
  if (decimal < min || decimal > max) {
    const minPct = (min * 100).toFixed(0);
    const maxPct = (max * 100).toFixed(0);
    return {
      valid: false,
      message: `${LABEL[fieldType]} must be between ${minPct}% and ${maxPct}%.`,
    };
  }
  return { valid: true, normalized: decimal };
}

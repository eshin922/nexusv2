/**
 * Operator-facing labels for governed enum vocabularies.
 *
 * ---------------------------------------------------------------------------
 * The rule this exists to enforce
 * ---------------------------------------------------------------------------
 *
 * **A field backed by an enum or other governed vocabulary is never free text.**
 * Free text is reserved for genuine narrative — notes, comments, descriptions,
 * explanations. Everything else is a controlled selection.
 *
 * Reference moment (2026-08-06): Freight Type rendered as `<input type="text">`
 * while `freight_destination_breaks.mode` is a Postgres enum. Typing
 * "Ocean FCL" — precisely the label an operator would use — produced
 * `invalid input value for enum freight_leg_mode`, a 500, and a full-page
 * Costs runtime error. The database was acting as the first validator, and a
 * constraint violation was escaping as a crash.
 *
 * The same class had already been found and fixed once: DOM-parity audit
 * finding F-G converted Incoterm from free text to a select, recording that
 * "the persisted authority is the freightIncoterm pgEnum, and free text would
 * admit values the column rejects." Freight Type was the sibling field on the
 * same row and was missed. Two instances make it a class, not an accident.
 *
 * ---------------------------------------------------------------------------
 * Deterministic, not a second vocabulary
 * ---------------------------------------------------------------------------
 *
 * Labels are DERIVED from the enum value, never hand-maintained. A curated map
 * would be a second vocabulary that drifts from the first — the enum stays the
 * single authority, and adding a value to it yields a correct label with no
 * code change.
 *
 * Transformation: split on `_`, upcase known trade acronyms, title-case the
 * rest.
 *
 *     ocean_fcl   -> Ocean FCL        ltl_truck   -> LTL Truck
 *     ocean_lcl   -> Ocean LCL        truckload   -> Truckload
 *     air_freight -> Air Freight      drayage     -> Drayage
 *     air_express -> Air Express      parcel      -> Parcel
 *     exw_pickup  -> EXW Pickup       other       -> Other
 */

/**
 * Tokens that are trade acronyms rather than words. Anything not listed is
 * title-cased. Extend only when a genuine acronym enters an enum — this is the
 * one place a judgement call lives, and it is deliberately small.
 */
const ACRONYMS = new Set([
  "fcl",
  "lcl",
  "ltl",
  "exw",
  "ddp",
  "dap",
  "fob",
  "fca",
  "cif",
  "cm",
  "rd",
  "moq",
  "pp",
  "sp",
  "tp",
]);

/** `ocean_fcl` -> `Ocean FCL`. Pure; safe on any snake_case enum value. */
export function enumLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((token) =>
      ACRONYMS.has(token.toLowerCase())
        ? token.toUpperCase()
        : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join(" ");
}

/** `[{ value, label }]` for rendering a governed `<select>`. */
export function enumOptions<T extends string>(
  values: readonly T[],
): Array<{ value: T; label: string }> {
  return values.map((value) => ({ value, label: enumLabel(value) }));
}

// ---------------------------------------------------------------------------
// Governed vocabularies
// ---------------------------------------------------------------------------
//
// Mirrors of the pgEnum values. Kept beside the labeller so a UI control and a
// server-side guard read the SAME list — the guard is what stops an invalid
// value reaching persistence, and it must not be able to drift from the
// options the operator was shown.

/** `freight_leg_mode` — freight_destination_breaks.mode, freight_legs.mode. */
export const FREIGHT_LEG_MODES = [
  "parcel",
  "ocean_fcl",
  "ocean_lcl",
  "air_freight",
  "air_express",
  "ltl_truck",
  "truckload",
  "drayage",
  "exw_pickup",
  "other",
] as const;

export type FreightLegMode = (typeof FREIGHT_LEG_MODES)[number];

/** Narrowing guard. Empty/absent is valid — the field is optional. */
export function isFreightLegMode(value: string): value is FreightLegMode {
  return (FREIGHT_LEG_MODES as readonly string[]).includes(value);
}

/**
 * The governed V1 Direct Service vocabulary — BV-012 §5.f.
 *
 * A closed set. BV-011's other accounting destinations (Setup, Tooling,
 * Artwork, Dies, Print Plates, Samples / PPS, Processing Fee, Freight / Duties
 * / Tariffs, Customs, Cartons, Bulk Raw) are deliberately NOT sellable on their
 * own: the accounting map answers where a cost projects, never what may be sold
 * by itself. Promoting one is a business decision and should require editing
 * this list plus a migration, not passing a new string.
 *
 * Bulk Raw is the case worth naming, because it is the tempting one: it is
 * material/input economics belonging inside an Item Group's finished-good
 * envelope, not a standalone engagement.
 *
 * Kept beside the attachment gate rather than in the schema module so that
 * every consumer of the vocabulary — the create action, the library surface,
 * and later the Costs authoring gate — reads one list.
 */

export const DIRECT_SERVICE_IDENTITIES = [
  "formulation",
  "filling_blending",
  "packout_assembly",
  "testing_micros",
  "other_service",
] as const;

export type DirectServiceIdentity = (typeof DIRECT_SERVICE_IDENTITIES)[number];

/** Operator-facing labels. The stored value is the enum, never the label. */
export const DIRECT_SERVICE_LABELS: Record<DirectServiceIdentity, string> = {
  formulation: "Formulation",
  filling_blending: "Filling / Blending",
  packout_assembly: "Pack-out / Assembly",
  testing_micros: "Testing / Micros",
  other_service: "Other Service",
};

export function directServiceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return DIRECT_SERVICE_LABELS[value as DirectServiceIdentity] ?? value;
}

/**
 * The ONE governed Production input each Direct Service exposes (Stage 3 A).
 *
 * ── WHY A CONSTANT AND NOT A TABLE ────────────────────────────────────────
 *
 * This is closed governed vocabulary, and the disposition says it is NOT
 * operator-selectable. A table would make it settable by anyone with admin
 * access; a constant makes changing it a code change with a review attached.
 * Deliberately not `product_types.field_schema` either — that mechanism is
 * operator-populated, which is the selectability being refused.
 *
 * ── WHY ONE INPUT, NOT A FILTERED TABLE ───────────────────────────────────
 *
 * A one-row surface and the full Item Group Production table filtered to one
 * row look identical and are not. The filtered table is a table that currently
 * shows one thing, and the first widening of the filter — or the first stray
 * row — turns it back into an Item Group surface on a leaf, which is what #282
 * removed. The surface renders the input this map names and has no capacity to
 * render another.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 *
 * Bulk Raw, Setup, Tooling, Artwork, Freight / Duties / Tariffs, Customs,
 * Dies, Print Plates, Samples / PPS, Processing Fee, Cartons. Those remain
 * Item Group / OTC economics. Bulk Raw is the tempting one and the one the
 * disposition names.
 */
export const DIRECT_SERVICE_PRODUCTION_INPUT = {
  formulation: "rdTotal",
  filling_blending: "fillingBlendingCost",
  packout_assembly: "cmAssemblyTotal",
  // `testingMicrosTotal` did not exist until migration 0083. It is its own
  // column rather than a reuse of `otherServiceTotal` because BV-011 maps
  // Testing and Other to different accounting destinations.
  testing_micros: "testingMicrosTotal",
  other_service: "otherServiceTotal",
} as const satisfies Record<DirectServiceIdentity, string>;

export type DirectServiceProductionColumn =
  (typeof DIRECT_SERVICE_PRODUCTION_INPUT)[DirectServiceIdentity];

/** The label an operator reads above the single input. */
export const DIRECT_SERVICE_PRODUCTION_LABEL: Record<DirectServiceIdentity, string> = {
  formulation: "R&D / Formulation",
  filling_blending: "Filling / Blending",
  packout_assembly: "CM Assembly / Pack-out",
  testing_micros: "Testing / Micros",
  other_service: "Other Service",
};

/** Every column a Direct Service may NOT author, for assertion rather than trust. */
export const DIRECT_SERVICE_FORBIDDEN_PRODUCTION_COLUMNS = [
  "bulkRawCost",
  "setupFeeTotal",
  "toolingArtworkTotal",
] as const;

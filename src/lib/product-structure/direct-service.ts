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

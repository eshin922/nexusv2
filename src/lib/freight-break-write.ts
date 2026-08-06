// Freight quantity-break write resolution — pure, no I/O.
//
// Extracted from `updateFreightDestinationBreakGroup` so the "one value, all
// breaks" rule is a named, behaviourally testable contract rather than an
// inline branch inside a transaction.
//
// THE RULE, per the authoritative worksheet (docs/design-authority/freight-1a):
//
//   "One value, all breaks" governs the COMMERCIAL TERMS — freight amount and
//   markup. It does not collapse the OPERATIONAL IDENTITY of the individual
//   quantity breaks: mode and description stay per-break.
//
// The same shipment family may legitimately be LTL at one break and FTL at
// another while carrying one negotiated amount, at one markup, across all of
// them. That is why the bundle places mode and description on the break row
// rather than on the shipment, and why flat mode must not propagate them.
//
// Wording corrected 2026-08-06 (Validation 2). The prose previously said
// "governs the freight AMOUNT only", which contradicted both the enumerated
// consequence directly below and the implementation — markup has always
// followed the flat rule alongside the amount, per the PR #183 contract and
// its tests. Documentation correction only; no behaviour changed.
//
// Consequences encoded here:
//   · amount + markup source from the flat tier when flat, own tier otherwise
//   · mode + description ALWAYS source from the row's own tier
//   · a field absent from the submission is PRESERVED, never nulled — so
//     toggling flat on or off cannot destroy tier-specific operational values

export type BreakFieldSources = {
  /** Tier id whose submitted freight amount + markup apply to this row. */
  amountKey: string;
  /** Tier id whose submitted mode applies, or null to preserve the stored value. */
  modeKey: string | null;
  /** Tier id whose submitted description applies, or null to preserve the stored value. */
  noteKey: string | null;
};

export function resolveBreakFieldSources(args: {
  flat: boolean;
  sourceTierId: string;
  rowTierId: string;
  submittedKeys: ReadonlySet<string>;
}): BreakFieldSources {
  const { flat, sourceTierId, rowTierId, submittedKeys } = args;

  // Amount and markup follow the flat rule.
  const amountKey = flat ? sourceTierId : rowTierId;

  // Mode and description never follow it. They are per-break by nature and
  // are only written when the submission actually carries them.
  const modeKey = submittedKeys.has(`mode:${rowTierId}`) ? rowTierId : null;
  const noteKey = submittedKeys.has(`shipmentNote:${rowTierId}`) ? rowTierId : null;

  return { amountKey, modeKey, noteKey };
}

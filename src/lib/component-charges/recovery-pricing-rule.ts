/**
 * The rule that decides whether an elected charge owes a recovery price, and
 * the sentence that reports a gap. Pure, and deliberately in its own module.
 *
 * `recovery-pricing.ts` reads the database, so importing it pulls `@/db` and it
 * cannot be loaded by a unit test. A rule whose correctness can only be
 * exercised through a mock of something else is a rule nobody checks — the same
 * reason `tier-label.ts` sits apart from the action that calls it.
 *
 * The reader re-exports both, so callers need not know they live here.
 */

/**
 * Whether a treatment obliges the operator to state what the charge recovers.
 *
 * `absorbed` does not, and that is not an omission: absorbing a charge IS the
 * decision to recover nothing, stated. The other two both put a governed amount
 * in front of the customer — `separate` as its own line, `included` inside the
 * unit price — and neither can be built from an amount nobody has given.
 *
 * An UNPLACED charge is not this gate's business. The placement gate already
 * refuses it, and reporting the same charge twice for two reasons would send an
 * operator to fix a price on something they have not yet decided to bill.
 */
export function treatmentRequiresAsk(mode: string | null): boolean {
  return mode === "separate" || mode === "included";
}

export type ChargeRecoveryPricingGap = {
  chargeInstanceId: string;
  chargeKey: string;
  /** The charge's type label, and the operator's own label where there is one. */
  label: string;
  ownLabel: string | null;
  /** The causal component. */
  quoteLeafId: string;
  /** The elected treatment that obliges the ask. */
  mode: string;
  /** Quoted tiers with no ask stated — named, so the operator can go and fix them. */
  missingTierIds: string[];
  missingTierLabels: string[];
};

/** One operator-facing sentence per gap. Same grammar as `describeMissing`. */
export function describeMissingAsk(gap: ChargeRecoveryPricingGap): string {
  const name = gap.ownLabel ? `${gap.label} · ${gap.ownLabel}` : gap.label;
  return `${name} — no recovery entered at ${gap.missingTierLabels.join(", ")}`;
}


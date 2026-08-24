/**
 * The Accounting zone — what Accounting is told, in the register that says the
 * customer cannot see it.
 *
 * ── WHAT THE AUTHORITY SPECIFIES ────────────────────────────────────────
 *
 * `docs/quote-presentation-profile-brief.md`, "Interaction model":
 *
 *   "Accounting instructions in their own zone, below the existing BOUNDARY
 *    GUARD rule, in a register that reads *not shown to the customer* — the
 *    surface already has this vocabulary and it should be reused, not
 *    reinvented."
 *
 * So it borrows `--internal`, the purple the boundary-guard notice and the
 * cost-build internal-only badges already use. That register means exactly one
 * thing across this app — the customer cannot see this — and minting a second
 * one for the same meaning is how a vocabulary stops meaning anything.
 *
 * ── TIER IDENTITY IS PART OF THE INSTRUCTION ────────────────────────────
 *
 * The authority's "What Accounting needs downstream" table requires it:
 * *"featured / accepted tier — which tier the printed price belongs to."*
 *
 * The first version omitted it, and on a four-tier quote that printed
 * "Project setup — $140.00" three times at three different amounts with
 * nothing saying which tier each belonged to. Three true sentences arranged
 * into something an accountant cannot act on.
 *
 * Tier labels come from the customer view, so the tier named here is the tier
 * the customer was shown — not an internal label.
 *
 * ── OPERATOR LABELS, NOT CHARGE KEYS ────────────────────────────────────
 *
 * `chargePolicy(key).label`, not the key. The first version printed
 * `project_setup` and `tooling_artwork_legacy` — engineering vocabulary as
 * operator content, which is the exact divergence (R7) this component was
 * written to repair, reintroduced inside the repair.
 *
 * ── IT PRESENTS; IT DOES NOT DECIDE ─────────────────────────────────────
 *
 * Every line is the sentence the SEND freeze will write, read from the same
 * construction the document renders from. This component resolves no rate,
 * sums nothing and offers no control — a charge's treatment is decided on the
 * surface that owns the economics, which under the R5 disposition is not this
 * one.
 *
 * That is also why an amortized charge can state a per-unit figure and a
 * legacy one cannot: a legacy allocated fee flows through the sell ladder, so
 * the quote-level adjustment reaches it and no fixed per-unit amount exists.
 * The instruction says so rather than printing a number the customer did not
 * pay.
 */

import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import { instructionSentence } from "@/lib/commercial-recovery/frozen-instruction";
import { chargePolicy } from "@/lib/commercial-recovery/registry";
import type { CustomerViewTier } from "@/types/quote";

export function AccountingZone({
  instructions,
  tiers,
}: {
  /**
   * Projected from the construction, exactly as the send transaction freezes
   * it. One per placed charge per (owner, tier) — including charges the
   * operator never elected, because a legacy-placed charge has no election row
   * and Accounting still has to be told not to invoice it.
   */
  instructions: readonly FrozenRecoveryInstruction[];
  /** For naming the tier an instruction belongs to, as the customer saw it. */
  tiers: readonly CustomerViewTier[];
}) {
  const tierLabel = new Map(tiers.map((t) => [t.id, t.label]));

  // Several OWNERS in one tier can carry one charge with the same instruction;
  // Accounting reads a charge and a tier, not a rollup coordinate, so those
  // collapse. Tier is part of the key, so two tiers never collapse into one
  // line — that was the defect: identical-looking rows whose only difference
  // was the thing that had been left out.
  const seen = new Map<
    string,
    { charge: string; tier: string; sentence: string }
  >();
  for (const i of instructions) {
    const sentence = instructionSentence(i);
    seen.set(`${i.chargeKey}::${i.tierId}::${sentence}`, {
      charge: chargePolicy(i.chargeKey).label,
      tier: tierLabel.get(i.tierId) ?? "Unnamed tier",
      sentence,
    });
  }
  const rows = [...seen.values()];

  return (
    <section className="qp-accounting" data-testid="accounting-zone">
      <span className="eyebrow">Accounting · not shown to the customer</span>
      {rows.length === 0 ? (
        <p className="qp-accounting-body">
          This quote carries no governed one-time or landed charges, so there is
          nothing to instruct.
        </p>
      ) : (
        <>
          <p className="qp-accounting-body">
            What Accounting is told when this quote is sent — which charges are
            already embedded in the unit price, and which are invoiced
            separately.
          </p>
          <ul className="qp-accounting-list">
            {rows.map((r) => (
              <li key={`${r.charge}::${r.tier}::${r.sentence}`}>
                <span className="qp-accounting-charge">{r.charge}</span>
                <span className="qp-accounting-tier">{r.tier}</span>
                <br />
                <span className="qp-accounting-instruction">{r.sentence}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

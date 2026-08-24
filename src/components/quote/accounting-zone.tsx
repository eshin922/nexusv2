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
 * ── IT PRESENTS; IT DOES NOT DECIDE ─────────────────────────────────────
 *
 * Every line here is the sentence the SEND freeze will write, read from the
 * same construction the document renders from. This component resolves no
 * rate, sums nothing and offers no control — a charge's treatment is decided
 * on the surface that owns the economics, which under the R5 disposition is
 * not this one.
 *
 * That is also why the amortized case can say a per-unit figure and the legacy
 * case cannot: a legacy allocated fee flows through the sell ladder, so the
 * quote-level adjustment reaches it and no fixed per-unit amount exists to
 * state. The instruction says so rather than printing a number the customer
 * did not pay.
 */

import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import { instructionSentence } from "@/lib/commercial-recovery/frozen-instruction";

export function AccountingZone({
  instructions,
}: {
  /**
   * Projected from the construction, exactly as the send transaction freezes
   * it. One per placed charge per (owner, tier) — including charges the
   * operator never elected, because a legacy-placed charge has no election row
   * and Accounting still has to be told not to invoice it.
   */
  instructions: readonly FrozenRecoveryInstruction[];
}) {
  // Several owners and tiers can carry one charge with the same instruction.
  // Accounting reads a charge, not a rollup coordinate, so identical sentences
  // collapse — while genuinely different treatments of the same charge stay
  // visible, which is the case an operator most needs to see before sending.
  const seen = new Map<string, { charge: string; sentence: string }>();
  for (const i of instructions) {
    const sentence = instructionSentence(i);
    seen.set(`${i.chargeKey}::${sentence}`, {
      charge: i.chargeKey,
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
              <li key={`${r.charge}::${r.sentence}`}>
                <span className="qp-accounting-charge">{r.charge}</span>
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

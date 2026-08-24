"use client";

/**
 * The recovery workspace card.
 *
 * ── EVERY FIGURE COMES FROM THE CONSTRUCTED STATE ───────────────────────
 *
 * The rows are built by `buildRecoveryWorkspace`, which reads
 * `constructed.charges` and derives nothing. This component formats them. It
 * performs no rate arithmetic and never computes what a charge "would"
 * recover — asserted by test, because a surface that recomputed it would be
 * the second authority the whole workstream removed, at the one layer an
 * operator actually looks at.
 *
 * ── THE BUTTON NAMES THE CONTRACT, NOT THE PLACEMENT ────────────────────
 *
 * Two states can both look "included" and have different economics. A charge
 * amortized under LEGACY pricing sits in the sell ladder, so the quote-level
 * adjustment reaches it — the customer pays `recovery x (1 + gpa)`, measured as
 * +280 at 0.20 and +700 at 0.50 on a $1,400 recovery. An ELECTED amortization
 * is added after the ladder and recovers exactly the governed amount.
 *
 * So electing `included` on a quote that already allocates is NOT a no-op. It
 * moves the charge onto the governed contract and changes what the customer
 * pays, while the visible placement does not move. A label reading "In unit
 * price ✓" would present that as confirming the current state.
 *
 * Hence: labels describe the contract being selected, the current-state line
 * says which contract is in force, and each option states what changes.
 *
 * ── DENIED MODES ARE SHOWN, NOT HIDDEN ──────────────────────────────────
 *
 * A hidden option reads as an option that does not exist. A visibly-refused
 * one, with its governed reason, teaches the policy — and tells the operator
 * what would have to change. `absorbed` is currently refused for every
 * one-time charge, and its reason names the condition that opens it.
 *
 * ── THE IMPACT IS MEASURED BEFORE IT IS COMMITTED ───────────────────────
 *
 * Clicking a contract does not elect it. It asks the server what that contract
 * would do to the customer's total — the real engine on the real input with the
 * election substituted — and the operator confirms against the figure.
 *
 * Two acts rather than one, because the surfaced consequence here is that an
 * election is never a no-op: electing the contract a quote already appears to
 * have still moves the charge out of the price adjustment's reach. A single
 * click with the number arriving afterwards is the "harmless confirmation" this
 * surface must not be.
 *
 * The figure is measured on demand rather than rendered for every option on
 * every load: that would be one engine run per candidate for a number the
 * operator may never look at (Pattern 55).
 *
 * ── PENDING IS ACTION-SCOPED (Pattern 47(f)) ────────────────────────────
 *
 * One transition per charge row, keyed by charge, so electing on one row never
 * disables the controls of another. A surface-wide flag would satisfy 47(e)
 * completely while making unrelated rows dead.
 */

import { useState, useTransition } from "react";
import {
  previewChargeRecovery,
  setChargeRecovery,
} from "@/app/actions/commercial-recovery";
import type { RecoveryImpact } from "@/lib/commercial-recovery/impact";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryMode } from "@/lib/commercial-recovery/registry";

/**
 * What the operator is CHOOSING — the contract, not where the charge appears.
 *
 * "In unit price" named the placement, which is the half that can be identical
 * on both sides of a real economic change.
 */
const MODE_LABEL: Record<RecoveryMode, string> = {
  included: "Use governed amortization",
  separate: "Bill separately at the governed rate",
  absorbed: "Absorb the cost — no customer recovery",
};

/** What changes if they pick it. Contract terms; no figures derived here. */
const MODE_CONTRACT: Record<RecoveryMode, string> = {
  included:
    "Recovered inside the unit price at the governed rate, and no longer affected by quote-level or tier price adjustments. Accounting is instructed not to invoice it separately.",
  separate:
    "Recovered on its own customer line at the governed rate. Accounting invoices it separately.",
  absorbed:
    "DPS retains the cost and recovers nothing from the customer.",
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Did the customer's total actually move?
 *
 * Compared at the precision it is PRINTED at. Placement neutrality is exact in
 * the constructor, but the customer total is summed through the projection
 * where float addition is not associative — 2600 against 2599.9999999999995 on
 * a relocation that moves nothing. An exact comparison called that a movement
 * and emphasised it, beside two identical printed figures.
 */
const cents = (n: number) => Math.round(n * 100);
const moved = (before: number, after: number) => cents(before) !== cents(after);

/**
 * The contract in force right now.
 *
 * Legacy and elected are named differently even when the placement is the same,
 * because that is the distinction an operator cannot otherwise see.
 */
function currentContract(row: RecoveryChargeRow): string {
  if (row.mixed) {
    return `Mixed — this quote places this charge more than one way (${row.placements.join(", ")}). Electing applies one contract to all of them.`;
  }
  const placement = row.placements[0] ?? null;
  if (row.source === "legacy") {
    if (placement === "unit_price") {
      return "Currently amortized under legacy pricing — the recovered amount moves with quote-level price adjustments, so it is not independently governed.";
    }
    if (placement === "separate_line") {
      return "Currently billed on its own line under legacy pricing.";
    }
    return "Inherited from this quote's existing setup.";
  }
  if (placement === "unit_price") {
    return "Elected: governed amortization. Recovers the governed amount regardless of price adjustments.";
  }
  if (placement === "separate_line") {
    return "Elected: billed separately at the governed rate.";
  }
  return "Elected: absorbed by DPS.";
}

export function RecoveryCard({
  quoteId,
  rows,
  editable,
  supersessionWarning,
}: {
  quoteId: string;
  rows: RecoveryChargeRow[];
  /** False on a frozen quote: elections are draft-locked (Pattern 52). */
  editable: boolean;
  /**
   * Present when an economics-changing election would supersede a live
   * below-floor authorization. A READ — the existing fingerprint mechanism
   * still does the invalidating.
   */
  supersessionWarning: string | null;
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The measured contract awaiting confirmation, if any.
   *
   * Keyed by charge AND mode: a stale impact shown against a different button
   * would be a figure for a decision the operator is not making.
   */
  const [proposed, setProposed] = useState<{
    chargeKey: string;
    mode: RecoveryMode | null;
    impact: RecoveryImpact | null;
  } | null>(null);
  const [, startTransition] = useTransition();

  // Charges the quote does not carry are not decisions anyone needs to make.
  const present = rows.filter((r) => r.present);

  /** Step one: ask what it would do. Writes nothing. */
  function propose(chargeKey: string, mode: RecoveryMode | null) {
    setError(null);
    setProposed(null);
    setPendingKey(chargeKey);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("chargeKey", chargeKey);
    fd.set("mode", mode ?? "");
    startTransition(async () => {
      const res = await previewChargeRecovery(fd);
      setPendingKey(null);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setProposed({ chargeKey, mode, impact: res.data });
    });
  }

  /** Step two: commit what was measured. */
  function elect(chargeKey: string, mode: RecoveryMode | null) {
    setError(null);
    setProposed(null);
    setPendingKey(chargeKey);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("chargeKey", chargeKey);
    fd.set("mode", mode ?? "");
    startTransition(async () => {
      const res = await setChargeRecovery(fd);
      setPendingKey(null);
      // The governed reason, verbatim. The surface refuses too, but the
      // surface is not the boundary — this is what the boundary said.
      if (!res.ok) setError(res.error.message);
    });
  }

  if (present.length === 0) {
    return (
      <section className="r8-card r9-recovery" data-testid="recovery-card">
        <h3 className="r9-recovery-title">Charge recovery</h3>
        <p className="r9-recovery-note">
          This quote carries no governed one-time or landed charges.
        </p>
      </section>
    );
  }

  return (
    <section className="r8-card r9-recovery" data-testid="recovery-card">
      <h3 className="r9-recovery-title">Charge recovery</h3>
      <p className="r9-recovery-note">
        {/* The earlier note said relocation was CLOSED. It has since been
            opened and made revenue-neutral, so that sentence became false.
            And the neutrality claim it replaced ("moving a charge does not
            change what the customer pays") is not restored either: it holds
            between two ELECTED placements and not between legacy and elected,
            which is the comparison an operator is actually making here. */}
        Choosing a recovery contract for a charge. Between two elected
        contracts, moving a charge does not change what the customer pays — but
        electing a contract for the first time can, because a charge left on
        legacy pricing is reached by quote-level price adjustments and a
        governed one is not.
      </p>

      {supersessionWarning && (
        <p role="alert" data-testid="recovery-supersession" className="r9-recovery-warn">
          {supersessionWarning}
        </p>
      )}

      {error && (
        <p role="alert" data-testid="recovery-error" className="r9-recovery-warn">
          {error}
        </p>
      )}

      <ul className="r9-recovery-list">
        {present.map((row) => {
          const busy = pendingKey === row.chargeKey;
          return (
            <li
              key={row.chargeKey}
              className="r9-recovery-row"
              data-testid={`recovery-row-${row.chargeKey}`}
            >
              <div className="r9-recovery-head">
                <span className="r9-recovery-label">{row.label}</span>
                <span className="r9-recovery-amounts">
                  {usd(row.totalCost)} cost
                  {" · "}
                  {row.totalRecovery === null ? (
                    // Not "$0.00". No governed rate means no price, not a
                    // price computed at cost (BV-013).
                    <span data-testid="recovery-unpriced">not priced</span>
                  ) : (
                    <>{usd(row.totalRecovery)} governed recovery</>
                  )}
                </span>
              </div>

              <div
                className="r9-recovery-state"
                data-testid={`recovery-source-${row.chargeKey}`}
                data-source={row.source}
              >
                {currentContract(row)}
              </div>

              <div className="r9-recovery-modes">
                {row.options.map((opt) => {
                  // An election is on the governed contract whatever mode it
                  // names, so "already selected" is a statement about the
                  // CONTRACT — never true while the charge is still on legacy.
                  const selected =
                    row.source === "election" && row.electedMode === opt.mode;
                  return (
                    <span key={opt.mode} className="r9-recovery-mode">
                      <button
                        type="button"
                        // Pattern 47(f): keyed to THIS row, so an in-flight
                        // write on one charge never disables another.
                        disabled={!editable || busy || !opt.available || selected}
                        aria-pressed={selected}
                        // Every disabled control says why. A greyed action
                        // with no explanation is not acceptable operator
                        // behaviour.
                        title={
                          !editable
                            ? "This quote is no longer a draft; recovery is frozen."
                            : selected
                              ? "This contract is already in force for this charge."
                              : (opt.reason ?? MODE_CONTRACT[opt.mode])
                        }
                        data-testid={`recovery-${row.chargeKey}-${opt.mode}`}
                        data-available={opt.available ? "yes" : "no"}
                        // Measures. Does not elect — see the header.
                        onClick={() => propose(row.chargeKey, opt.mode)}
                      >
                        {MODE_LABEL[opt.mode]}
                        {selected ? " ✓ in force" : ""}
                      </button>
                      {opt.available ? (
                        // What the operator is agreeing to, on the surface
                        // rather than behind a hover. A contract change shown
                        // only on hover is a contract change nobody read.
                        <span className="r9-recovery-contract">
                          {MODE_CONTRACT[opt.mode]}
                        </span>
                      ) : (
                        opt.reason && (
                          // VISIBLE, not a tooltip alone. A hidden option reads
                          // as an option that does not exist.
                          <span className="r9-recovery-reason">{opt.reason}</span>
                        )
                      )}
                    </span>
                  );
                })}

                {row.electedMode !== null && (
                  <button
                    type="button"
                    disabled={!editable || busy}
                    title={
                      editable
                        ? "Return this charge to the pricing treatment it inherited. Restores the legacy result exactly."
                        : "This quote is no longer a draft; recovery is frozen."
                    }
                    data-testid={`recovery-${row.chargeKey}-clear`}
                    onClick={() => propose(row.chargeKey, null)}
                  >
                    Restore inherited pricing treatment
                  </button>
                )}
              </div>

              {proposed?.chargeKey === row.chargeKey && (
                <div
                  className="r9-recovery-confirm"
                  data-testid={`recovery-confirm-${row.chargeKey}`}
                >
                  {proposed.impact === null ? (
                    <p>That contract does not apply to this charge on this quote.</p>
                  ) : (
                    <>
                      <p className="r9-recovery-confirm-head">
                        {proposed.mode === null
                          ? "Restore inherited pricing treatment"
                          : MODE_LABEL[proposed.mode]}
                      </p>
                      <p>
                        {proposed.impact.governedRecovery === null ? (
                          // BV-013: nothing governs what it recovers, so no
                          // amount is stated for it.
                          <>No governed recovery is priced for this charge.</>
                        ) : (
                          <>
                            {usd(proposed.impact.governedRecovery)} recovered
                            {proposed.impact.perUnit !== null &&
                              proposed.impact.tierQuantity !== null && (
                                <>
                                  {" "}
                                  at {usd(proposed.impact.perUnit)}/unit across{" "}
                                  {proposed.impact.tierQuantity} quoted units
                                </>
                              )}
                            .
                          </>
                        )}
                      </p>
                      <p
                        data-testid={`recovery-impact-${row.chargeKey}`}
                        data-moves={
                          moved(
                            proposed.impact.customerTotalBefore,
                            proposed.impact.customerTotalAfter,
                          )
                            ? "yes"
                            : "no"
                        }
                      >
                        {/* Stated whether it moves or not. "No change" is the
                            answer an operator most needs to be able to trust,
                            and omitting it when nothing moves would leave them
                            unable to tell it from a figure that failed to
                            arrive. */}
                        Customer total: {usd(proposed.impact.customerTotalBefore)}
                        {" \u2192 "}
                        {usd(proposed.impact.customerTotalAfter)}
                        {!moved(
                          proposed.impact.customerTotalBefore,
                          proposed.impact.customerTotalAfter,
                        ) && <> — unchanged</>}
                      </p>
                      <div className="r9-recovery-confirm-actions">
                        <button
                          type="button"
                          disabled={!editable || busy}
                          data-testid={`recovery-commit-${row.chargeKey}`}
                          onClick={() => elect(row.chargeKey, proposed.mode)}
                        >
                          Confirm this contract
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          data-testid={`recovery-cancel-${row.chargeKey}`}
                          onClick={() => setProposed(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

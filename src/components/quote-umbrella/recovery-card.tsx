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
 * ── DENIED MODES ARE SHOWN, NOT HIDDEN ──────────────────────────────────
 *
 * A hidden option reads as an option that does not exist. A visibly-refused
 * one, with its governed reason, teaches the policy — and tells the operator
 * what would have to change. `absorbed` is currently refused for every
 * one-time charge, and its reason names the condition that opens it.
 *
 * ── PENDING IS ACTION-SCOPED (Pattern 47(f)) ────────────────────────────
 *
 * One transition per charge row, keyed by charge, so electing on one row never
 * disables the controls of another. A surface-wide flag would satisfy 47(e)
 * completely while making unrelated rows dead.
 */

import { useState, useTransition } from "react";
import { setChargeRecovery } from "@/app/actions/commercial-recovery";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryMode } from "@/lib/commercial-recovery/registry";

const MODE_LABEL: Record<RecoveryMode, string> = {
  included: "In unit price",
  separate: "Billed separately",
  absorbed: "Absorbed by DPS",
};

const PLACEMENT_LABEL: Record<string, string> = {
  unit_price: "in unit price",
  separate_line: "billed separately",
  absorbed: "absorbed",
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

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
  const [, startTransition] = useTransition();

  // Charges the quote does not carry are not decisions anyone needs to make.
  const present = rows.filter((r) => r.present);

  function elect(chargeKey: string, mode: RecoveryMode | null) {
    setError(null);
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
        {/* The neutrality claim is GONE, not softened.
            "Moving a recovered charge does not change what the customer pays"
            was tightened from a broader version and then disproved outright by
            certification: a charge inside the unit price is multiplied by the
            quote's price adjustment, and one billed separately is not. At a
            20% adjustment $140 became $168. Saying it here would tell an
            operator something the numbers contradict. */}
        How each governed charge is recovered from the customer. Where a charge
        sits affects what the customer pays when a price adjustment applies, so
        relocation is closed until that is settled.
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
                    <>{usd(row.totalRecovery)} recovered</>
                  )}
                </span>
              </div>

              <div className="r9-recovery-state">
                {row.mixed ? (
                  <span data-testid="recovery-mixed">
                    Mixed —{" "}
                    {row.placements.map((p) => PLACEMENT_LABEL[p] ?? p).join(", ")}
                  </span>
                ) : (
                  <span>
                    {PLACEMENT_LABEL[row.placements[0] ?? ""] ?? "—"}
                  </span>
                )}
                {" · "}
                <span data-testid={`recovery-source-${row.chargeKey}`}>
                  {row.source === "election"
                    ? "elected"
                    : "inherited from this quote's existing setup"}
                </span>
              </div>

              <div className="r9-recovery-modes">
                {row.options.map((opt) => {
                  const selected = row.electedMode === opt.mode;
                  return (
                    <span key={opt.mode} className="r9-recovery-mode">
                      <button
                        type="button"
                        // Pattern 47(f): keyed to THIS row, so an in-flight
                        // write on one charge never disables another.
                        disabled={!editable || busy || !opt.available}
                        aria-pressed={selected}
                        // Every disabled control says why. A greyed action
                        // with no explanation is not acceptable operator
                        // behaviour.
                        title={
                          !editable
                            ? "This quote is no longer a draft; recovery is frozen."
                            : (opt.reason ?? undefined)
                        }
                        data-testid={`recovery-${row.chargeKey}-${opt.mode}`}
                        data-available={opt.available ? "yes" : "no"}
                        onClick={() => elect(row.chargeKey, opt.mode)}
                      >
                        {MODE_LABEL[opt.mode]}
                        {selected ? " ✓" : ""}
                      </button>
                      {!opt.available && opt.reason && (
                        // VISIBLE, not a tooltip alone. A hidden option reads
                        // as an option that does not exist.
                        <span className="r9-recovery-reason">{opt.reason}</span>
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
                        ? "Return this charge to the setup it inherited."
                        : "This quote is no longer a draft; recovery is frozen."
                    }
                    data-testid={`recovery-${row.chargeKey}-clear`}
                    onClick={() => elect(row.chargeKey, null)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

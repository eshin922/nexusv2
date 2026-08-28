"use client";

/**
 * Card 1 · Commercial recovery.
 *
 * AUTHORITY: `docs/design-authority/customer-view/` — the reference of record's
 * rail, card 1. Header sub-line verbatim: *"Changes sell price and margin. Runs
 * through pricing governance."*
 *
 * ── WHY THIS CARD IS ON THIS SURFACE ────────────────────────────────────
 *
 * It moves economics, it is governed by Pricing, and it lives here. All three
 * at once — D3. An earlier reconciliation read *"not a presentation control"*
 * as *"must not appear on the workspace"* and deleted this card; that was a
 * misreading of a sentence scoped to card 2. See BUNDLE.md D3.
 *
 * ── OPERATOR VOCABULARY, NOT ENGINE VOCABULARY ──────────────────────────
 *
 * The deleted card said "Use governed amortization", "legacy pricing",
 * "elected", and cited BV-011 by number. Every sentence was true and none of
 * them was the operator's question. The authority's words are
 * `In unit price` / `Separate` / `Absorbed`, with a policy line that states
 * what is allowed and that the cost is governed elsewhere.
 *
 * The legacy/elected distinction stays load-bearing underneath — `source` still
 * decides how the engine prices the charge — but it is not the operator's
 * vocabulary and does not appear as a label here.
 *
 * ── DENIED OPTIONS ARE RENDERED, NOT HIDDEN ─────────────────────────────
 *
 * *"Options not permitted by the charge's governed policy render disabled …
 * with a title giving the reason. Disabled options are still rendered — the
 * constraint must be visible, not hidden."* Same rule the action layer enforces
 * through the same `refusalFor`, so the surface cannot offer what the boundary
 * would refuse.
 *
 * ── PICKING ELECTS. THERE IS NO CONFIRMATION STEP ───────────────────────
 *
 * The reference:
 *
 *     pick: permitted && !s.frozen ? () => this.setRecovery(c.id, o.id) : () => {}
 *
 * Immediate. The README says the same: *"Picking a permitted option sets that
 * charge's recovery mode."*
 *
 * An earlier version made this a two-step measure-then-confirm, to show the
 * customer-total delta before committing. That came from the superseded R5-era
 * framing, when this card lived alone at the bottom of a page and the operator
 * could not see what it changed.
 *
 * In this composition they can. The document is beside the control, the
 * margin-after-recovery cards are beneath it, and both re-render on the pick —
 * so the artifact IS the confirmation, and a modal restating it is a dialog in
 * front of the answer. That is the whole reason the surface is two panes.
 *
 * `measureRecoveryImpact` stays as a certified library. It is no longer a gate
 * on this control.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import type { AuthoritativeProjection } from "./authoritative-projection";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryMode } from "@/lib/commercial-recovery/registry";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { RecoveryProposalFailure } from "./use-recovery-draft";

/** The authority's words for the three treatments. */
const MODE_LABEL: Record<RecoveryMode, string> = {
  included: "In unit price",
  separate: "Separate",
  absorbed: "Absorbed",
};

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function marginState(
  m: number | null,
  floor: number,
  target: number,
): "below_floor" | "below_target" | "on_target" | "unknown" {
  if (m === null) return "unknown";
  const eps = 1e-6;
  if (m < floor - eps) return "below_floor";
  if (m < target - eps) return "below_target";
  return "on_target";
}

export function CardCommercialRecovery({
  quoteId,
  rows,
  onPropose,
  rollups,
  shownTierIds,
  floorMarginPct,
  targetMarginPct,
  editable,
}: {
  quoteId: string;
  rows: RecoveryChargeRow[];
  /**
   * Hands up the AUTHORITATIVE projection the write produced.
   *
   * Not a hint and not an optimistic guess: the action re-ran the real
   * resolver after committing, so this is the same governed state the next
   * page render will produce, arriving one render earlier.
   */
  /**
   * Apply an election and return the ENGINE's refusal, if it refused.
   *
   * The card no longer writes. It asks for an evaluation, the host shows the
   * governed result, and persistence happens behind that — see
   * `use-recovery-draft`. What used to happen here was persist-then-evaluate,
   * which made the operator wait on a database round trip to find out what
   * their own click had done.
   */
  onPropose: (
    /**
     * One pick, or N for a GROUP ACTION. Always a set, so a group is one
     * evaluation and one save rather than N round trips — and never a
     * type-level election, which is the grain this control exists to keep.
     */
    picks: { chargeKey: string; chargeInstanceId?: string }[],
    mode: string | null,
  ) => Promise<RecoveryProposalFailure | null>;
  /** Every governed tier — the gate evaluates all of them, not only those shown. */
  rollups: readonly QuotePerTierRollup[];
  shownTierIds: readonly string[];
  floorMarginPct: number;
  targetMarginPct: number;
  editable: boolean;
}) {
  /**
   * The pick in flight, held until the ENGINE answers -- not until the write
   * returns.
   *
   * Clearing on the action's return looked right and was measured wrong: the
   * write completed at ~2s and the re-rendered rows arrived at ~4s, so for two
   * seconds the row showed no "saving", no busy state, and still the OLD
   * selection. That is the operator's original complaint exactly, moved later
   * in the timeline rather than removed.
   *
   * So this holds until the incoming rows say something -- either the picked
   * mode is now in force, or the rows changed and said otherwise. It cannot
   * hang waiting for an answer that never comes, because ANY fresh answer
   * clears it.
   */
  const [pending, setPending] = useState<{
    /**
     * The ROWS in flight, by row key — one for a single pick, N for a group.
     *
     * Keyed by row rather than by charge type, or electing one carton's plates
     * would show every same-type row as saving and disable controls the
     * operator never touched.
     */
    keys: Set<string>;
    /** `null` is a RELINQUISHMENT -- see `restore` below. */
    mode: RecoveryMode | null;
  } | null>(null);
  const writeDone = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * WHICH ROW this is.
   *
   * A component charge is its instance; a legacy row is its type, for which the
   * type is the identity. One definition, because a second would let the React
   * key, the busy state and the test id disagree about what a row is.
   */
  const rowKey = (r: RecoveryChargeRow) => r.chargeInstanceId ?? r.chargeKey;

  const present = rows.filter((r) => r.present);

  /**
   * Types carried by more than one component row — the group action's subjects,
   * and the same set that earns a collision owner label.
   *
   * A type with one row gets no group control: "set all" over a set of one is
   * the row's own buttons wearing a different hat.
   */
  const groupable = new Map<string, RecoveryChargeRow[]>();
  for (const r of present) {
    if (!r.chargeInstanceId) continue;
    groupable.set(r.chargeKey, [...(groupable.get(r.chargeKey) ?? []), r]);
  }
  for (const [k, list] of groupable) if (list.length < 2) groupable.delete(k);
  // Rows carrying ONLY a Direct Service contribution. They are not recovery
  // charges — a Direct Service is already its own priced customer line, with
  // no fee for an election to place — so they get no control. They are still
  // shown, because they were shown yesterday as controls advertising amounts
  // like $4,480 and $9,800, and dropping them silently would look like the
  // money went somewhere. Named for what they are instead.
  const serviceOnly = rows.filter((r) => !r.present && r.serviceContext !== null);

  /**
   * Picking elects. The document and the margin cards are the confirmation.
   *
   * `mode: null` RELINQUISHES the election and returns the charge to its
   * inherited legacy resolution. It is a separate act with its own control --
   * clicking the already-selected treatment deliberately does NOT mean it.
   * Electing a treatment and giving up the right to choose one are different
   * commercial statements, and overloading one gesture to mean both would make
   * the second unreachable except by accident.
   */
  function write(subjects: RecoveryChargeRow[], mode: RecoveryMode | null) {
    setError(null);
    writeDone.current = false;
    setPending({ keys: new Set(subjects.map(rowKey)), mode });
    startTransition(async () => {
      // EVALUATED, not written. The result is the governed projection for this
      // election, and the host shows it on both surfaces at once; the write
      // follows behind it. A refusal is the boundary's own words, verbatim.
      // `onPropose` no longer rejects: an engine that never answered comes
      // back as an `unreachable` failure instead. It used to escape here, and
      // the escape left `pending` set — so the row sat on "saving…"
      // indefinitely with nothing on screen saying why.
      const failure = await onPropose(
        subjects.map((r) => ({
          chargeKey: r.chargeKey,
          ...(r.chargeInstanceId ? { chargeInstanceId: r.chargeInstanceId } : {}),
        })),
        mode,
      );
      if (failure) {
        // Both kinds render the same way. They are distinguished so the
        // ROLLBACK can differ, which it does, inside the hook.
        setError(failure.message);
        setPending(null);
        return;
      }
      writeDone.current = true;
    });
  }

  // The engine's answer ends the wait.
  useEffect(() => {
    if (!pending) return;
    // EVERY subject, not the first. A group action is answered when the last
    // of its rows has moved; ending the wait on one would clear "saving" while
    // the rest were still in flight.
    const subjects = rows.filter((r) => pending.keys.has(rowKey(r)));
    const answered = (r: RecoveryChargeRow | undefined) =>
      pending.mode === null
        ? r?.source === "legacy"
        : r?.effectiveMode === pending.mode;
    if (subjects.length > 0 && subjects.every(answered)) {
      setPending(null);
      return;
    }
    const row = subjects[0];
    // A relinquishment is answered by PROVENANCE, not by the selected mode.
    // The inherited placement may well equal the elected one, in which case the
    // dark button does not move and only "elected → inherited" changes. Waiting
    // on the mode there would wait for a change that correctly never comes.

    // Fresh rows that say something ELSE are still an answer -- a charge can
    // come back mixed, or unchanged. Holding out for the picked mode would
    // leave "saving…" on screen forever.
    if (writeDone.current) setPending(null);
  }, [rows, pending]);

  // The gate reads EVERY governed tier. A display choice can never clear a
  // floor breach, so tiers the customer will not see are still evaluated and
  // still shown — dimmed, and labelled.
  const shown = new Set(shownTierIds);
  const cards = rollups.map((t) => ({
    tierId: t.tierId,
    label: t.label,
    pct: t.blendedMarginPct,
    state: marginState(t.blendedMarginPct, floorMarginPct, targetMarginPct),
    shown: shown.size === 0 || shown.has(t.tierId),
  }));
  const blocked = cards.some((c) => c.state === "below_floor");

  return (
    <section className="cv-card cv-card-recovery" data-testid="card-commercial-recovery">
      <div className="cv-card-head">
        <span className="cv-step">1</span>
        <div>
          <div className="cv-card-title">Commercial recovery</div>
          <div className="cv-card-sub">
            Changes sell price and margin. Runs through pricing governance.
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="cv-charge" data-testid="recovery-error"
           style={{ color: "var(--danger, #b3261e)", font: "400 11.5px/1.45 var(--sans)" }}>
          {error}
        </p>
      )}

      {present.length === 0 ? (
        <p className="cv-charge cv-note">
          {/* The empty state has to account for what is rendered BELOW it.
              "This quote carries no governed recoverable charges" sitting
              directly above "Testing / Micros $4,480" reads as a
              contradiction -- both statements are true, and together they
              look like one of them is wrong. The service-only rows only began
              appearing here when they stopped being controls, so this copy
              had never had to coexist with them. */}
          {serviceOnly.length === 0
            ? "This quote carries no governed recoverable charges."
            : "This quote carries no recoverable one-time charges to place. The service line below is already priced to the customer."}
        </p>
      ) : (
        present.map((row) => {
          const key = rowKey(row);
          const busy = pending?.keys.has(key) ?? false;
          const allowed = row.options.filter((o) => o.available).map((o) => MODE_LABEL[o.mode].toLowerCase());
          // The group control rides the FIRST row of its type, so one appears
          // per type rather than one per row — and it names what it will do.
          const group = groupable.get(row.chargeKey);
          const leadsGroup = group !== undefined && rowKey(group[0]) === key;
          return (
            <div
              key={key}
              className="cv-charge"
              data-testid={`charge-${key}`}
              data-unplaced={row.unplaced ? "yes" : undefined}
            >
              <div className="cv-charge-head">
                <span className="cv-charge-label">
                  {row.label}
                  {/* COLLISION ONLY. One Print plates row reads "Print plates";
                      two read "Print plates · Kids' Cough carton". The same
                      rule the customer document follows, so what an operator
                      reads here and what a customer reads there agree.

                      A legacy row never gets one: its owner is the engagement,
                      and its anchor must never be surfaced as a cause. */}
                  {row.ownerLabel ? (
                    <span className="cv-charge-owner"> · {row.ownerLabel}</span>
                  ) : null}
                </span>
                <span className="cv-charge-amt">
                  {/* The ACTIONABLE amount — what this control can move.
                      It used to be the sum of the one-time fee and any Direct
                      Service sharing the same BV-011 destination, which is the
                      right aggregation for accounting and the wrong one for a
                      control: on a production quote this read $12,510 while
                      the election moved $5,600.
                      BV-013 · D5: unknown recovery is unavailable, never $0. */}
                  {row.totalRecovery === null ? "not priced" : usd(row.totalRecovery)}
                </span>
              </div>
              <div className="cv-charge-policy">
                {/* SAYING SO WHILE IT HAPPENS.
                    The write lands in about two seconds -- measured at 2369ms
                    and 1999ms on production. For that whole time the selection
                    did not move, the row's buttons were disabled, and nothing
                    on screen said anything. An operator clicked, saw nothing,
                    clicked again into dead buttons, and reported the control
                    as broken. It was not: every click persisted.
                    A consequential control that takes two silent seconds IS
                    broken from where the operator sits, whatever the database
                    did. */}
                {busy && <span className="cv-charge-saving">saving… </span>}
                policy: {allowed.length ? allowed.join(" / ") : "none available"} · cost governed
                {/* Provenance is a caption, never the selected state. A quote
                    that inherited its treatment still HAS that treatment. */}
                {/* UNPLACED IS SAID, not left blank. A blank reads as "no
                    election yet" on a charge that already has a treatment; this
                    charge has none, and the quote cannot send until it does. */}
                {/* ── WHY THE CONTROLS ARE DEAD, SAID ON THE SURFACE ──────
                    Read before the placement state, because it is prior to it:
                    a charge whose cost is incomplete cannot be placed at all,
                    and "not yet decided" would invite the operator to decide it
                    here rather than to go and finish the cost.

                    Visible text, not only the buttons' `title`. Every option is
                    refused in this state, so the operator meets a row of dead
                    controls — and hover-to-discover is a navigation pattern,
                    not a presentation one. */}
                {row.economics === "none"
                  ? " · no cost entered yet — enter it on Costs"
                  : row.economics === "partial"
                    ? ` · no cost at ${row.missingTierLabels.join(", ")} — complete it on Costs`
                    : row.unplaced
                  ? " · not yet decided — required before sending"
                  : row.mixed
                    ? " · placed more than one way"
                    : row.effectiveMode === null
                      ? ""
                      : row.source === "legacy"
                        ? " · inherited"
                        : " · elected"}
              </div>
              {row.serviceContext !== null && (
                <div className="cv-charge-service">
                  plus{" "}
                  {row.serviceContext.recovery === null
                    ? "an unpriced"
                    : usd(row.serviceContext.recovery)}{" "}
                  billed as a service line — already priced to the customer, not
                  a one-time charge, and not moved by this control
                </div>
              )}
              <div className="cv-opts">
                {row.options.map((opt) => {
                  // The treatment IN FORCE, whatever put it there. Reading this
                  // off `electedMode` meant a quote with no election row showed
                  // every option unselected while unambiguously carrying one.
                  const active = row.effectiveMode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      aria-pressed={active}
                      // Pattern 47(e) permits `disabled` on BUTTONS -- the
                      // double-click protection is real and focus stability is
                      // not a button concern. 47(f) requires that a disabled
                      // control communicate WHY, which is what `aria-busy` and
                      // the title below now do.
                      aria-busy={busy || undefined}
                      data-busy={busy ? "yes" : undefined}
                      disabled={!editable || busy || !opt.available}
                      title={
                        !editable
                          ? "This quote is no longer a draft; recovery is frozen."
                          : busy
                            ? "Saving this change…"
                            : (opt.reason ?? undefined)
                      }
                      data-testid={`recovery-${key}-${opt.mode}`}
                      data-available={opt.available ? "yes" : "no"}
                      onClick={() => write([row], opt.mode)}
                    >
                      {MODE_LABEL[opt.mode]}
                    </button>
                  );
                })}
              </div>

              {/* Only where there is something to give up. An inherited charge
                  has no election to restore, so the control would be a no-op
                  dressed as an action.

                  A Nexus extension: the registered authority shows the three
                  segments and no fourth control, because in the reference every
                  charge is elected. Nexus carries 86 legacy-placed quotes whose
                  treatment was never chosen, so relinquishing has a meaning
                  there that the reference had no need to express. Restrained on
                  purpose -- a text button under the segments, not a fourth
                  segment competing with the treatments. */}
              {/* An UNPLACED charge has no election to give up, so the control
                  would be an action with nothing to act on. */}
              {row.source === "election" && !row.unplaced && editable && (
                <button
                  type="button"
                  className="cv-restore"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  title={
                    busy
                      ? "Saving this change…"
                      : "Give up this election and return the charge to the treatment it inherits."
                  }
                  data-testid={`recovery-${key}-restore`}
                  onClick={() => write([row], null)}
                >
                  Restore inherited treatment
                </button>
              )}

              {/* ── THE GROUP ACTION ──────────────────────────────────────
                  Grain per instance, ergonomics per group.

                  Without it a uniform quote costs one click per charge, and the
                  operator's shortcut becomes absorbing things to make the rail
                  quiet — a margin event chosen for interface reasons.

                  It is N GOVERNED WRITES, one per instance, composed into one
                  proposal. It stores nothing at type level, which is why using
                  it cannot reintroduce the grain it replaces. */}
              {leadsGroup && editable && (
                <div className="cv-charge-group">
                  <span className="cv-charge-group-label">
                    All {group!.length} {row.label.toLowerCase()} charges:
                  </span>
                  {row.options
                    .filter((o) => o.available)
                    .map((opt) => (
                      <button
                        key={opt.mode}
                        type="button"
                        className="cv-charge-group-btn"
                        disabled={busy}
                        aria-busy={busy || undefined}
                        title={
                          busy
                            ? "Saving this change…"
                            : `Set all ${group!.length} ${row.label.toLowerCase()} charges to ${MODE_LABEL[opt.mode].toLowerCase()}. Each is written individually and can be changed on its own afterwards.`
                        }
                        data-testid={`recovery-group-${row.chargeKey}-${opt.mode}`}
                        onClick={() => write(group!, opt.mode)}
                      >
                        {MODE_LABEL[opt.mode]}
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Charges whose ONLY contribution is a Direct Service.
          There is no fee to place, so there is no election — the control that
          used to sit here advertised $4,480 on four production quotes and
          $9,800 on another, and could move none of it. Shown, not silently
          dropped: the amount was on this card yesterday, and removing it
          without a word would read as money going missing rather than as a
          line being correctly reclassified. */}
      {serviceOnly.map((row) => (
        <div
          key={row.chargeKey}
          className="cv-charge cv-charge-service-only"
          data-testid={`charge-service-${row.chargeKey}`}
        >
          <div className="cv-charge-head">
            <span className="cv-charge-label">{row.label}</span>
            <span className="cv-charge-amt">
              {row.serviceContext?.recovery === null
                ? "not priced"
                : usd(row.serviceContext?.recovery ?? 0)}
            </span>
          </div>
          <div className="cv-charge-policy">
            billed as a service line · already priced to the customer · not a
            one-time recovery charge
          </div>
        </div>
      ))}

      <div className="cv-margin-block">
        <div className="cv-eyebrow">
          Margin after recovery · all governed tiers · floor {pct(floorMarginPct)} · target{" "}
          {pct(targetMarginPct)}
        </div>
        <div className="cv-margin-cards">
          {cards.map((c) => (
            <div key={c.tierId} className="cv-margin" data-state={c.state}
                 data-shown={c.shown ? "yes" : "no"}
                 data-testid={`margin-${c.tierId}`}>
              <div className="cv-margin-label">
                {c.label}
                {c.shown ? "" : " · not shown"}
              </div>
              <div className="cv-margin-pct">{c.pct === null ? "—" : pct(c.pct)}</div>
              <div className="cv-margin-state">{c.state.replace("_", " ")}</div>
            </div>
          ))}
        </div>
        <div className="cv-gov-note" data-blocked={blocked ? "yes" : "no"}>
          {blocked
            ? "A governed tier is below the margin floor. Pricing approval is required before this quote can be frozen and sent."
            : "Every governed tier is at or above the margin floor."}
        </div>
      </div>
    </section>
  );
}

"use client";

// Phase 3 · CellAction — the affordance that turns a pressed cell into a
// staged change.
//
// Canonical source: `app/r12/pricing-page.jsx` → `CellAction` + `DirectPrice`,
// with the `.r11-cellaction` / `.r12-direct` vocabulary from those stylesheets.
//
// ── INTERACTION ONLY ──────────────────────────────────────────────────────
//
// Four responsibilities, and nothing else: identify the canonical cell, invoke
// the staging model, present staged state, route to existing authority.
//
// It does NOT decide lift eligibility, lift recommendation, override
// eligibility, pricing arithmetic, commercial verdicts, or who did anything.
// Every one of those is already owned:
//
//   eligibility        `cell.lift_offer_pct`   ← `liftToClear`, the solver
//   blocked            `cell.lift_blocked`
//   an override exists `cell.override_applied`
//   a lift is applied  `cell.lift_applied_pct`
//   the floor          `state.policy.floor_margin_pct`
//   which state        `cell.action_state`
//
// The last is the important one. The prototype selects its four bodies with a
// chain of truthiness checks whose ORDER decides the answer; two of its
// conditions co-occur routinely and one combination is a contradiction the
// chain silently absorbs. `CellActionState` is exclusive by construction, so
// the switch below cannot pick differently by reading flags in another order —
// and when the data contradicts itself it says so instead of choosing.
//
// ── TWO THINGS DELIBERATELY ABSENT ────────────────────────────────────────
//
// **Who set the override, and when.** The canonical rejects a blocked lift by
// naming a person and a date. `assembly_leaf_overrides` carries
// `assembly_leaf_id · tier_id · sell_price_override · created_at · updated_at`
// — no actor — and `created_at` is not the same claim as "Maya set this". That
// is A-2. Rejecting is in scope because `lift_blocked` is authoritative;
// naming who is not, and inventing an actor to fill the sentence would be
// worse than the sentence being shorter.
//
// **Actor / when / note on the staged lift.** The prototype attaches them to
// the change itself. They belong to the audit row written at Apply, which is
// OD-012. A `StagedChange` here is `{kind, key, pct}` — session state, and
// enriching it would put authorship somewhere no audit log will ever read.

import { useState } from "react";
import type { Cell } from "@/lib/pricing-classifier";
import type { CellRef } from "@/lib/pricing-staging";
import { usePricingStaging } from "./pricing-staging-context";

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Set a cell's price outright, staged like everything else.
 *
 * **Seeded from `sell_unit`, and that is the override value when one exists.**
 * Not a coincidence to re-check later: when a cell carries an override the
 * engine makes the override node the cell root outright
 * (`costing.ts:2355-2367` — `kind: "override"`, `value: cellOverride`, with the
 * computed chain demoted to `superseded`), and `requiredSellPerUnit` is that
 * root's value. So `sell_unit === the override` by construction whenever
 * `override_applied` is true; they cannot drift apart, because there is only
 * one number.
 *
 * With no override, `sell_unit` is the computed price — the right thing to
 * start from when someone is about to replace it.
 */
function DirectPrice({
  label,
  cell,
  onSet,
}: {
  label: string;
  cell: Cell;
  onSet: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(
    cell.sell_unit === null ? "" : cell.sell_unit.toFixed(2),
  );

  if (!open) {
    return (
      <button
        className="btn ghost sm"
        type="button"
        style={{ marginLeft: 8 }}
        onClick={() => setOpen(true)}
      >
        Set price directly…
      </button>
    );
  }

  const parsed = Number.parseFloat(draft);
  // Not a commercial rule — a parse guard. Whether a price is ACCEPTABLE is the
  // engine's question once it is staged; whether the operator typed a number is
  // this input's.
  const usable = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="r12-direct">
      <label className="lbl">Price for {label}</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        inputMode="decimal"
        aria-label={`Direct price for ${label}`}
      />
      <button
        className="btn sm"
        type="button"
        disabled={!usable}
        onClick={() => {
          onSet(parsed);
          setOpen(false);
        }}
      >
        Set
      </button>
      <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <span className="warn">Replaces the computed chain for this cell.</span>
    </div>
  );
}

export interface CellActionProps {
  cell: Cell;
  /**
   * The canonical address, resolved by the caller.
   *
   * Null when either half could not be resolved, and the panel then refuses to
   * stage rather than addressing a guess. Same discipline as the staging bar's
   * labeller: a component that resolves identity is one that can resolve it
   * wrongly, and here the cost of being wrong is a price change on the wrong
   * commercial line.
   */
  cellRef: CellRef | null;
  /** Firm floor, for the copy. Never compared against. */
  floorPct: number;
  /** "GLW-50 · T2" — display identity, built by the caller. */
  label: string;
  onClose: () => void;
}

export function CellAction({
  cell,
  cellRef,
  floorPct,
  label,
  onClose,
}: CellActionProps) {
  const { stageLift, stageOverride, changes } = usePricingStaging();

  const key = cellRef ? `${cellRef.quoteLeafId}::${cellRef.tierId}` : null;
  const staged = key !== null && changes.some((c) => c.kind !== "adj" && c.key === key);

  function body() {
    if (cellRef === null) {
      // Fail closed, and say which half is missing is more than we know — only
      // that the address did not resolve. Staging against a guessed identity
      // would change a price on some other commercial line.
      return (
        <div className="body blocked">
          <p>
            <strong>This cell cannot be addressed.</strong> Its canonical
            attachment did not resolve, so no change can be staged against it
            without risking a different line. Nothing has been altered.
          </p>
        </div>
      );
    }

    switch (cell.action_state) {
      case "conflict":
        return (
          <div className="body blocked">
            <p>
              <strong>{label} is in a contradictory state.</strong>{" "}
              {cell.action_conflict}
            </p>
          </div>
        );

      case "blocked_by_override":
        return (
          <div className="body blocked">
            <p>
              <strong>{label} has a price set directly.</strong> A lift would
              silently overturn a deliberate decision, so it is rejected rather
              than applied. Remove the direct price first.
            </p>
            {/*
              The canonical names who set it and when. A-2: the override table
              carries no actor, and `created_at` is not that claim. Rejecting is
              authoritative — `lift_blocked` decided it — so the refusal stands;
              only the attribution is missing, and it is left missing rather
              than invented.
            */}
            <button
              className="btn sm"
              type="button"
              onClick={() => stageOverride(cellRef, null)}
            >
              Remove direct price on {label}
            </button>
          </div>
        );

      case "direct_price_set":
        return (
          <div className="body ok">
            <p>
              <strong>
                {label} is set directly to{" "}
                {cell.sell_unit === null ? "—" : fmtUsd(cell.sell_unit)}
              </strong>
              {staged ? " (staged)" : ""} — this replaces the computed chain
              rather than layering over it.
            </p>
            <p className="undo-note">
              Removing it is <strong>not</strong> the same undo as removing a
              lift. A lift peels off and the cell returns to its computed price.
              Remove this and the cell returns to{" "}
              <strong>whatever the chain computes now</strong> — which may not be
              what it showed before the price was set.
            </p>
            <button
              className="btn sm"
              type="button"
              onClick={() => stageOverride(cellRef, null)}
            >
              Remove direct price on {label}
            </button>
          </div>
        );

      case "lift_applied":
        return (
          <div className="body ok">
            <p>
              <strong>
                {label} is lifted{" "}
                {cell.lift_applied_pct === null
                  ? ""
                  : fmtPct(cell.lift_applied_pct)}
              </strong>
              {staged ? " (staged)" : ""} — independent of the price adjustment.
              Removing it leaves that untouched, and the cell returns to its
              computed price.
            </p>
            {/*
              The offer survives alongside an applied lift when the cell is
              still short. Shown because hiding it removes the only way to see
              that what was applied was not enough.
            */}
            {cell.lift_offer_pct !== null && (
              <p>
                Still below the {fmtPct(floorPct)} floor. A further{" "}
                <strong>{fmtPct(cell.lift_offer_pct)}</strong> would clear it.
              </p>
            )}
            <button
              className="btn sm"
              type="button"
              onClick={() => stageLift(cellRef, null)}
            >
              Remove lift on {label}
            </button>
            <DirectPrice
              label={label}
              cell={cell}
              onSet={(v) => stageOverride(cellRef, v)}
            />
          </div>
        );

      case "lift_available":
        return (
          <div className="body">
            <p>
              <strong>
                {label} is at{" "}
                {cell.margin_pct === null ? "—" : fmtPct(cell.margin_pct)}
              </strong>
              , below the {fmtPct(floorPct)} firm floor. A{" "}
              <strong>{fmtPct(cell.lift_offer_pct as number)}</strong> lift on{" "}
              {label} alone clears it. No other cell is affected.
            </p>
            {/*
              The percentage is the solver's — `liftToClear(sell, cost,
              threshold)`. This hands it back unchanged; it does not round it,
              buffer it, or recompute it against a threshold of its own.
            */}
            <button
              className="btn primary sm"
              type="button"
              onClick={() => stageLift(cellRef, cell.lift_offer_pct as number)}
            >
              Lift {label} to floor
            </button>
            <DirectPrice
              label={label}
              cell={cell}
              onSet={(v) => stageOverride(cellRef, v)}
            />
          </div>
        );

      case "none":
        return (
          <div className="body">
            <p>
              <strong>{label} needs no correction.</strong> Its price can still
              be set directly if the negotiation calls for it.
            </p>
            <DirectPrice
              label={label}
              cell={cell}
              onSet={(v) => stageOverride(cellRef, v)}
            />
          </div>
        );
    }
  }

  return (
    <div className="r11-cellaction">
      <div className="head">
        <span className="who">{label}</span>
        <span className="meta">
          {cell.sku_name} · {cell.tier_qty.toLocaleString()} units · margin{" "}
          {cell.margin_pct === null ? "—" : fmtPct(cell.margin_pct)}
        </span>
        <button className="btn ghost sm" type="button" onClick={onClose}>
          ✕
        </button>
      </div>
      {body()}
    </div>
  );
}

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
// **Actor / when / note on a STAGED change.** The prototype attaches them to
// the change itself. They belong to the audit row, and a staged change has no
// audit row — nothing has happened yet. A `StagedChange` here is
// `{kind, key, pct}`: session state, and enriching it would put authorship
// somewhere no audit log will ever read.
//
// ── WHAT A-2 ADDED, AND WHAT IT DID NOT ───────────────────────────────────
//
// Who set a PERSISTED direct price, and who applied a persisted lift, are now
// named — read from the same provenance overlay the trace reads, through the
// same resolver. Not a second lookup: this component asks a shared map for one
// key and renders the sentence.
//
// It still names nobody when nothing recorded one. `assembly_leaf_overrides`
// carries no actor column, so attribution comes from the audit row, and a cell
// priced before that row existed has none. The sentence gets shorter rather
// than getting a plausible name — which was the rule before A-2 and is the
// same rule after it.

import { useState } from "react";
import type { Cell } from "@/lib/pricing-classifier";
import type { CellRef } from "@/lib/pricing-staging";
import { usePricingStaging } from "./pricing-staging-context";
import { useOriginFor } from "./pricing-provenance-context";
import { unitPrice } from "@/lib/money-display";

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Governed money display — see `src/lib/money-display.ts`. */
const fmtUsd = unitPrice;

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
}

/**
 * Who did this, and when — one sentence, one component.
 *
 * Both branches that can show attribution render THIS, so a direct price and an
 * applied lift cannot end up phrased differently for no reason. Renders nothing
 * when there is nothing recorded: the absence of a name is not a blank to fill.
 */
function Attribution({
  origin,
  verb,
}: {
  origin: { actor: string | null; when: string | null } | null;
  verb: string;
}) {
  if (!origin?.actor) return null;
  const when = origin.when
    ? new Date(origin.when).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <p className="attribution">
      {verb} by <strong>{origin.actor}</strong>
      {when ? ` on ${when}` : ""}.
    </p>
  );
}

export function CellAction({
  cell,
  cellRef,
  floorPct,
  label,
}: CellActionProps) {
  const { stageLift, stageOverride, changes } = usePricingStaging();

  const key = cellRef ? `${cellRef.quoteLeafId}::${cellRef.tierId}` : null;
  const staged = key !== null && changes.some((c) => c.kind !== "adj" && c.key === key);

  // A-2 · attribution for the two PERSISTED acts this panel can be looking at.
  //
  // Addressed by NODE key, which is `{engineSkuId}/{tierUuid}/...` — and both
  // halves come from somewhere specific for a reason:
  //
  //   · `cell.sku_id` IS the engine's SKU id (the classifier builds it from
  //     `skuRollups[].skuId`), which is what the graph keys on. The staging
  //     key's canonical half is a DIFFERENT identity; asking with it would
  //     resolve nothing while looking like it had.
  //   · `cell.tier_id` is the classifier's NUMERIC tier index, not the UUID the
  //     graph uses, so the tier comes from the resolved `cellRef`.
  //
  // Null while the overlay loads, and null renders nothing rather than a
  // placeholder that a name would later replace.
  const cellNodeBase = cellRef ? `${cell.sku_id}/${cellRef.tierId}` : null;
  const overrideOrigin = useOriginFor(
    cellNodeBase && cell.override_applied ? `${cellNodeBase}/quoted` : null,
  );
  const liftOrigin = useOriginFor(
    cellNodeBase && cell.lift_applied_pct !== null
      ? `${cellNodeBase}/lift/pct`
      : null,
  );

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
            <Attribution origin={overrideOrigin} verb="Set" />
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
            {/*
              PATTERN 39 · a narrow Nexus extension over R12.

              The canonical `c.direct` branch offers removal only, and that is
              coherent for the prototype: its overrides are always staged, so
              changing one means re-staging it. Ours can be PERSISTED, and a
              persisted one had no way to be changed at all — an operator could
              remove a direct price but not amend it, which would have taken two
              Apply cycles to do what is plainly one act.

              No new authority and no second editing path: the same
              `DirectPrice` control the sibling states already use, seeded from
              the classifier's price, staged through the same `stageOverride`,
              and evaluated by the engine. It produces ONE replacement change
              rather than a removal followed by an addition, because
              `working.overrides` is a set and writing a key that already holds
              a value replaces it.
            */}
            <DirectPrice
              label={label}
              cell={cell}
              onSet={(v) => stageOverride(cellRef, v)}
            />
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
            <Attribution origin={liftOrigin} verb="Applied" />
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

  // THE HEAD IS GONE, AND SO IS `onClose`.
  //
  // This used to be a full-width block spliced into the grid, so it needed its
  // own identity line and its own dismiss. It now renders inside the cell
  // drawer, which states identity once at the top and owns the close — a
  // second copy of both would be two things that can disagree about which cell
  // is open.
  //
  // What is left is what this component was always for: the ACTIONS, and the
  // policy sentence that says which ones apply.
  return <div className="r11-cellaction in-drawer">{body()}</div>;
}

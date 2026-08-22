"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDirectServiceProduction } from "@/app/actions/direct-service-production";
import {
  DIRECT_SERVICE_PRODUCTION_LABEL,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";
import {
  isPerLineDestination,
  SERVICE_IDENTITY_DESTINATION,
} from "@/lib/netsuite/bv011-destinations";
import { useCostingStore } from "@/components/costing-store-provider";
import { selectActiveTierId } from "@/lib/costing-store";
import { selectOtherServiceItems } from "@/lib/costing-store";
import type { OtherServiceSelection } from "@/lib/commercial-projection";
import { OtherServiceItemPicker } from "@/components/costs/other-service-item-picker";
// The canonical percent formatter, shared rather than restated — the node
// value is a decimal fraction and converting it in a second place is how a
// 30% rate renders as 0.3%.
import { fmtPct1 } from "./production-drilldown";

/**
 * A Direct Service's Production economics — the other branch of the Stage 3 A
 * ownership XOR.
 *
 * ── ONE TABLE VOCABULARY, TWO OWNERS ──────────────────────────────────────
 *
 * This renders in the SAME `.r6-dt.prod` grammar as the Item Group Production
 * table, with the same columns and the same cell behaviour. Ownership differs;
 * visual meaning does not.
 *
 * The first cut of this was a bespoke card holding only tier fields. It was
 * functionally correct and wrong as design: it made an operator learn a second
 * form language for economics that read identically everywhere else, and it
 * hid the category and markup that make a production cost legible. A Direct
 * Service normally has ONE economic row where an Item Group has several — that
 * is a difference in row count, not a reason for a different UI.
 *
 * ── THE SOURCE COLUMN IS NOT A VENDOR SEARCH, AND THAT IS DELIBERATE ──────
 *
 * Packaging's equivalent column is a HubSpot vendor picker because packaging
 * lines carry `pricing_vendor_hubspot_company_id` and a real per-line pricing
 * source. **Production carries neither.** `assembly_production_inputs` has no
 * supplier column, and the Item Group table's own Supplier cell renders an
 * em-dash for every row for exactly that reason.
 *
 * Copying the vendor control here would have produced a visual match to a
 * capability that does not exist — a control that looks like it sources a
 * price and sources nothing. So this column states the authority Production
 * actually has: a firm-wide rate, named.
 *
 * ── MARKUP IS READ, NEVER RESOLVED HERE ───────────────────────────────────
 *
 * Passed in from the same `useProductionMarkup` read the Item Group table
 * uses, which walks the engine's own resolution rather than reimplementing the
 * ladder. That is what makes BV-013 automatic: when the Production category
 * default becomes 40%, this cell shows 40% without being told, because it was
 * never carrying its own copy of the number.
 *
 * It also inherits that read's fail-closed posture — if tiers ever disagree on
 * the rate it renders an em-dash rather than electing one tier's rate to speak
 * for the section.
 */

export type DirectServiceProductionRow = {
  quoteLeafId: string;
  name: string;
  serviceIdentity: DirectServiceIdentity;
  /** tierId → current amount for THIS service's one governed column. */
  amountsByTier: Record<string, string | null>;
};

function fmtCurr2(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function TierCell({
  quoteLeafId,
  tierId,
  value,
  disabled,
  isActive,
}: {
  quoteLeafId: string;
  tierId: string;
  value: string | null;
  disabled: boolean;
  /** Same signal Packaging shades on: this is the tier column in focus. */
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    const fd = new FormData();
    fd.set("quoteLeafId", quoteLeafId);
    fd.set("tierId", tierId);
    // Deliberately NO column name. The service identity decides where this
    // lands, server-side — so a client cannot aim a value at Bulk Raw.
    fd.set("amount", next);
    setError(null);
    start(async () => {
      const r = await updateDirectServiceProduction(fd);
      if (!r.ok) {
        setError(r.error.message);
        setDraft(value ?? "");
        return;
      }
      router.refresh();
    });
  }

  const isEmpty = draft.trim() === "";

  return (
    /*
      PACKAGING IS THE REFERENCE, LITERALLY. This was `<div className="num cell">`
      wrapping an unstyled input, and `.r6-dt-row .cell` has no rule in the
      canonical stylesheet — which produced all three reported defects at once:
      browser-default typography instead of mono 12.5px, no editable-cell blue,
      and an input at its default ~20ch intrinsic width blowing an 80px grid
      track out across the neighbouring tier column (a grid item's `min-width`
      is `auto`, so the track cannot shrink below its content).

      `cell-num` is the class Packaging's tier cell uses, so it inherits that
      rule rather than approximating it, and the inner-input style is the same
      declaration set. The geometry contract is the shared one: the input is
      `width: 100%` OF THE CELL, so it can never exceed its column.
    */
    <span
      className={`cell-num ${isEmpty ? "empty" : ""}`}
      style={isActive ? { background: "var(--accent-soft)" } : undefined}
    >
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="—"
        style={{
          background: "transparent",
          border: "none",
          font: "inherit",
          color: "inherit",
          width: "100%",
          textAlign: "right",
          padding: 0,
        }}
        /* Pattern 47(e): never `pending` on an input — a disabled element
           drops focus mid-save. Blur/Enter commit per the LegDateInput
           precedent, because per-keystroke saving a currency field writes
           partial numbers. */
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label="Service amount"
      />
      {pending && <span className="sub">saving…</span>}
      {error && (
        <span className="sub" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
    </span>
  );
}

export function DirectServiceProduction({
  services,
  tiers,
  editable,
  categoryLabel,
  markupPct,
}: {
  services: DirectServiceProductionRow[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  editable: boolean;
  /** The governed Production pricing category, READ from the engine. */
  categoryLabel: string;
  /** The firm-wide Production rate, READ. Null renders an em-dash. */
  markupPct: number | null;
}) {
  // Read from the STORE, not a prop (Pattern 41): an RSC snapshot prop is
  // frozen at render and would not reflect a save until a full page round
  // trip, so a just-chosen item would appear to vanish.
  const selections = useCostingStore(selectOtherServiceItems);
  // The same store read Packaging's tier cell uses, so both sections shade the
  // same column rather than each deciding what "active" means.
  const activeTierId = useCostingStore(selectActiveTierId);
  const selectionByLeaf = new Map<string, { code: string; internalId: string }>(
    selections
      .filter((x: OtherServiceSelection) => x.quoteLeafId !== null)
      .map(
        (x: OtherServiceSelection) =>
          [
            x.quoteLeafId as string,
            { code: x.netsuiteItemCode, internalId: x.netsuiteInternalId },
          ] as [string, { code: string; internalId: string }],
      ),
  );

  if (services.length === 0) return null;

  return (
    <>
      {services.map((svc) => {
        const tierSum = tiers.reduce<number | null>((acc, t) => {
          const v = svc.amountsByTier[t.id];
          if (v === null || v === undefined || v === "") return acc;
          const n = Number(v);
          if (!Number.isFinite(n)) return acc;
          return (acc ?? 0) + n;
        }, null);

        return (
          <div key={svc.quoteLeafId} style={{ marginBottom: "18px" }}>
            {/* Mirrors the Item Group banner above it — same shape, different
                badge and different sentence, because the ownership genuinely
                differs and the banner is where that belongs. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "10px",
                padding: "10px 14px",
                background: "oklch(from var(--ink-3) l c h / 0.05)",
                border: "1px solid var(--rule)",
                borderRadius: "8px",
                fontSize: "13px",
              }}
            >
              <span className="r6-badge">Direct service</span>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                {svc.name}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--ink-3)",
                }}
              >
                Sold on its own line.
              </span>
            </div>

            <div
              className="r6-dt prod"
              style={{ ["--cols" as string]: tiers.length } as React.CSSProperties}
            >
              <div className="r6-dt-head">
                <span>Service</span>
                <span>Category</span>
                <span>Source</span>
                <span>Kind</span>
                <span className="num">Markup</span>
                {tiers.map((t) => (
                  <span key={t.id} className="num">
                    {t.label}
                    <br />
                    <span
                      style={{
                        fontSize: "9px",
                        letterSpacing: "0.04em",
                        opacity: 0.7,
                      }}
                    >
                      {t.qty !== null ? t.qty.toLocaleString() : "—"}
                    </span>
                  </span>
                ))}
                <span></span>
              </div>

              <div className="r6-dt-row">
                <div className="name">
                  {/* The ONE governed input, from the identity. There is no
                      code path here that renders a second row. */}
                  <span className="lab">
                    {DIRECT_SERVICE_PRODUCTION_LABEL[svc.serviceIdentity]}
                  </span>
                  <span className="sub">
                    tier total · allocated across quoted units
                  </span>
                  {/*
                    PER-LINE NetSuite item, for the destinations Accounting
                    settled as operator-chosen in Case 0.

                    Gated on the governed predicate, never on an identity
                    literal: `isPerLineDestination` is the single switch that
                    also drives freeze, readiness and provenance, so a control
                    keyed on anything else could offer a selection the push
                    would not require, or withhold one it does.

                    Today that means Other Service and Testing. Dies, Samples,
                    Cartons and Print Plates are deliberately NOT here — they
                    cannot originate a quote line at all, so a selector for
                    them would be a control over nothing.
                  */}
                  {isPerLineDestination(
                    SERVICE_IDENTITY_DESTINATION[svc.serviceIdentity],
                  ) && (
                    <OtherServiceItemPicker
                      quoteLeafId={svc.quoteLeafId}
                      selected={selectionByLeaf.get(svc.quoteLeafId) ?? null}
                      disabled={!editable}
                    />
                  )}
                </div>
                <div className="cat">{categoryLabel}</div>
                {/* Production has no per-line pricing source. Named rather
                    than em-dashed, because an em-dash here reads as "not set
                    yet" when the truthful answer is "this section is priced
                    firm-wide". */}
                <div className="sup">firm rate</div>
                <div>
                  <span className="r6-badge">tier total</span>
                </div>
                <div className="num">
                  <span className="markup">
                    {markupPct === null ? "—" : fmtPct1(markupPct)}
                  </span>
                </div>
                {tiers.map((t) => (
                  <TierCell
                    key={t.id}
                    quoteLeafId={svc.quoteLeafId}
                    tierId={t.id}
                    value={svc.amountsByTier[t.id] ?? null}
                    disabled={!editable}
                    isActive={activeTierId === t.id}
                  />
                ))}
                <div className="actions">
                  <span>···</span>
                </div>
              </div>

              <div className="r6-dt-foot">
                <span className="total-lab">Total — service</span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                {tiers.map((t) => {
                  const v = svc.amountsByTier[t.id];
                  const n = v === null || v === undefined || v === "" ? null : Number(v);
                  return (
                    <span
                      key={t.id}
                      className={`num ${n === null || !Number.isFinite(n) ? "empty" : ""}`}
                    >
                      {n === null || !Number.isFinite(n) ? "—" : fmtCurr2(n)}
                    </span>
                  );
                })}
                <span></span>
              </div>
            </div>
            {tierSum === null && (
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--ink-4)",
                  marginTop: "4px",
                }}
              >
                No amount entered yet — this service contributes nothing to the
                quote until it is priced.
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

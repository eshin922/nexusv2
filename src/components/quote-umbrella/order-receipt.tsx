"use client";

// Slice 12 Step 8c-4 — Order receipt renderer.
// Pattern 30 port of R9 canonical OrderReceipt
// (docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:216-333).
//
// R9.1-1 design intent: ONE LAYOUT, THREE STATES (pending / failed /
// record). Every element holds its position across the three states;
// only the header stamp + status ledger change. That constancy is
// what makes the tab a receipt PMs read and sign, not a ceremony
// they perform. See docs/r9-designer-notes.md §R9.1-1.
//
// Post-8c-4:
//   - so_flags: real derivation (below_floor from tier margin status,
//     unmatched from netsuite_customer_map). Dev switcher fixtures
//     still available for CB walks.
//   - Failed state: single failure shape. The `failed_at` two-way
//     discriminator (item_group vs so_create) DROPPED — flat-lines
//     have no Item Group creation step (Probe 5/6 closed the
//     grouped-SO REST path). All failures surface through the SO
//     create call; the failed-tab renders the persisted
//     netsuite_so_pushes.error_detail verbatim.
//     If the grouped path RE-OPENS via the $0.00 item-price
//     placeholder route (Probe 7 findings; blocked on Vu's catalog
//     update), the discriminator returns — a new failure surface
//     appears for Item Group create rejection AND for SO PATCH
//     rejection on the auto-expanded member rate step. The prop
//     signature will grow back; the split-banner branches too. This
//     is NOT an oversight — Item Group failure copy is intentionally
//     absent under the flat-lines payload only.
//   - Record state: soId + soCreatedAt sync-populated from quote row
//     mirrors (netsuite_so_id / netsuite_so_tranid / netsuite_pushed_at,
//     freeze-tx step 9). Nullable prop shape KEPT so a hypothetical
//     future async grouped-SO path can slot in without touching the
//     receiver.
//
// Pure renderer. No local state. All axes driven by parent (TabSalesOrder).

import type { ReactNode } from "react";

import type { PlannedRow } from "@/lib/netsuite/planned-sales-order";

/**
 * W1 - `awaiting` and `reconcile` are distinct states, not shades of `failed`.
 *
 * They reuse the failed variant's LAYOUT (no surface redesign) and must not
 * reuse its copy: "the order did not reach NetSuite" is false for both. The
 * mapping from push status is total and lives in
 * `@/lib/netsuite/receipt-variant`.
 */
export type ReceiptState = "pending" | "awaiting" | "reconcile" | "failed" | "record";

export type OrderReceiptFlag = {
  level: "warn" | "bad";
  label: string;
  detail: string;
};

export type OrderReceiptLine = {
  id: string;
  code: string;
  name: string;
  pack: string | null;
  qty: number;
  unit: number;
};

/**
 * WHY THE RECEIPT NO LONGER BUILDS ITS OWN LINES.
 *
 * It used to render `view.skus` at `carriedTier.qty` -- every SKU at the tier
 * quantity. For a quote with no Item Group that is right by coincidence, and
 * for O3 it was wrong on three of five lines: NetSuite expands a group member
 * to `group quantity x member definition quantity`, so a Bottle at 2 per set
 * bills 2,400 against a 1,200-unit order. The receipt said 1,200 for all five,
 * and nothing on the screen was false enough to notice.
 *
 * The fix is not better arithmetic here. It is that this component does no
 * arithmetic at all: `buildPlannedSalesOrder` is the ONE producer of the
 * order's structure, the push sends what it returns, and the receipt renders
 * the same rows. There is no second implementation to drift.
 */
export type OrderReceiptStructure =
  | {
      kind: "planned";
      /** Verbatim from `buildPlannedSalesOrder`. Rendered, never recomputed. */
      rows: readonly PlannedRow[];
    }
  | {
      /**
       * Readiness refused, so there IS no order structure yet.
       *
       * The receipt shows the refusal and NOTHING ELSE. A plausible-looking
       * line set beside a blocker reads as "this is what will be sent once you
       * clear it", and it would be a different order from the one that
       * eventually goes -- which is the failure this whole change removes.
       */
      kind: "unavailable";
      reason: string;
    };

export type OrderReceiptOneTime = {
  id: string;
  label: string;
  sub: string;
  amount: number;
};

export type OrderReceiptProps = {
  state: ReceiptState;
  tierLabel: string;
  tierQty: number;
  customerName: string;
  /** DB quote row's `quote_number` (PM-facing, always populated
   * once quote is sent/accepted). */
  quoteNumber: string | null;
  quoteVersion: number;
  /** Timestamp the acceptance was recorded (DB quote row's
   * accepted_at). Rendered as the "against DPS-N v{N} · accepted
   * DATE" sub-line. */
  acceptedAt: Date | null;
  /** SO id from NetSuite (display id if present, internal id
   * otherwise). Nullable — populated in record state from the quote
   * row mirror (netsuite_so_tranid ?? netsuite_so_id). Nullable
   * shape preserved so a hypothetical future async grouped-SO path
   * can slot in without touching this component. */
  soId: string | null;
  /** SO created timestamp — from quote row's netsuite_pushed_at
   * (freeze-tx step 9). Same nullable-tolerance rationale as soId. */
  soCreatedAt: Date | null;
  /** NetSuite account resolution from preflight (customer-map
   * lookup). `matched=false` = the HubSpot company has no
   * netsuite_customer_map row; the unmatched flag in so_flags
   * carries the actionable copy. */
  netsuiteCustomer: {
    id: string;
    name: string;
    matched: boolean;
    matchedOn: string | null;
  };
  /** Shipping destination line. NetSuite resolves the actual ship-
   * to from the customer record's default shipping address at SO
   * create time (not on our create payload). We surface a compact
   * reference (customer name + "default address on file in
   * NetSuite") matching how Aisha reads live SOs. Per-quote
   * override lands v1.1+ if needed. */
  shipTo: string;
  /** Firm-settings commercial defaults, snapshotted on quote row
   * per DEC-7. Sent quotes always have these populated. */
  terms: string;
  incoterms: string;
  /** ISO date the customer requested. No schema field yet; renders
   * as "TBC" until a future slice adds one (scheduling / target-
   * ship-date capture is post-v1). */
  requestedShipIso: string | null;
  /**
   * The order's structure, or the reason there is none.
   *
   * REPLACES the former `lines` + `oneTime` props, rather than sitting beside
   * them. Two sources for one line set is the shape that produced the defect:
   * the receipt rendered CustomerView while the push sent
   * `buildPlannedSalesOrder`, both were internally consistent, and they
   * disagreed about three of O3's five member quantities.
   */
  structure: OrderReceiptStructure;
  /** Flag rows rendered between totals and status ledger. Empty
   * array = clean receipt (no blockers). Non-empty = one row per
   * flag; each flag's `.detail` is the actionable copy that names
   * the SKU / customer / admin URL the PM needs to forward. */
  soFlags: OrderReceiptFlag[];
  /** HubSpot side of the two-system ledger — rendered as
   * `✓ done at acceptance` in all three states (per R9.1-1). Amount
   * is the tier turnkey figure 8a pushed. */
  hubspotAmount: number;
  hubspotStageLabel: string;
  /** Certification mode: no stage/amount was written to HubSpot. */
  hubspotSuppressed?: boolean;
  netsuiteStatusOnPush: string;
};

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function shortDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

export function OrderReceipt({
  state,
  tierLabel,
  tierQty,
  customerName,
  quoteNumber,
  quoteVersion,
  acceptedAt,
  soId,
  soCreatedAt,
  netsuiteCustomer,
  shipTo,
  terms,
  incoterms,
  requestedShipIso,
  structure,
  soFlags,
  hubspotAmount,
  hubspotStageLabel,
  hubspotSuppressed = false,
  netsuiteStatusOnPush,
}: OrderReceiptProps): ReactNode {
  const placed = state === "record";
  // W1 - `awaiting` and `reconcile` share the failed variant's LAYOUT, which is
  // what they did implicitly before the mapping became total. The status word
  // below stays distinct so the row does not claim a failure that did not
  // happen: an order that exists, or may exist, is not an order that failed.
  const failed = state === "failed" || state === "awaiting" || state === "reconcile";
  const statusWord =
    state === "record"
      ? "created"
      : state === "awaiting"
        ? "pending rates"
        : state === "reconcile"
          ? "unreconciled"
          : state === "failed"
            ? "failed"
            : "not yet";
  // Totals derived from the SAME rows the structure renders. Deriving them
  // from anything else is how a receipt shows one order and totals another.
  const rows = structure.kind === "planned" ? structure.rows : [];
  const goodsRows = rows.filter(
    (r): r is Extract<PlannedRow, { role: "member" } | { role: "direct" }> =>
      r.role === "member" || r.role === "direct",
  );
  // A member row carries the amount the producer computed; a Direct or
  // accounting line carries quantity and rate, and their product IS the
  // relation REG-4 checks against NetSuite's own multiplication. Neither is the
  // forbidden arithmetic -- that would be re-deriving a member's quantity from
  // the tier and the per-set multiplier, which this file never does.
  const extendedOf = (r: PlannedRow): number =>
    r.role === "member"
      ? r.amount
      : r.role === "direct" || r.role === "accounting"
        ? r.line.quantity * r.line.rate
        : 0;
  const subtotal = goodsRows.reduce((a, r) => a + extendedOf(r), 0);
  const oneTimeTotal = rows.reduce(
    (a, r) => (r.role === "accounting" ? a + extendedOf(r) : a),
    0,
  );
  const total = subtotal + oneTimeTotal;
  const units = goodsRows.reduce(
    (a, r) => a + (r.role === "member" ? r.quantity : r.line.quantity),
    0,
  );

  return (
    <div className="r9-so">
      <div className="r9-so-head">
        <div className="who">
          <div className="t">{customerName}</div>
          <div className="s">
            {tierLabel} · {tierQty.toLocaleString()} units per SKU ·{" "}
            {units.toLocaleString()} units total
            <br />
            against {quoteNumber ?? "(quote)"} v{quoteVersion} · accepted{" "}
            {shortDate(acceptedAt)}
          </div>
        </div>
        {/* Slice 12 Step 9 CD audit Item 1 — the stamp derives from
            STATE, not soId nullability. Prior code checked
            `placed && soId` which meant a placed order rendering
            without a resolved id would show "no order number yet" —
            a receipt asserting something false about itself. Now:
            `placed` alone drives the "order placed" register; a
            missing id gets a state-honest "(resolving…)" caption
            rather than a "not placed" one. */}
        <div className="stamp">
          {placed ? (
            <div className="n">{soId ?? "(order number resolving…)"}</div>
          ) : (
            <div className="n pending">no order number yet</div>
          )}
          <div className="d">
            {placed
              ? soCreatedAt
                ? "created " + shortDateTime(soCreatedAt)
                : "created"
              : "NetSuite Sales Order"}
          </div>
        </div>
      </div>

      <div className="r9-so-meta">
        <div className="cell">
          <div className="k">NetSuite account</div>
          <div className="v">
            <strong>{netsuiteCustomer.name}</strong>
            <br />
            <span className="mono">{netsuiteCustomer.id}</span>
            {netsuiteCustomer.matched && <span className="ok">✓ matched</span>}
          </div>
        </div>
        <div className="cell">
          <div className="k">Ship to</div>
          <div className="v">{shipTo}</div>
        </div>
        <div className="cell">
          <div className="k">Terms</div>
          <div className="v">
            {terms}
            <br />
            <span className="mono">{incoterms}</span>
          </div>
        </div>
        <div className="cell">
          <div className="k">Requested ship</div>
          <div className="v">
            {requestedShipIso ? shortDate(requestedShipIso) : "TBC"}
          </div>
        </div>
      </div>

      {/* Says what the reader is looking at. Not "what the customer receives"
          and not a summary of the quote -- the ERP line set, in send order. */}
      <div className="r9-so-lcaption">
        This is the NetSuite order structure Nexus will create.
      </div>

      <div className="r9-so-lines">
        <div className="r9-so-lrow head">
          <span>Item</span>
          <span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>Unit</span>
          <span style={{ textAlign: "right" }}>Extended</span>
        </div>

        {structure.kind === "unavailable" ? (
          /* No structure, on purpose. See `OrderReceiptStructure`. */
          <div className="r9-so-lblocked" role="status">
            <span className="r9-so-lblocked-title">
              No order structure yet
            </span>
            <span className="r9-so-lblocked-body">{structure.reason}</span>
          </div>
        ) : (
          structure.rows.map((row, i) => {
            if (row.role === "group") {
              return (
                <div className="r9-so-lrow group" key={`g-${row.assemblyId}-${i}`}>
                  <span className="desc">
                    <span className="n">Group · {row.sku}</span>
                    <span className="m">
                      <span className="code">{row.name}</span>
                      {row.externalId ? <> · {row.externalId}</> : null}
                    </span>
                  </span>
                  <span className="num qty">{row.quantity.toLocaleString()}</span>
                  <span className="num unit">—</span>
                  <span className="num ext">—</span>
                </div>
              );
            }
            if (row.role === "member") {
              return (
                <div className="r9-so-lrow member" key={`m-${row.sku}-${i}`}>
                  <span className="desc">
                    <span className="n">{row.sku}</span>
                    {/* The multiplier is STATED, not applied. NetSuite performs
                        the expansion; showing the factor is how a reader can
                        check the quantity beside it without doing it again. */}
                    <span className="m">
                      <span className="code">{row.qtyPerParent} per set</span>
                    </span>
                  </span>
                  <span className="num qty">{row.quantity.toLocaleString()}</span>
                  <span className="num unit">{usd(row.rate, 2)}</span>
                  <span className="num ext">{usd(row.amount)}</span>
                </div>
              );
            }
            if (row.role === "end_group") {
              return (
                <div className="r9-so-lrow endgroup" key={`e-${row.assemblyId}-${i}`}>
                  <span className="desc">
                    <span className="n">EndGroup</span>
                    {/* Carries no economics of its own -- it closes the group
                        and nothing more. Shown because the ERP line set has it,
                        and a receipt that omitted it would not be the order. */}
                    <span className="m">closes the group</span>
                  </span>
                  <span className="num qty">—</span>
                  <span className="num unit">—</span>
                  <span className="num ext">—</span>
                </div>
              );
            }
            const l = row.line;
            return (
              <div
                className={`r9-so-lrow ${row.role === "accounting" ? "onetime" : ""}`}
                key={`${row.role}-${l.netsuiteItemId}-${i}`}
              >
                <span className="desc">
                  <span className="n">{l.description}</span>
                  <span className="m">
                    <span className="code">{l.sku}</span>
                  </span>
                </span>
                <span className="num qty">{l.quantity.toLocaleString()}</span>
                <span className="num unit">{usd(l.rate, 2)}</span>
                <span className="num ext">{usd(l.quantity * l.rate)}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="r9-so-totals">
        <div className="r9-so-trow">
          <span className="k">Product subtotal</span>
          <span className="v">{usd(subtotal)}</span>
        </div>
        <div className="r9-so-trow">
          <span className="k">One-time charges</span>
          <span className="v">{usd(oneTimeTotal)}</span>
        </div>
        <div className="r9-so-trow grand">
          <span className="k">Order total</span>
          <span className="v">{usd(total)}</span>
        </div>
      </div>

      {soFlags.map((f) => (
        <div
          className={"r9-so-flag " + f.level}
          key={f.label}
          data-testid={`so-flag-${f.level}`}
        >
          <span className="g">{f.level === "bad" ? "✕" : "!"}</span>
          <span>
            <span className="t">{f.label}</span>
            <span className="s">{f.detail}</span>
          </span>
        </div>
      ))}

      <div className="r9-so-status">
        {hubspotSuppressed ? (
          // Certification mode — Accept wrote NOTHING to HubSpot. Rendering the
          // usual "deal set to X · done at acceptance" row here would assert a
          // production write that never happened, so the row states the
          // suppression instead of the stage.
          <div className="r9-so-srow">
            <span className="icon">—</span>
            <span className="lbl">
              <strong>HubSpot</strong> — deal not modified. HubSpot Accept
              synchronization is disabled for certification; no stage or amount
              was written.
            </span>
            <span className="val">suppressed</span>
          </div>
        ) : (
          <div className="r9-so-srow done">
            <span className="icon">✓</span>
            <span className="lbl">
              <strong>HubSpot</strong> — deal set to {hubspotStageLabel} at{" "}
              {usd(hubspotAmount)}
            </span>
            <span className="val">done at acceptance</span>
          </div>
        )}
        <div
          className={
            "r9-so-srow " + (placed ? "done" : failed ? "fail" : "")
          }
        >
          <span className="icon">
            {placed ? "✓" : failed ? "!" : "·"}
          </span>
          {/* Slice 12 Step 9 CD audit Item 1 — same state-vs-nullability
              fix as the header stamp. `placed` alone drives the "created"
              register; a missing soId gets a resolving caption rather than
              flipping back to the pre-send label. */}
          <span className="lbl">
            <strong>NetSuite</strong> — Sales Order{" "}
            {placed ? (
              <span>
                {soId ?? "(order number resolving…)"} created ·{" "}
                {netsuiteStatusOnPush}
              </span>
            ) : failed ? (
              <span>not created — endpoint rejected the order</span>
            ) : (
              <span>will be created as {netsuiteStatusOnPush}</span>
            )}
          </span>
          <span className="val">
            {statusWord}
          </span>
        </div>
        <div className={"r9-so-srow " + (placed ? "done" : "")}>
          <span className="icon">{placed ? "✓" : "·"}</span>
          <span className="lbl">
            <strong>Quote</strong> —{" "}
            {placed
              ? "locked as the canonical record"
              : "stays reversible until the order is sent"}
          </span>
          <span className="val">{placed ? "locked" : "not yet"}</span>
        </div>
      </div>
    </div>
  );
}

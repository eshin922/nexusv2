"use client";

/**
 * The Customer View configuration rail — Card 0 → 1 → 2 → 3 → finalize footer.
 *
 * AUTHORITY: `docs/design-authority/customer-view/`. The order is the
 * operator's order of thought: what is fixed, what I may elect, how it appears,
 * what Accounting is told, then the act.
 *
 * ── WHAT IS HONESTLY ABSENT ─────────────────────────────────────────────
 *
 * Card 2 and Card 3 render only what a data model exists for. The Layer-2
 * presentation profile (`presentation_profile`) was never built — tiers-shown,
 * recommended-as-a-presentation-control, the four include flags and the 400-char
 * customer note have no draft persistence, and the *Customer received* summary
 * is a projection of exactly that missing record.
 *
 * Those controls are therefore ABSENT, with the reason stated, rather than
 * rendered as controls that silently lose their value on reload. Faking them
 * would be worse than the gap: an operator would trust them.
 *
 * Card 0 is read-only by definition, which is why it can be complete now.
 */

import type { BelowFloorProjection } from "@/lib/below-floor-projection";
import { AccountingInstruction } from "./accounting-instruction";
import { FinalizeQuoteButton } from "./finalize-quote-button";
import { CardCommercialRecovery } from "./card-commercial-recovery";
import type { AuthoritativeProjection } from "./authoritative-projection";
import {
  CardCustomerPresentation,
  type PresentationState,
  type PresentationTier,
} from "./card-customer-presentation";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import { chargePolicy } from "@/lib/commercial-recovery/registry";
import {
  summariseUnbillablePlacements,
  type UnbillablePlacement,
} from "@/lib/commercial-recovery/unbillable-placements";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { CustomerViewDetailLevel, CustomerViewPdfLayout } from "@/types/quote";

export type GovernedSummary = {
  goodsSell: number | null;
  chargesAtCost: number | null;
  approvedRecovery: number | null;
  floorMarginPct: number;
  targetMarginPct: number;
  recommendedTierLabel: string | null;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** The authority's recovery words for the Accounting handoff. */
const RECOVERY_WORD: Record<string, string> = {
  unit_price: "in unit price",
  separate_line: "billed separately",
  absorbed: "absorbed — not charged",
};

export function CustomerViewRail({
  quoteId,
  quoteStatus,
  recoveryRows,
  recoveryInstructions,
  rollups,
  governed,
  pdfLayout,
  onPdfLayoutChange,
  detailLevel,
  onDetailLevelChange,
  pdfHref,
  pageCount,
  presentation,
  tiers,
  belowFloor,
  unbillableRecovery,
  accountingInstruction,
  onAuthoritative,
}: {
  quoteId: string;
  quoteStatus: string;
  recoveryRows: RecoveryChargeRow[];
  recoveryInstructions: readonly FrozenRecoveryInstruction[];
  rollups: readonly QuotePerTierRollup[];
  governed: GovernedSummary;
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
  detailLevel: CustomerViewDetailLevel;
  onDetailLevelChange: (next: CustomerViewDetailLevel) => void;
  pdfHref: string;
  pageCount: number;
  /**
   * Card 2 renders this as controls; Card 3 renders it as prose. ONE record,
   * read once upstream — the two cards cannot disagree about what the document
   * does, which they would the moment either derived its own copy.
   */
  presentation: PresentationState;
  /** The quote's tiers, for the visibility toggles and the recommendation. */
  tiers: readonly PresentationTier[];
  /** The send gate's own verdict, evaluated once upstream. */
  belowFloor: BelowFloorProjection;
  /**
   * Recovery placed where this quote cannot bill it — the same finding the
   * send gate refuses on, resolved from the same constructed state. Empty on
   * every well-formed quote.
   */
  unbillableRecovery: UnbillablePlacement[];
  /** Internal, never printed. See the resolver's note on why it is not on the view. */
  accountingInstruction: string | null;
  onAuthoritative?: (p: AuthoritativeProjection) => void;
}) {
  const isDraft = quoteStatus === "draft";

  // THE SAME VERDICT THE SEND GATE REACHES.
  //
  // This used to be `rollups.some(t => t.blendedMarginPct < floor - 1e-6)`,
  // which was wrong twice over: it re-derived a threshold the costing layer
  // already governs as `blendedMarginStatus`, and it read no authorizations at
  // all. So a below-floor tier that had been properly authorized still showed
  // `blocked` and offered "Request pricing approval" - sending an operator to
  // seek approval they already held, for a send the gate would have allowed.
  //
  // Wrong in the direction that wastes an approver's time and teaches
  // operators to distrust the surface. Now one evaluation, shared.
  const blocked = !belowFloor.ok;
  // A known-invalid state must not read as ready. Until this existed the
  // checklist showed three ticks on a quote carrying $1,727.60 of recovery the
  // document does not bill, and the operator only learned something was wrong
  // by clicking - where an unrelated Costs refusal answered first, so they
  // learned about freight markup instead.
  const unbillable = summariseUnbillablePlacements(unbillableRecovery);
  const hasUnbillable = unbillable.length > 0;

  // Card 3 · commercial agreement, one row per CHARGE. The frozen instruction
  // is per (charge, owner, tier); Accounting reads a charge, so identical
  // treatments collapse and a charge treated two ways stays visible.
  const agreement = new Map<string, { label: string; word: string; amount: number | null }>();
  for (const i of recoveryInstructions) {
    const key = `${i.chargeKey}::${i.treatment}`;
    const prev = agreement.get(key);
    agreement.set(key, {
      label: chargePolicy(i.chargeKey).label,
      word: RECOVERY_WORD[i.treatment] ?? i.treatment,
      amount:
        prev?.amount === null || i.governedRecovery === null
          ? null
          : (prev?.amount ?? 0) + i.governedRecovery,
    });
  }

  // Card 3 - "Customer received", derived from the SAME record Card 2 edits.
  //
  // Not stored. The authority is explicit that this is derived at render, and
  // the reason is the one this workstream keeps meeting: a stored sentence is a
  // second copy of a decision, and the two are free to drift the moment either
  // side changes. Reading the projection means the prose cannot describe a
  // document the customer did not receive.
  const shownTiers = tiers.filter((t) => !presentation.hiddenTierIds.includes(t.id));
  const recommended = tiers.find((t) => t.recommended);

  const byWord = new Map<string, string[]>();
  for (const a of agreement.values()) {
    const list = byWord.get(a.word) ?? [];
    list.push(a.label);
    byWord.set(a.word, list);
  }
  const charges = (word: string) => byWord.get(word)?.join(", ") ?? null;

  const customerReceived: [string, string][] = [
    [
      "Shape",
      presentation.detailLevel === "itemized"
        ? "Itemized - line by line"
        : "Turnkey - one number",
    ],
    [
      "Tiers",
      presentation.layout === "single_tier"
        ? `Single tier - ${recommended?.label ?? "none"}`
        : `${shownTiers.length} of ${tiers.length} shown`,
    ],
    ["Recommended", recommended ? recommended.label : "none marked"],
  ];

  const inUnit = charges("in unit price");
  if (inUnit) customerReceived.push(["In unit price", inUnit]);
  const separate = charges("billed separately");
  if (separate) customerReceived.push(["Billed separately", separate]);
  const absorbed = charges("absorbed - not charged");
  // The authority requires this line to say so explicitly. An absorbed charge
  // is real money the firm gave up, and Accounting reading "absorbed" without
  // it might reasonably expect the customer to have been told.
  if (absorbed) {
    customerReceived.push([
      "Absorbed",
      `${absorbed} - never shown to the customer`,
    ]);
  }

  customerReceived.push(
    [
      "Fees",
      presentation.includeFeeLines
        ? "Itemized on the document"
        : "Collapsed - total still stated",
    ],
    ["Terms", presentation.includeTerms ? "Printed" : "Not printed"],
    ["Addendum", presentation.includeAddendum ? "Included" : "Not included"],
    [
      "Note",
      !presentation.includeNote
        ? "Not printed"
        : presentation.customerNote && presentation.customerNote.trim().length > 0
          ? "Printed above How to accept"
          : "Printed - empty",
    ],
  );

  return (
    <aside className="cv-rail" data-testid="customer-view-rail">
      <div className="cv-rail-scroll">
        {/* ── Card 0 · governed, not editable here ───────────────────── */}
        <section className="cv-card-governed" data-testid="card-governed">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <span className="cv-eyebrow">Governed · not editable here</span>
            <span style={{ marginLeft: "auto", fontSize: 10 }} aria-hidden>🔒</span>
          </div>

          <div className="cv-gov-row">
            <span className="cv-gov-k">
              Goods sell
              {governed.recommendedTierLabel ? ` · ${governed.recommendedTierLabel}` : ""}
            </span>
            <span className="cv-gov-v" data-testid="cv-goods-sell">
              {/* No surrogate tier. These rows are scoped to the recommended
                  tier; with none named, the absence is the fact. */}
              {governed.recommendedTierLabel === null
                ? "No recommended tier"
                : governed.goodsSell === null
                  ? "not priced"
                  : usd(governed.goodsSell)}
            </span>
            <span className="cv-gov-src">pricing</span>
          </div>
          <div className="cv-gov-row">
            <span className="cv-gov-k">Charges at cost</span>
            <span className="cv-gov-v">
              {governed.chargesAtCost === null ? "—" : usd(governed.chargesAtCost)}
            </span>
            <span className="cv-gov-src">costs</span>
          </div>
          <div className="cv-gov-row">
            <span className="cv-gov-k">Approved recovery</span>
            <span className="cv-gov-v">
              {/* D5 · this IS the governed recoverable amount, in the
                  authority's vocabulary. Unknown stays unavailable, never $0. */}
              {governed.recommendedTierLabel === null
                ? "—"
                : governed.approvedRecovery === null
                  ? "not priced"
                  : usd(governed.approvedRecovery)}
            </span>
            <span className="cv-gov-src">pricing</span>
          </div>
          <div className="cv-gov-row">
            <span className="cv-gov-k">Margin floor / target</span>
            <span className="cv-gov-v">
              {pct(governed.floorMarginPct)} / {pct(governed.targetMarginPct)}
            </span>
            <span className="cv-gov-src">policy</span>
          </div>

          <p className="cv-gov-foot">
            Cost amounts are owned by Costs and Pricing. This surface decides how they are{" "}
            <strong>recovered</strong> and how they are <strong>shown</strong> — never what
            they are.
          </p>
        </section>

        {/* ── Card 1 · commercial recovery ───────────────────────────── */}
        <CardCommercialRecovery
          onAuthoritative={onAuthoritative}
          quoteId={quoteId}
          rows={recoveryRows}
          rollups={rollups}
          shownTierIds={[]}
          floorMarginPct={governed.floorMarginPct}
          targetMarginPct={governed.targetMarginPct}
          editable={isDraft}
        />

        {/* Card 2 - customer presentation */}
        <CardCustomerPresentation
          quoteId={quoteId}
          editable={isDraft}
          presentation={presentation}
          tiers={tiers}
          detailLevel={detailLevel}
          onDetailLevelChange={onDetailLevelChange}
          pdfLayout={pdfLayout}
          onPdfLayoutChange={onPdfLayoutChange}
        />

        {/* ── Card 3 · accounting handoff ────────────────────────────── */}
        <section className="cv-card cv-card-accounting" data-testid="card-accounting-handoff">
          <div className="cv-card-head">
            <span className="cv-step">3</span>
            <div>
              <div className="cv-card-title">Accounting handoff</div>
              <div className="cv-card-sub">
                Inherited on acceptance. Never printed for the customer.
              </div>
            </div>
            <span className="cv-internal-chip">internal</span>
          </div>

          <div className="cv-section">
            <span className="cv-eyebrow">Commercial agreement · read-only</span>
            {agreement.size === 0 ? (
              <p className="cv-note" style={{ marginTop: 6 }}>
                No governed charges on this quote.
              </p>
            ) : (
              [...agreement.entries()].map(([key, a]) => (
                <div className="cv-agreement-row" key={key}>
                  <span className="cv-agreement-k">{a.label}</span>
                  <span className="cv-agreement-v">
                    {a.word}
                    {a.amount === null ? "" : ` · ${usd(a.amount)}`}
                  </span>
                  <span className="cv-agreement-src">
                    {a.word.startsWith("absorbed") ? "not billed" : "this quote"}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Customer received - DERIVED.
              A projection of the same record Card 2 edits, read once upstream.
              Derived at render and never stored as prose: a stored sentence is
              a second copy of the decision, free to disagree with the document
              the moment either side changes. */}
          <div className="cv-section">
            <span className="cv-eyebrow">Customer received &middot; derived</span>
            {customerReceived.map(([k, v]) => (
              <div className="cv-kv" key={k}>
                <span className="cv-kv-k">{k}</span>
                <span className="cv-kv-v">{v}</span>
              </div>
            ))}
          </div>

          <div className="cv-section">
            <span className="cv-eyebrow">Instruction to Accounting &middot; authored here</span>
            <AccountingInstruction
              quoteId={quoteId}
              editable={isDraft}
              value={accountingInstruction}
            />
          </div>
        </section>
      </div>

      {/* ── Finalize footer · pinned ─────────────────────────────────── */}
      <div className="cv-footer" data-testid="cv-finalize-footer">
        <div className="cv-send-head">
          <span className="cv-send-chip"
                data-state={!isDraft ? "frozen" : blocked ? "blocked" : "draft"}>
            {!isDraft ? "frozen" : blocked ? "blocked" : "draft"}
          </span>
          <span className="cv-send-line">
            {pageCount} page PDF · delivery is manual
          </span>
        </div>

        <div className="cv-checks">
          {/* Led with, when present. An unbillable placement is a defect in what
              the quote CHARGES, not a policy step an operator can approve, and
              it must not sit below two ticks reading as ready. */}
          {unbillable.map((line) => (
            <div className="cv-check" key={line}>
              <span className="cv-mark" data-ok="no">!</span>
              {line}
            </div>
          ))}
          <div className="cv-check">
            <span className="cv-mark" data-ok={blocked ? "no" : "yes"}>{blocked ? "!" : "\u2713"}</span>
            {/* The verdict's OWN words when it refuses. "A governed tier is
                below the margin floor" was true and useless: it did not say
                which tier, and it did not distinguish never-authorized from
                authorized-then-invalidated from state-has-changed-since -
                three refusals that send an operator to three different places.
                The authorization core already writes those sentences. */}
            {blocked
              ? belowFloor.tiers
                  .filter((t) => !t.ok)
                  .map((t) => `${t.label} - ${t.message}`)
                  .join(" ")
              : belowFloor.anyBelowFloor
                ? "Below floor, and authorized"
                : "Every governed tier is at or above the floor"}
          </div>
          <div className="cv-check">
            <span className="cv-mark" data-ok="yes">✓</span>
            {detailLevel === "itemized" ? "Itemized" : "Turnkey"} ·{" "}
            {pdfLayout === "tier_table" ? "all tiers" : "single tier"}
          </div>
          <div className="cv-check">
            <span className="cv-mark" data-ok="yes">✓</span>
            Delivery is manual — Nexus does not email the customer
          </div>
        </div>

        {/* FINALIZE QUOTE, not "Freeze & send".
            Edward's call, 2026-08-25. Nexus does not email the customer, and
            this footer says so two lines above: "Delivery is manual - Nexus
            does not email the customer." A button promising to send, directly
            beneath a line saying nothing is sent, is the surface contradicting
            itself about the one act the operator is about to perform.
            What the button does is freeze the quote and produce the artifact.
            It is now called that. */}
        <FinalizeQuoteButton
          quoteId={quoteId}
          // Refused when the quote is already frozen, when a below-floor tier
          // is unauthorized, or when the deal has no HubSpot link. The floor
          // condition PREDICTS `sendQuote`'s own refusal from the same shared
          // projection - so the operator learns it before clicking rather than
          // after, and the two can never disagree.
          // Also refused while any recovery is placed where this quote cannot
          // bill it. That condition PREDICTS `sendQuote`'s own refusal from the
          // same detection, so the operator learns it here rather than by
          // clicking - and on the one quote carrying this state, clicking
          // reached an unrelated Costs refusal first and taught them nothing
          // about it.
          disabled={!isDraft || hasUnbillable || blocked}
          dataState={
            !isDraft ? "frozen" : hasUnbillable ? "blocked" : blocked ? "blocked" : "ready"
          }
          title={
            !isDraft
              ? "This quote is already frozen. Revise it to start a new version."
              : hasUnbillable
                ? "Recovery is placed where this quote cannot bill it. See the check above."
                : blocked
                  ? "A below-floor tier is not authorized. See the check above."
                  : "Freezes this version and produces the customer PDF. Delivery stays manual."
          }
          label={
            !isDraft
              ? "Frozen - start v2"
              : hasUnbillable
                ? "Resolve recovery placement"
                : blocked
                  ? "Request pricing approval"
                  : "Finalize quote"
          }
        />

        <div className="cv-secondary">
          <a href={pdfHref} target="_blank" rel="noreferrer"
             title="Generates the PDF and saves it to your Downloads.">⤓ Download PDF</a>
          <a href={pdfHref} target="_blank" rel="noreferrer"
             title="Generates the PDF and opens a draft in your mail client.">↳ Download + mail draft</a>
        </div>

        <div className="cv-artifact">
          {isDraft ? "draft-marked artifact" : "frozen artifact"}
        </div>
      </div>
    </aside>
  );
}

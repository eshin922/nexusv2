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

import { CardCommercialRecovery } from "./card-commercial-recovery";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { FrozenRecoveryInstruction } from "@/lib/commercial-recovery/frozen-instruction";
import { chargePolicy } from "@/lib/commercial-recovery/registry";
import type { QuotePerTierRollup } from "@/lib/costing";
import type { CustomerViewDetailLevel, CustomerViewPdfLayout } from "@/types/quote";

export type GovernedSummary = {
  goodsSell: number | null;
  chargesAtCost: number;
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
}) {
  const isDraft = quoteStatus === "draft";
  const blocked = rollups.some(
    (t) => t.blendedMarginPct !== null && t.blendedMarginPct < governed.floorMarginPct - 1e-6,
  );

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
              Goods sell{governed.recommendedTierLabel ? ` · ${governed.recommendedTierLabel}` : ""}
            </span>
            <span className="cv-gov-v">
              {governed.goodsSell === null ? "not priced" : usd(governed.goodsSell)}
            </span>
            <span className="cv-gov-src">pricing</span>
          </div>
          <div className="cv-gov-row">
            <span className="cv-gov-k">Charges at cost</span>
            <span className="cv-gov-v">{usd(governed.chargesAtCost)}</span>
            <span className="cv-gov-src">costs</span>
          </div>
          <div className="cv-gov-row">
            <span className="cv-gov-k">Approved recovery</span>
            <span className="cv-gov-v">
              {/* D5 · this IS the governed recoverable amount, in the
                  authority's vocabulary. Unknown stays unavailable, never $0. */}
              {governed.approvedRecovery === null ? "not priced" : usd(governed.approvedRecovery)}
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
          quoteId={quoteId}
          rows={recoveryRows}
          rollups={rollups}
          shownTierIds={[]}
          floorMarginPct={governed.floorMarginPct}
          targetMarginPct={governed.targetMarginPct}
          editable={isDraft}
        />

        {/* ── Card 2 · customer presentation ─────────────────────────── */}
        <section className="cv-card" data-testid="card-customer-presentation">
          <div className="cv-card-head">
            <span className="cv-step">2</span>
            <div>
              <div className="cv-card-title">Customer presentation</div>
              <div className="cv-card-sub">Never changes economics. Display only.</div>
            </div>
          </div>

          <div className="cv-section">
            <div className="cv-field">
              <span className="cv-eyebrow">Shape</span>
              <div className="cv-choice">
                <button type="button" aria-pressed={detailLevel === "itemized"}
                        disabled={!isDraft}
                        onClick={() => onDetailLevelChange("itemized")}
                        data-testid="cv-detail-itemized">Itemized</button>
                <button type="button" aria-pressed={detailLevel === "turnkey_only"}
                        disabled={!isDraft}
                        onClick={() => onDetailLevelChange("turnkey_only")}
                        data-testid="cv-detail-turnkey">Turnkey</button>
              </div>
            </div>

            <div className="cv-field">
              <span className="cv-eyebrow">Tier layout</span>
              <div className="cv-choice">
                <button type="button" aria-pressed={pdfLayout === "tier_table"}
                        disabled={!isDraft}
                        onClick={() => onPdfLayoutChange("tier_table")}
                        data-testid="cv-layout-tier-table">Tier table</button>
                <button type="button" aria-pressed={pdfLayout === "single_tier"}
                        disabled={!isDraft}
                        onClick={() => onPdfLayoutChange("single_tier")}
                        data-testid="cv-layout-single-tier">Single tier</button>
              </div>
            </div>
          </div>

          {/* Absent on purpose. See the header note. */}
          <div className="cv-section">
            <p className="cv-note" data-testid="cv-presentation-gap">
              Tiers shown, recommended tier, the include toggles and the customer note are
              not here yet: the presentation profile has no draft record, so those choices
              would not survive a reload. They arrive with that schema rather than as
              controls that quietly forget.
            </p>
          </div>
        </section>

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

          <div className="cv-section">
            <p className="cv-note" data-testid="cv-accounting-gap">
              <em>Customer received</em> and the authored instruction to Accounting are not
              here yet. The first is a projection of the presentation profile, which has no
              record; the second is an authored field this surface does not own yet. Neither
              is derivable from what exists today.
            </p>
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
          <div className="cv-check">
            <span className="cv-mark" data-ok={blocked ? "no" : "yes"}>{blocked ? "!" : "✓"}</span>
            {blocked
              ? "A governed tier is below the margin floor"
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

        {/* Freeze & send is the governing wording — D2. It is deliberately
            not wired here: this increment restores composition, and the send
            path is certified elsewhere. */}
        <button className="cv-primary" type="button" disabled
                data-state={!isDraft ? "frozen" : blocked ? "blocked" : "ready"}
                title="Not wired in this increment — the send path is unchanged and lives on the Send sub-tab."
                data-testid="cv-primary">
          {!isDraft ? "Frozen — start v2" : blocked ? "Request pricing approval" : "Freeze & send"}
        </button>

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

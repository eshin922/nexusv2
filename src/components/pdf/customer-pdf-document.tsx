// Slice 11 Step 4.5 — compositional refactor. Previously three
// mutually-exclusive State compositions (StatePure /
// StatePassThrough / StatePartial), each returning its own
// complete `<Document>` tree. Per CA Step 4 disposition
// (modified Option 1 — orthogonal flags), the composition is now
// a single `<CustomerPdfDocument>` parameterized by two data-
// derived booleans:
//
//   - `hasCharges` — pass-through freight present OR service fees
//     visible. Renders the charges block + shifts the terms
//     section spacing (sectionTight).
//   - `hasUnpriced` — any SKU has a null tier price
//     (quote-on-request). Drives the partial sub-header lede
//     fragment + PricingFoot(partial) + GrandTotalRow "from $X"
//     prefix (already handled inside GrandTotalRow via
//     `hasUnpriced` computed from the same data).
//
// The two flags compose to four combinations (Pure / PassThrough
// / Partial / PassThrough+Partial). The fourth was structurally
// unreachable in the mutually-exclusive port; the flag composition
// handles it correctly — charges block renders AND unpriced
// treatment applies, matching CA's rejected-option-1 warning
// about silently-dropped fees on partial-with-charges quotes.
//
// Pattern 30: JSX primitives + class-name parity preserved 1:1
// with the ported render tree. This is compositional
// reorganization, not visual change.
//
// Pattern 45 boundary: only fixture-shape prop types from
// `customer-pdf-types`; zero costing-surface imports. The
// adapter (customer-view-to-cpdf) produces the flag values;
// this file consumes them.
//
// ─── Multi-page <Document> seam (post-Step-3 amendment) ───
//
// Per §0.5 catch #79: the spec addendum lives INTO the generated
// PDF when the `include_spec_addendum` toggle is on (Edward
// Option A). The generated PDF and QuoteHost preview assemble as
// one react-pdf `<Document>` of pricing page(s) + N addendum
// pages. `addendumPages` prop is the composition seam; caller
// gates on `data.includeSpecAddendum` AND `addendum.
// hasMeaningfulContent` (impl-6 guard).

import type { ReactNode } from "react";

import { Document, Page, Text, View } from "@react-pdf/renderer";

import { registerPdfFonts } from "@/lib/pdf-fonts";

import { ChargesBlock } from "./customer-pdf-charges-block";
import { PageFooter, PageRunHead } from "./customer-pdf-chrome";
import { GrandTotalRow } from "./customer-pdf-grand-total-row";
import { Masthead } from "./customer-pdf-masthead";
import { Parties } from "./customer-pdf-parties";
import { PricingFoot } from "./customer-pdf-pricing-foot";
import { PricingTable } from "./customer-pdf-pricing-table";
import { styles } from "./customer-pdf-styles";
import {
  HowToAccept,
  NotesBlock,
  TcsBlock,
  TermsBlock,
} from "./customer-pdf-terms-block";
import { TurnkeySummary } from "./customer-pdf-turnkey-summary";
import type {
  CpdfData,
  CpdfDetailLevel,
  CpdfPdfLayout,
  CpdfQuote,
  CpdfVendor,
} from "./customer-pdf-types";

registerPdfFonts();

/**
 * Per-page chrome — runhead (pages 2+) + footer (every page).
 * Same-View `fixed` + positioning pattern per Pattern 49 (CLAUDE.md).
 */
function PageChrome({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <>
      <PageFooter vendor={vendor} quote={quote} />
      <PageRunHead vendor={vendor} quote={quote} />
    </>
  );
}

// ─── Unified itemized head ──────────────────────────────────
//
// Replaces PureItemizedHead / PassThroughItemizedHead /
// PartialItemizedHead. Composes the lede from four fragments
// per the four flag combinations; eyebrow / h2 track the
// single-tier axis.

function ItemizedHead({
  isSingle,
  hasCharges,
  hasSeparateFreight,
  hasUnpriced,
  fullLabelIfSingle,
  recommendedTierFullLabel,
}: {
  isSingle: boolean;
  hasCharges: boolean;
  /** Governed evidence that separately projected freight EXISTS — i.e. the
   *  customer-view model actually carries freight lines. Freight-specific
   *  copy renders only from this, never from `hasCharges`. */
  hasSeparateFreight: boolean;
  hasUnpriced: boolean;
  /** Passed when isSingle=true; used for h2 "Per-unit pricing · {full}". */
  fullLabelIfSingle: string | null;
  /**
   * Full label of the recommended tier (e.g. "Tier 2"). Used in the
   * "Tier N is recommended for first-PO production runs" fragment,
   * which renders only in the tier_table + priced branch. Null
   * safely omits the fragment.
   */
  recommendedTierFullLabel: string | null;
}) {
  const eyebrow = isSingle ? "Confirmed pricing" : "Tiered pricing";
  const h2 =
    isSingle && fullLabelIfSingle
      ? `Per-unit pricing · ${fullLabelIfSingle}`
      : "Per-unit pricing across volume tiers";
  const showRecommendedNote =
    !isSingle && !hasUnpriced && recommendedTierFullLabel !== null;

  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
      <Text style={styles.h2}>{h2}</Text>
      <Text style={styles.lede}>
        Pricing per the terms below across volume tiers.
        {hasSeparateFreight &&
          " Outbound freight is billed separately at cost."}
        {hasCharges && " One-time charges are itemized below."}
        {hasUnpriced &&
          " One or more items are pending finalization — a quote is available on request once sourcing is locked."}
        {showRecommendedNote &&
          ` ${recommendedTierFullLabel} is recommended for first-PO production runs.`}
        {isSingle &&
          !hasUnpriced &&
          " Full volume tier-pricing available on request."}
      </Text>
    </View>
  );
}

// ─── Terms head (pass-through only) ─────────────────────────
//
// Renders above TermsBlock when hasCharges AND !turnkey — visually
// separates the terms block from the charges block above.

function PassThroughTermsHead() {
  return (
    <View>
      <Text style={styles.eyebrow}>{"Commercial terms".toUpperCase()}</Text>
      <Text style={styles.h2}>Terms {"&"} acceptance</Text>
    </View>
  );
}

// ─── Unified composition ────────────────────────────────────

export function CustomerPdfDocument({
  data,
  skuSet,
  layout,
  detail,
  hasCharges,
  hasUnpriced,
  addendumPages,
}: {
  data: CpdfData;
  skuSet: ReadonlyArray<CpdfData["skus"][number]>;
  layout: CpdfPdfLayout;
  detail: CpdfDetailLevel;
  hasCharges: boolean;
  hasUnpriced: boolean;
  /** Multi-page seam — addendum pages, if any, render after pricing. */
  addendumPages?: ReactNode;
}) {
  const {
    vendor,
    customer,
    quote,
    tiers,
    recommendedTierIdx,
    feeBasisTierIdx,
    serviceFees,
    freightLines,
  } = data;
  const isSingle = layout === "single_tier";
  const turnkey = detail === "turnkey_only";

  // Proof-5 repair (2026-08-11) — freight copy needs FREIGHT evidence.
  //
  // Every freight-specific clause used to render from `hasCharges`, which is
  // `serviceFees.length > 0 || freightLines.length > 0`. A service fee alone
  // therefore asserted, to the customer, that outbound freight was "billed
  // separately at cost (itemized below); not included in the turnkey total".
  // On the governed fixture all of that was false at once: freight was inside
  // unit sell and inside the turnkey total, and nothing was itemized — the
  // claim fired purely because a $17,000 tooling fee existed.
  //
  // Because `freightLines` is the only model evidence of separately projected
  // freight, and the resolver does not populate it today, the honest result is
  // that these sentences do not render. That is the intended outcome: suppress
  // rather than invent a presentation contract the model cannot support.
  //
  // This decides nothing about OD-001. OD-001 asks whether freight SHOULD be
  // shown; this only stops the document asserting freight facts it cannot
  // demonstrate. If a future state genuinely projects freight lines, the copy
  // returns on its own — gated on the evidence, not on a sibling charge.
  const hasSeparateFreight = freightLines.length > 0;
  // Null index means no recommendation exists. `tiers[null]` would be
  // undefined anyway, but stating it keeps the intent legible: the document
  // makes no recommendation rather than quietly landing on one.
  const recommendedTier =
    recommendedTierIdx === null ? null : (tiers[recommendedTierIdx] ?? null);

  // Turnkey lede — composes from same flag axes. Base sentence
  // varies with hasCharges (turnkey-with-fees folds them into the
  // total; without-fees is landed & all-in).
  const turnkeyLede = hasCharges
    ? hasSeparateFreight
      ? "The all-in turnkey total per tier — one-time fees folded in. Outbound freight is billed separately at cost."
      : "The all-in turnkey total per tier — one-time fees folded in."
    : hasUnpriced
      ? "All-in turnkey total per tier. One tier is still pending a final line price, noted below."
      : "Pricing is landed and all-in — one number per volume tier, freight and duty included.";

  // Terms wrapper style — sectionTight when hasCharges OR when
  // turnkey is combined with hasUnpriced (matches the mutually-
  // exclusive-port spacing for those combinations). Otherwise
  // default section spacing.
  const termsWrapperStyle =
    hasCharges || (turnkey && hasUnpriced)
      ? styles.sectionTight
      : styles.section;

  // Terms head — PassThroughTermsHead only in itemized+hasCharges
  // combination (matches original port: PassThrough itemized
  // rendered the head; PassThrough turnkey did not).
  const showTermsHead = hasCharges && !turnkey;

  return (
    <Document>
      <Page size="LETTER" style={styles.sheet}>
        <PageChrome vendor={vendor} quote={quote} />
        <View style={styles.flow}>
          <Masthead vendor={vendor} quote={quote} />
          <Parties vendor={vendor} customer={customer} />

          {turnkey ? (
            <View style={styles.section}>
              <TurnkeySummary
                skuSet={skuSet}
                tiers={tiers}
                recommendedTierIdx={recommendedTierIdx}
                serviceFees={serviceFees}
                layout={layout}
                foldFees={hasCharges}
                freightAtCost={hasSeparateFreight}
                allInUnit={!hasCharges}
                partial={hasUnpriced}
                lede={turnkeyLede}
              />
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <ItemizedHead
                  isSingle={isSingle}
                  hasCharges={hasCharges}
                  hasSeparateFreight={hasSeparateFreight}
                  hasUnpriced={hasUnpriced}
                  fullLabelIfSingle={
                    // A single-tier quote names its one tier whether or not it
                    // is recommended — the two are unrelated facts, and tying
                    // them cost the heading on any single-tier quote with no
                    // recommendation.
                    isSingle ? (tiers[0]?.full ?? null) : null
                  }
                  recommendedTierFullLabel={
                    recommendedTier ? recommendedTier.full : null
                  }
                />
                <PricingTable
                  skus={skuSet}
                  tiers={tiers}
                  recommendedTierIdx={recommendedTierIdx}
                  layout={layout}
                  quoteNumber={quote.quote_number}
                />
                <GrandTotalRow
                  skuSet={skuSet}
                  tiers={tiers}
                  recommendedTierIdx={recommendedTierIdx}
                  serviceFees={serviceFees}
                  layout={layout}
                  foldFees={hasCharges}
                  freightAtCost={hasSeparateFreight}
                  allInUnit={!hasCharges}
                />
                <PricingFoot
                  partial={hasUnpriced}
                  // Same governed source as the lede above. Two sentences on
                  // one page naming the recommended tier must not be able to
                  // disagree, and the way to guarantee that is one input.
                  recommendedTierFullLabel={
                    recommendedTier ? recommendedTier.full : null
                  }
                />
              </View>
              {hasCharges && (
                <View style={styles.section}>
                  <ChargesBlock
                    includeFeeLines={quote.include_fee_lines}
                    tiers={tiers}
                    recommendedTierIdx={recommendedTierIdx}
                    feeBasisTierIdx={feeBasisTierIdx}
                    serviceFees={serviceFees}
                    freightLines={freightLines}
                  />
                </View>
              )}
            </>
          )}

          {/* Terms group — kept-together (wrap={false}) per audit §4 */}
          <View style={termsWrapperStyle} wrap={false}>
            {showTermsHead && <PassThroughTermsHead />}
            {quote.include_terms && (
              <TermsBlock quote={quote} incoterms={quote.incoterms} />
            )}
            <NotesBlock
              notes={quote.include_note ? quote.customer_facing_notes : null}
            />
            <TcsBlock tcs={quote.tcs} />
            <HowToAccept />
          </View>
        </View>
      </Page>
      {addendumPages}
    </Document>
  );
}

// Slice 11 Step 3 — Pattern-30 verbatim port of CD's state
// composition tree (StatePure, StatePassThrough, StatePartial)
// plus the Sheet / Document / Page wrappers.
//
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:335-509 (Sheet + state compositions).
//
// Pattern 30 + audit §5 LOUD CALL-OUT: CD's `<Sheet>` per state +
// `<Break>` markers are REVIEW CHROME ONLY. **Production MUST NOT
// hard-code page splits.** Each state composition emits ONE `<Page>`
// with a single flowing tree; react-pdf's automatic `wrap` +
// `wrap={false}` props handle the physical breaks. CD's
// StatePartial.pageOne/pageTwo split (pdf-render.jsx:475-476) is
// the review affordance — production renders all 6 SKUs as one
// `<PricingTable>` and lets the renderer decide where to break.
//
// `Page` size: LETTER (per spike §1 + audit §5 — 8.5×11in @ 72pt
// PDF; react-pdf maps `size="LETTER"` correctly). CD's `.pp-sheet`
// 816×1056@96dpi is the CSS-preview expression of the same paper.
//
// Pattern 45 boundary: only fixture-shape prop types from
// `customer-pdf-types`; zero costing-surface imports.

import { Document, Page, Text, View } from "@react-pdf/renderer";

import { registerPdfFonts } from "@/lib/pdf-fonts";

import { ChargesBlock } from "./customer-pdf-charges-block";
import { FooterInner, RunHeadInner } from "./customer-pdf-chrome";
import { GrandTotalRow } from "./customer-pdf-grand-total-row";
import { Masthead } from "./customer-pdf-masthead";
import { Parties } from "./customer-pdf-parties";
import { PricingFoot } from "./customer-pdf-pricing-foot";
import { PricingTable } from "./customer-pdf-pricing-table";
import { styles } from "./customer-pdf-styles";
import { HowToAccept, NotesBlock, TermsBlock } from "./customer-pdf-terms-block";
import { TurnkeySummary } from "./customer-pdf-turnkey-summary";
import type {
  CpdfData,
  CpdfDetailLevel,
  CpdfPdfLayout,
  CpdfQuote,
  CpdfVendor,
} from "./customer-pdf-types";

// Fonts must be registered before any react-pdf render. Idempotent
// (subsequent imports no-op per registerPdfFonts internals).
registerPdfFonts();

/**
 * Per-page chrome — runhead (pages 2+) + footer (every page). Wired
 * inside `<Page>` via react-pdf's `fixed` prop + `render` callback.
 * Production pagination is automatic; the callbacks fire per page.
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
      {/* Footer fires on every page. FooterInner uses Text.render
          for the "Page X of Y" string (Text exposes totalPages;
          View does not, per react-pdf type declarations). */}
      <View fixed>
        <FooterInner vendor={vendor} quote={quote} />
      </View>
      {/* RunHead fires on every page; returns null on page 1 so
          only continuation pages display it. */}
      <View
        fixed
        render={({ pageNumber }) =>
          pageNumber > 1 ? <RunHeadInner vendor={vendor} quote={quote} /> : <View />
        }
      />
    </>
  );
}

// Inline eyebrow + h2 + lede subheads — extracted as helpers for
// legibility; CD inlines these at jsx:365-370, 421-423, 485-487.

function PureItemizedHead({
  isSingle,
  fullLabel,
}: {
  isSingle: boolean;
  fullLabel: string;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>
        {(isSingle ? "Confirmed pricing" : "Tiered pricing").toUpperCase()}
      </Text>
      <Text style={styles.h2}>
        {isSingle
          ? `Per-unit pricing · ${fullLabel}`
          : "Per-unit pricing across volume tiers"}
      </Text>
      <Text style={styles.lede}>
        Pricing landed <Text style={styles.ledeEm}>FOB Long Beach</Text> —
        container freight, duty, and applicable tariffs are included in the
        unit price shown.
        {isSingle
          ? " Full volume tier-pricing available on request."
          : " Tier 2 is recommended for first-PO production runs."}
      </Text>
    </View>
  );
}

function PassThroughItemizedHead() {
  return (
    <View>
      <Text style={styles.eyebrow}>{"Tiered pricing".toUpperCase()}</Text>
      <Text style={styles.h2}>Per-unit pricing across volume tiers</Text>
      <Text style={styles.lede}>
        Pricing landed <Text style={styles.ledeEm}>EXW Long Beach</Text>.
        Outbound freight is billed separately at cost; one-time charges are
        itemized below. See page 2 for commercial terms.
      </Text>
    </View>
  );
}

function PassThroughTermsHead() {
  return (
    <View>
      <Text style={styles.eyebrow}>{"Commercial terms".toUpperCase()}</Text>
      <Text style={styles.h2}>Terms {"&"} acceptance</Text>
    </View>
  );
}

function PartialItemizedHead() {
  return (
    <View>
      <Text style={styles.eyebrow}>{"Tiered pricing".toUpperCase()}</Text>
      <Text style={styles.h2}>Per-unit pricing across volume tiers</Text>
      <Text style={styles.lede}>
        Pricing landed <Text style={styles.ledeEm}>FOB Long Beach</Text>.{" "}
        <Text style={styles.ledeEm}>Glow Capsule (CAP-60)</Text> Tier 1 pricing
        is pending finalization of the formulation R{"&"}D milestone — a quote
        is available on request once raw-ingredient sourcing is locked.
      </Text>
    </View>
  );
}

// ─── State A · Pure tier-pricing ─────────────────────────────
// CD `pdf-render.jsx:348-384`
export function StatePure({
  data,
  skuSet,
  layout,
  detail,
}: {
  data: CpdfData;
  skuSet: ReadonlyArray<CpdfData["skus"][number]>;
  layout: CpdfPdfLayout;
  detail: CpdfDetailLevel;
}) {
  const {
    vendor,
    customer,
    quote,
    tiers,
    recommendedTierIdx,
    serviceFees,
  } = data;
  const isSingle = layout === "single_tier";
  const turnkey = detail === "turnkey_only";

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
                foldFees={false}
                freightAtCost={false}
                allInUnit
                partial={false}
                lede="Pricing is landed and all-in — one number per volume tier, freight and duty included."
              />
            </View>
          ) : (
            <View style={styles.section}>
              <PureItemizedHead
                isSingle={isSingle}
                fullLabel={tiers[recommendedTierIdx].full}
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
                foldFees={false}
                freightAtCost={false}
                allInUnit
              />
              <PricingFoot />
            </View>
          )}
          {/* Terms group — kept-together (wrap={false}) per audit §4 */}
          <View style={styles.section} wrap={false}>
            <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
            <NotesBlock notes={quote.customer_facing_notes} />
            <HowToAccept />
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ─── State B · Pass-through freight + visible fees ───────────
// CD `pdf-render.jsx:387-447`
export function StatePassThrough({
  data,
  skuSet,
  layout,
  detail,
}: {
  data: CpdfData;
  skuSet: ReadonlyArray<CpdfData["skus"][number]>;
  layout: CpdfPdfLayout;
  detail: CpdfDetailLevel;
}) {
  const {
    vendor,
    customer,
    quote,
    tiers,
    recommendedTierIdx,
    serviceFees,
    freightLines,
  } = data;
  const turnkey = detail === "turnkey_only";

  // turnkey_only collapses State-B to single page — itemized charges
  // block suppressed; fees fold into total (CD `pdf-render.jsx:392`).
  if (turnkey) {
    return (
      <Document>
        <Page size="LETTER" style={styles.sheet}>
          <PageChrome vendor={vendor} quote={quote} />
          <View style={styles.flow}>
            <Masthead vendor={vendor} quote={quote} />
            <Parties vendor={vendor} customer={customer} />
            <View style={styles.section}>
              <TurnkeySummary
                skuSet={skuSet}
                tiers={tiers}
                recommendedTierIdx={recommendedTierIdx}
                serviceFees={serviceFees}
                layout={layout}
                foldFees
                freightAtCost
                allInUnit={false}
                partial={false}
                lede="The all-in turnkey total per tier — one-time fees folded in. Outbound freight is billed separately at cost."
              />
            </View>
            <View style={styles.sectionTight} wrap={false}>
              <TermsBlock
                quote={quote}
                incoterms={quote.incoterms_passthrough}
              />
              <NotesBlock notes={quote.customer_facing_notes} />
              <HowToAccept />
            </View>
          </View>
        </Page>
      </Document>
    );
  }

  // itemized — single Page; automatic wrap handles the table → charges
  // → terms cascade (CD's prototype hard-splits into 2 sheets purely
  // as review chrome).
  return (
    <Document>
      <Page size="LETTER" style={styles.sheet}>
        <PageChrome vendor={vendor} quote={quote} />
        <View style={styles.flow}>
          <Masthead vendor={vendor} quote={quote} />
          <Parties vendor={vendor} customer={customer} />
          <View style={styles.section}>
            <PassThroughItemizedHead />
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
              foldFees
              freightAtCost
              allInUnit={false}
            />
            <PricingFoot />
          </View>
          <View style={styles.section}>
            <ChargesBlock
              tiers={tiers}
              recommendedTierIdx={recommendedTierIdx}
              serviceFees={serviceFees}
              freightLines={freightLines}
            />
          </View>
          {/* Terms — kept-together unit per audit §4 */}
          <View style={styles.sectionTight} wrap={false}>
            <PassThroughTermsHead />
            <TermsBlock quote={quote} incoterms={quote.incoterms_passthrough} />
            <NotesBlock notes={quote.customer_facing_notes} />
            <HowToAccept />
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ─── State C · Partial completeness + table overflow ─────────
// CD `pdf-render.jsx:450-509`
export function StatePartial({
  data,
  skuSet,
  layout,
  detail,
}: {
  data: CpdfData;
  skuSet: ReadonlyArray<CpdfData["skus"][number]>;
  layout: CpdfPdfLayout;
  detail: CpdfDetailLevel;
}) {
  const {
    vendor,
    customer,
    quote,
    tiers,
    recommendedTierIdx,
    serviceFees,
  } = data;
  const turnkey = detail === "turnkey_only";

  if (turnkey) {
    return (
      <Document>
        <Page size="LETTER" style={styles.sheet}>
          <PageChrome vendor={vendor} quote={quote} />
          <View style={styles.flow}>
            <Masthead vendor={vendor} quote={quote} />
            <Parties vendor={vendor} customer={customer} />
            <View style={styles.section}>
              <TurnkeySummary
                skuSet={skuSet}
                tiers={tiers}
                recommendedTierIdx={recommendedTierIdx}
                serviceFees={serviceFees}
                layout={layout}
                foldFees={false}
                freightAtCost={false}
                allInUnit
                partial
                lede="All-in turnkey total per tier. One tier is still pending a final line price, noted below."
              />
            </View>
            <View style={styles.sectionTight} wrap={false}>
              <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
              <NotesBlock notes={quote.customer_facing_notes} />
              <HowToAccept />
            </View>
          </View>
        </Page>
      </Document>
    );
  }

  // itemized — single Page; automatic wrap handles the 6-SKU
  // overflow into page 2. **DO NOT pre-split** (CD's slice(0,4)
  // / slice(4) is review chrome per audit §5 LOUD CALL-OUT).
  return (
    <Document>
      <Page size="LETTER" style={styles.sheet}>
        <PageChrome vendor={vendor} quote={quote} />
        <View style={styles.flow}>
          <Masthead vendor={vendor} quote={quote} />
          <Parties vendor={vendor} customer={customer} />
          <View style={styles.section}>
            <PartialItemizedHead />
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
              foldFees={false}
              freightAtCost={false}
              allInUnit
            />
            <PricingFoot partial />
          </View>
          <View style={styles.section} wrap={false}>
            <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
            <NotesBlock notes={quote.customer_facing_notes} />
            <HowToAccept />
          </View>
        </View>
      </Page>
    </Document>
  );
}

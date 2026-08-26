// Slice 11 Step 3 — Pattern-30 verbatim port of CD's GrandTotalRow.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:148-181 (component) + styles.css:356-393 (CSS).
//
// Pattern 30: structure preserved 1:1. Inline `<span>` chains
// (CD 166-178) translate to nested `<Text>` children inside the
// containing `<Text>` per react-pdf inline composition.
//
// CD's `&nbsp;` (pdf-render.jsx:173) → `" "` non-breaking space
// literal (spike §1 audit row "Per&nbsp;unit"). Spike §1 confirms
// react-pdf treats Unicode escapes natively.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports. Money strings from sell-side totals only.

import { Text, View } from "@react-pdf/renderer";

import { money, tierGrand, unit } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import type {
  CpdfPdfLayout,
  CpdfServiceFee,
  CpdfSku,
  CpdfTier,
} from "./customer-pdf-types";

export function GrandTotalRow({
  skuSet,
  tiers,
  recommendedTierIdx,
  serviceFees,
  layout,
  foldFees,
  freightAtCost,
  allInUnit,
}: {
  skuSet: ReadonlyArray<CpdfSku>;
  tiers: ReadonlyArray<CpdfTier>;
  recommendedTierIdx: number | null;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  layout: CpdfPdfLayout;
  foldFees: boolean;
  freightAtCost: boolean;
  allInUnit: boolean;
}) {
  // SINGLE-TIER LAYOUT picks which tier to SHOW. With no recommendation it
  // shows the first — a display choice, not a claim that the tier is
  // recommended. Nothing in this component says the word.
  const soloIdx = recommendedTierIdx ?? 0;
  const isSingle = layout === "single_tier";
  const cols = isSingle
    ? [{ tier: tiers[soloIdx], ti: soloIdx }]
    : tiers.map((t, i) => ({ tier: t, ti: i }));
  const colData = cols.map(({ tier, ti }) => {
    const grand = tierGrand(skuSet, tiers, ti, foldFees, serviceFees);
    return {
      tier,
      ti,
      ...grand,
      rec: !isSingle && tier.recommended === true,
      // "No SKU priced at all in this tier." Computed ONCE and read by both the
      // turnkey total and the component rows above it. Held apart, the two
      // drifted immediately: the components tested `perUnit === null` while the
      // total tested `hasUnpriced && perUnit == null`, so a tier could print
      // figures above a total that said it was unpriced.
      fullyUnpriced: grand.hasUnpriced && grand.perUnit == null,
    };
  });
  return (
    // Slice 11 Step 3 Fix 2 (CA 2026-06-30): GrandTotalRow (label
    // column + per-tier figures + PER UNIT/ALL-IN sub-legend) is an
    // atomic readable unit; never split across pages.
    <View wrap={false}>
      {/* ── What the turnkey total is made of ──────────────────────────
          Parity with the live customer document, which is where this block
          was designed. The preview and this artifact disagreed: the preview
          showed the two components, the PDF showed only the total — so an
          operator reviewed a different commercial statement from the one the
          customer received.

          Inside `wrap={false}` with the total, because the components and the
          figure they compose are one readable unit and must never be split
          across a page break.

          NO ARITHMETIC. Both figures are read from `tier.money`, composed once
          upstream, exactly as the total above them is. Nothing here sums.

          Gated on `foldFees`, which is `view.foldFeesIntoTotal` — the SAME flag
          the live document gates on, and the same one that makes the total
          above `turnkeyTotal` rather than `goodsTotal`. When it is false the
          total IS the goods figure and there are no separate charges, so both
          rows would state nothing: one restating the total, one reading zero. */}
      {foldFees && (
        <View>
          {[
            { key: "Unit-price subtotal", pick: (m: CpdfTier["money"]) => m.goodsTotal },
            { key: "One-time fees", pick: (m: CpdfTier["money"]) => m.feesTotal },
          ].map((row) => (
            <View key={row.key} style={styles.componentRow}>
              <View style={styles.cProd}>
                <Text style={styles.componentK}>{row.key}</Text>
              </View>
              {colData.map(({ tier, ti, rec, fullyUnpriced }) => (
                <View
                  key={tier.id}
                  style={[styles.cNum, rec ? styles.cRec : {}]}
                >
                  <Text
                    style={[
                      styles.componentNum,
                      rec ? styles.componentNumRec : {},
                    ]}
                  >
                    {/* A tier whose total reads "total on request" has no known
                        subtotal either. $0.00 would tell the customer the goods
                        cost nothing, which is the opposite of not-yet-priced
                        (OD-005). Same condition the total uses, so the two can
                        never disagree about whether the tier is priced. */}
                    {fullyUnpriced ? "—" : money(row.pick(tiers[ti].money))}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      <View style={styles.grand}>
        {/* label column (CD `pdf-render.jsx:159`) */}
        <View style={styles.cProd}>
          <Text style={styles.gLabel}>Turnkey total</Text>
          <Text style={styles.gSub}>all-in for this tier{"’"}s order</Text>
        </View>
        {/* per-tier figures */}
        {colData.map(({ tier, total, hasUnpriced, perUnit, rec, fullyUnpriced }) => {
          // Slice 11 matrix Fix 2 (2026-07-27) — three-state total
          // render, matching TurnkeySummary tier_table for consistency:
          //   - all priced       → "$X"
          //   - some priced/unpriced → "from $X"  (X = priced sum + fees)
          //   - fully unpriced   → "total on request" (no dollar)
          //
          // `perUnit === null` is tierGrand's signal for "no SKUs priced
          // at all in this tier" (units = pricedCount * qty = 0 → per-
          // unit undefined). Previously rendered "from $0.00" for the
          // fully-unpriced tier — nonsensical customer copy; now aligns
          // with the dedicated turnkey_only page's "total on request".
          return (
            <View
              key={tier.id}
              style={[
                styles.cNum,
                rec ? styles.cRec : {},
                rec ? styles.grandCRec : {},
              ]}
            >
              {fullyUnpriced ? (
                <Text style={styles.grandNum}>total on request</Text>
              ) : hasUnpriced ? (
                <Text style={styles.grandNum}>
                  <Text style={styles.grandNumFrom}>{"from "}</Text>
                  {money(total)}
                </Text>
              ) : (
                <Text style={styles.grandNum}>{money(total)}</Text>
              )}
              {perUnit != null && (
                <Text
                  style={[
                    styles.grandUnit,
                    rec ? styles.grandUnitRec : {},
                  ]}
                >
                  {hasUnpriced ? "from " : ""}
                  {unit(perUnit)}
                  <Text style={styles.grandUnitPer}> /unit</Text>
                </Text>
              )}
            </View>
          );
        })}
      </View>
      {/* Notes column under the grand row (CD `pdf-render.jsx:172`).
          PER UNIT / INCLUDES / FROM removed 2026-08-20: those legends
          explained how to READ the table rather than stating a commercial
          fact, and their wrapping was colliding at preview width.
          ALL-IN and PLUS deliberately REMAIN. They are inclusion and
          exclusion disclosures — what the unit price already covers, and
          what the turnkey total does not — which the customer relies on
          commercially. Dropping PLUS in particular would silently remove
          notice that outbound freight is billed on top. */}
      {(allInUnit || freightAtCost) && (
        <View style={styles.grandNotes}>
          {allInUnit && (
            <Text style={styles.grandNote}>
              <Text style={styles.grandNoteK}>{"All-in   ".toUpperCase()}</Text>
              Setup, tooling, freight, duty {"&"} tariffs are landed in the
              unit price shown — the total is what you pay.
            </Text>
          )}
          {freightAtCost && (
            <Text style={[styles.grandNote, styles.grandNoteFreight]}>
              <Text style={styles.grandNoteK}>{"Plus   ".toUpperCase()}</Text>
              Outbound freight — billed separately at cost (itemized below);
              not included in the turnkey total.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

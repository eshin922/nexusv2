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
  const colData = cols.map(({ tier, ti }) => ({
    tier,
    ti,
    ...tierGrand(skuSet, tiers, ti, foldFees, serviceFees),
    rec: !isSingle && tier.recommended === true,
  }));
  return (
    // Slice 11 Step 3 Fix 2 (CA 2026-06-30): GrandTotalRow (label
    // column + per-tier figures + PER UNIT/ALL-IN sub-legend) is an
    // atomic readable unit; never split across pages.
    <View wrap={false}>
      <View style={styles.grand}>
        {/* label column (CD `pdf-render.jsx:159`) */}
        <View style={styles.cProd}>
          <Text style={styles.gLabel}>Turnkey total</Text>
          <Text style={styles.gSub}>all-in for this tier{"’"}s order</Text>
        </View>
        {/* per-tier figures */}
        {colData.map(({ tier, total, hasUnpriced, perUnit, rec }) => {
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
          const fullyUnpriced = hasUnpriced && perUnit == null;
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

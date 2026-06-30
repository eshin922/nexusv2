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

import { money, serviceFeesTotal, tierGrand, unit } from "./customer-pdf-helpers";
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
  recommendedTierIdx: number;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  layout: CpdfPdfLayout;
  foldFees: boolean;
  freightAtCost: boolean;
  allInUnit: boolean;
}) {
  const isSingle = layout === "single_tier";
  const cols = isSingle
    ? [{ tier: tiers[recommendedTierIdx], ti: recommendedTierIdx }]
    : tiers.map((t, i) => ({ tier: t, ti: i }));
  const colData = cols.map(({ tier, ti }) => ({
    tier,
    ti,
    ...tierGrand(skuSet, tiers, ti, foldFees, serviceFees),
    rec: !isSingle && tier.recommended === true,
  }));
  const anyUnpriced = colData.some((c) => c.hasUnpriced);

  return (
    <View>
      <View style={styles.grand}>
        {/* label column (CD `pdf-render.jsx:159`) */}
        <View style={styles.cProd}>
          <Text style={styles.gLabel}>Turnkey total</Text>
          <Text style={styles.gSub}>all-in for this tier{"’"}s order</Text>
        </View>
        {/* per-tier figures */}
        {colData.map(({ tier, total, hasUnpriced, perUnit, rec }) => (
          <View
            key={tier.id}
            style={[
              styles.cNum,
              rec ? styles.cRec : {},
              rec ? styles.grandCRec : {},
            ]}
          >
            {hasUnpriced ? (
              <Text style={styles.grandNum}>
                <Text style={styles.grandNumFrom}>from</Text>
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
        ))}
      </View>
      {/* notes column under the grand row (CD `pdf-render.jsx:172`) */}
      <View style={styles.grandNotes}>
        <Text style={styles.grandNote}>
          <Text style={styles.grandNoteK}>{"Per unit".toUpperCase()}</Text>
          The blended all-in unit price across the basket at that tier — the
          turnkey total divided by units shipped.
        </Text>
        {allInUnit && (
          <Text style={styles.grandNote}>
            <Text style={styles.grandNoteK}>{"All-in".toUpperCase()}</Text>
            Setup, tooling, freight, duty {"&"} tariffs are landed in the unit
            price shown — the total is what you pay.
          </Text>
        )}
        {foldFees && (
          <Text style={styles.grandNote}>
            <Text style={styles.grandNoteK}>{"Includes".toUpperCase()}</Text>
            One-time project {"&"} SKU fees of{" "}
            <Text style={styles.grandNoteAmt}>
              {money(serviceFeesTotal(serviceFees))}
            </Text>
            , folded into the total above and itemized below.
          </Text>
        )}
        {freightAtCost && (
          <Text style={[styles.grandNote, styles.grandNoteFreight]}>
            <Text style={styles.grandNoteK}>{"Plus".toUpperCase()}</Text>
            Outbound freight — billed separately at cost (itemized below); not
            included in the turnkey total.
          </Text>
        )}
        {anyUnpriced && (
          <Text style={styles.grandNote}>
            <Text style={styles.grandNoteK}>{"From".toUpperCase()}</Text>
            Totals exclude lines marked {"“"}quote on request{"”"}{" "}
            (CAP-60 · Tier 1); the final total issues once that line is priced.
          </Text>
        )}
      </View>
    </View>
  );
}

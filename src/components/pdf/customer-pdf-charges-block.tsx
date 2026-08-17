// Slice 11 Step 3 — Pattern-30 verbatim port of CD's ChargesBlock.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:260-288 (component) + styles.css:265-287 (CSS).
//
// Pattern 30: structure preserved 1:1. `.pp-charges` is a
// kept-together block; consumer applies `wrap={false}` on the
// containing `<View>` per audit §4 + spike §1.
//
// `text-transform: uppercase` on the group label (styles.css:269)
// → `.toUpperCase()` at render time.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports. Per-unit freight amounts are landed
// sell-side numerics from `freight_lines[i].tier_amounts`.

import { Text, View } from "@react-pdf/renderer";

import { money, qtyK, unit } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import type {
  CpdfFreightLine,
  CpdfServiceFee,
  CpdfTier,
} from "./customer-pdf-types";

export function ChargesBlock({
  tiers,
  recommendedTierIdx,
  serviceFees,
  freightLines,
}: {
  tiers: ReadonlyArray<CpdfTier>;
  recommendedTierIdx: number | null;
  serviceFees: ReadonlyArray<CpdfServiceFee>;
  freightLines: ReadonlyArray<CpdfFreightLine>;
}) {
  // The per-unit freight basis. Named in the sentence below, so it must be a
  // tier that exists — but it is NOT a recommendation. With no recommended
  // tier the block states which tier the amounts are shown for and claims
  // nothing about which one to buy.
  const basisIdx = recommendedTierIdx ?? 0;
  const basisTier = tiers[basisIdx];
  return (
    <View style={styles.charges} wrap={false}>
      <Text style={styles.eyebrow}>{"Additional charges".toUpperCase()}</Text>
      {/* Proof-5 repair (2026-08-11) — the block's own title and subtitle are
          freight-specific statements and were unconditional, so a quote with
          service fees and no freight lines announced "pass-through freight" and
          then explained how freight amounts are shown, while showing none. Same
          defect as the `freightAtCost={hasCharges}` gate, one layer over.
          Gated on the same evidence: the freight lines actually in the model. */}
      <Text style={styles.h2}>
        One-time fees
        {freightLines.length > 0 ? ` & pass-through freight` : ""}
      </Text>
      {freightLines.length > 0 && (
        <Text style={styles.chargeSub}>
          Freight amounts shown landed per unit for {basisTier.full} (
          {qtyK(basisTier.quantity)} units). Per-tier amounts available on request.
        </Text>
      )}
      {/* Slice 11 matrix Fix 1c (2026-07-27) — only render the fee
          section header when there are actual fee line items. Same
          shape as the C2-B gate: an unconditional header with zero
          rows beneath reads as a broken render, not an empty state.
          Symmetric with the freight header below. */}
      {serviceFees.length > 0 && (
        <>
          <Text style={styles.chargeGroupLabel}>
            {"Project & SKU fees · one-time".toUpperCase()}
          </Text>
          {serviceFees.map((sf) => (
            <View key={sf.id} style={styles.chargeRow}>
              <View style={styles.cLabel}>
                <Text style={styles.cLabelT}>{sf.label}</Text>
                <Text style={styles.cLabelS}>{sf.sub}</Text>
              </View>
              <Text style={styles.cQty}>{sf.qty_label}</Text>
              <Text style={styles.cAmt}>{money(sf.amount)}</Text>
            </View>
          ))}
        </>
      )}
      {freightLines.length > 0 && (
        <Text style={styles.chargeGroupLabel}>
          {"Pass-through freight · billed at cost".toUpperCase()}
        </Text>
      )}
      {freightLines.map((fl) => (
        <View key={fl.id} style={styles.chargeRow}>
          <View style={styles.cLabel}>
            <Text style={styles.cLabelT}>{fl.label}</Text>
            <Text style={styles.cLabelS}>{fl.sub}</Text>
          </View>
          <Text style={styles.cQty}>{fl.qty_label}</Text>
          <Text style={styles.cAmt}>
            {unit(fl.tier_amounts[basisIdx])}
            <Text style={styles.cAmtPer}>/unit</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

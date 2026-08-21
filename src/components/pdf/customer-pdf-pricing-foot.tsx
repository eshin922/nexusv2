// Slice 11 Step 3 — Pattern-30 verbatim port of CD's PricingFoot.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:250-257 (component) + styles.css:258-262 (CSS).
//
// Pattern 30: structure preserved 1:1. CD's `<span>` chains map to
// nested `<Text>` children inside the row `<View>`.
//
// ── PATTERN 45 · ONE LINE OF THIS PORT WAS NOT COPY ───────────────────────
//
// The verbatim port carried CD's mock sentence into production unchanged:
//
//     "Per-unit and extended pricing, in USD. ★ T2 is our recommended
//      first-PO tier."
//
// "T2" was a literal. Every customer PDF the firm has produced told the
// customer we recommend Tier 2 — on quotes with no recommended tier at all,
// and on quotes recommending some other tier. It sat one line below a
// correctly-governed sentence saying the opposite, or saying nothing.
//
// Found on ZZ-VALIDATION-pricing-authority: all four tiers `recommended =
// false`, Pricing header reading "None chosen", PDF page 1 asserting T2.
//
// Pattern 30 says adopt the design source verbatim. It has never said adopt
// its DATA verbatim, and a tier label is data wearing copy's clothes. The
// tell is that the mock's own value survived into a system that computes it:
// nothing here ever consulted the quote.
//
// So the recommendation now comes from the same governed input the lede in
// customer-pdf-document uses, and null omits the sentence — the two cannot
// disagree because there is only one source. The ★ stays with the sentence
// because it is the legend for the column marker.

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./customer-pdf-styles";

export function PricingFoot({
  partial = false,
  recommendedTierFullLabel = null,
}: {
  partial?: boolean;
  /**
   * Full label of the recommended tier, e.g. "Tier 2". Null when the quote
   * recommends none — the sentence is then omitted rather than guessed. Never
   * derive this from tier order or index: position is not a recommendation.
   */
  recommendedTierFullLabel?: string | null;
}) {
  return (
    <View style={styles.tableFoot}>
      {/* "Per-unit and extended pricing, in USD." removed 2026-08-20 — a
          reading instruction, not a commercial statement, and it was
          colliding with the partial-pricing line at preview width.
          The ★ sentence stays: it names the recommended tier from the
          governed quote input (see the Pattern 45 note above) and is a
          commercial recommendation the customer acts on. */}
      {recommendedTierFullLabel !== null && (
        <Text>
          {`★ ${recommendedTierFullLabel} is our recommended first-PO tier.`}
        </Text>
      )}
      {partial && (
        <Text>
          quote on request — pricing finalizes once the noted milestone clears.
        </Text>
      )}
    </View>
  );
}

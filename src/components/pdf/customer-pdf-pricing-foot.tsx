// Slice 11 Step 3 — Pattern-30 verbatim port of CD's PricingFoot.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:250-257 (component) + styles.css:258-262 (CSS).
//
// Pattern 30: structure preserved 1:1. CD's `<span>` chains map to
// nested `<Text>` children inside the row `<View>`.
//
// Pattern 45 boundary: pure render of static copy + a derived
// `partial` flag; zero costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./customer-pdf-styles";

export function PricingFoot({ partial = false }: { partial?: boolean }) {
  return (
    <View style={styles.tableFoot}>
      <Text>
        Per-unit and extended pricing, in USD. ★ T2 is our recommended first-PO
        tier.
      </Text>
      {partial && (
        <Text>
          quote on request — pricing finalizes once the noted milestone clears.
        </Text>
      )}
    </View>
  );
}

// Slice 11 Step 3 — Pattern-30 verbatim port of CD's Masthead.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:41-55 (component) + styles.css:133-154 (CSS).
//
// Pattern 30: structure (DOM hierarchy, child order, class names)
// preserved 1:1. Substitutions: <div> → <View>, <span> → <Text>,
// <strong> → <Text style={vMetaStrong}>.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { longDate } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import type { CpdfQuote, CpdfVendor } from "./customer-pdf-types";

export function Masthead({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <View style={styles.masthead}>
      {/* .v-id (CD `pdf-render.jsx:44`) */}
      <View style={styles.vId}>
        <Text style={styles.vName}>{vendor.name}</Text>
        <Text style={styles.vSub}>{vendor.sub}</Text>
      </View>
      {/* .v-meta (CD `pdf-render.jsx:48`) */}
      <View style={styles.vMeta}>
        <Text style={styles.vMetaQnum}>{quote.quote_number}</Text>
        <Text style={styles.vMetaLine}>
          <Text style={styles.vMetaStrong}>Issued</Text>
          {" · "}
          {longDate(quote.issued_date)}
        </Text>
        <Text style={styles.vMetaLine}>
          <Text style={styles.vMetaStrong}>Valid until</Text>
          {" · "}
          {longDate(quote.valid_until)}
        </Text>
      </View>
    </View>
  );
}

// Slice 11 Step 3 — Pattern-30 verbatim port of CD's RunHead + Footer.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:317-332 (components) + styles.css:321-341 (CSS).
//
// Pattern 30: structure preserved 1:1 with mechanical substitutions:
//   - CD's `position: absolute` (styles.css:322/335) → react-pdf
//     `fixed` prop on the `<View>` (spike §1 + audit §4 explicit map).
//   - CD's prop shape (`page`, `pages`) → react-pdf's render callback
//     `({ pageNumber, totalPages }) => ...`. CD documented this
//     mapping in styles.css:5-8.
//   - `text-transform: uppercase` (styles.css:329-330, 341) →
//     `.toUpperCase()` at render time.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./customer-pdf-styles";
import type { CpdfQuote, CpdfVendor } from "./customer-pdf-types";

/**
 * Running header — fires on pages 2+ (continuation pages).
 * CD `pdf-render.jsx:317-324`. JSX renders the inner band; the
 * `fixed` prop + render callback live on the consumer (`Sheet`).
 */
export function RunHeadInner({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <View style={styles.runhead}>
      <Text style={styles.runheadL}>
        <Text style={styles.runheadLStrong}>
          {vendor.name.toUpperCase()}
        </Text>
        {" · "}
        {quote.quote_number}
      </Text>
      <Text style={styles.runheadR}>{"Quotation · continued".toUpperCase()}</Text>
    </View>
  );
}

/**
 * Footer — fires on every page with "Page X of Y" pagination.
 * CD `pdf-render.jsx:325-332`. JSX renders the inner band; the
 * `fixed` prop lives on the consumer.
 *
 * react-pdf note: `View.render` only exposes `pageNumber` +
 * `subPageNumber` per the type declaration; `Text.render` exposes
 * `totalPages` + `subPageTotalPages`. The page-count string uses
 * Text's render callback so the type stays honest. Left-hand
 * vendor info stays static.
 */
export function FooterInner({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <View style={styles.footer}>
      <Text>
        <Text style={styles.footerLStrong}>
          {vendor.name.toUpperCase()}
        </Text>
        {" · "}
        {quote.quote_number}
      </Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`
        }
      />
    </View>
  );
}

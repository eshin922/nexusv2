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
// **Step 3 Fix 2 follow-up (2026-06-30):** the original port nested
// `<View fixed>` around `<View style={styles.runhead}>` /
// `<View style={styles.footer}>`. The inner Views carry
// `position: absolute` + offsets (top/bottom). react-pdf treats the
// inner's positioning as relative to the OUTER fixed View — which
// has no height/dimensions, so `bottom: 22.5pt` had nothing to
// anchor against and the footer rendered at the page TOP instead of
// the page bottom. The correct pattern is `fixed` + positioning on
// the SAME View. Refactored: chrome components export `PageRunHead`
// + `PageFooter` (each is the fixed View itself), consumed directly
// by `customer-pdf-document.tsx` PageChrome.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./customer-pdf-styles";
import type { CpdfQuote, CpdfVendor } from "./customer-pdf-types";

/**
 * Running header — fires on pages 2+ (continuation pages).
 * CD `pdf-render.jsx:317-324`.
 *
 * The `fixed` prop + `styles.runhead` positioning live on the
 * SAME View; combining them is the canonical react-pdf pattern.
 * The `render` callback returns `null` on page 1 so the runhead
 * doesn't draw there.
 */
export function PageRunHead({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <View
      fixed
      style={styles.runhead}
      render={({ pageNumber }) =>
        pageNumber > 1 ? (
          <>
            <Text style={styles.runheadL}>
              <Text style={styles.runheadLStrong}>
                {vendor.name.toUpperCase()}
              </Text>
              {" · "}
              {quote.quote_number}
            </Text>
            <Text style={styles.runheadR}>
              {"Quotation · continued".toUpperCase()}
            </Text>
          </>
        ) : null
      }
    />
  );
}

/**
 * Footer — fires on every page with "Page X of Y" pagination.
 * CD `pdf-render.jsx:325-332`.
 *
 * The `fixed` prop + `styles.footer` positioning (bottom: 22.5pt)
 * live on the SAME View. react-pdf type note: `<View>.render` only
 * exposes `pageNumber` + `subPageNumber`; `<Text>.render` exposes
 * `totalPages` + `subPageTotalPages`. The page-count string uses
 * Text's render callback so the type stays honest. Left-hand vendor
 * info stays static.
 */
export function PageFooter({
  vendor,
  quote,
}: {
  vendor: CpdfVendor;
  quote: CpdfQuote;
}) {
  return (
    <View fixed style={styles.footer}>
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

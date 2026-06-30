// Slice 11 Step 3 — Pattern-30 verbatim port of CD's TermsBlock,
// NotesBlock, HowToAccept.
//
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:291-314 (components) + styles.css:290-318 (CSS).
//
// Pattern 30: structure preserved 1:1. `.pp-terms` + nested
// `.pp-term` cells map to flex-wrap container + 50% flex children.
// Per audit §4 the entire (eyebrow + h2 + Terms + Notes +
// HowToAccept) group is a kept-together unit — consumer wraps the
// composition in a `<View wrap={false}>`.
//
// `text-transform: uppercase` on labels (styles.css:298, 311) →
// `.toUpperCase()` at render time.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { longDate } from "./customer-pdf-helpers";
import { styles } from "./customer-pdf-styles";
import type { CpdfQuote } from "./customer-pdf-types";

export function TermsBlock({
  quote,
  incoterms,
}: {
  quote: CpdfQuote;
  /** Adapter selects between `incoterms_bundled` /
   * `incoterms_passthrough` (CD passes the chosen string in). */
  incoterms: string;
}) {
  return (
    <View style={styles.terms}>
      <View style={styles.term}>
        <Text style={styles.termLabel}>{"Valid until".toUpperCase()}</Text>
        <Text style={styles.termValue}>{longDate(quote.valid_until)}</Text>
      </View>
      <View style={styles.term}>
        <Text style={styles.termLabel}>{"Payment terms".toUpperCase()}</Text>
        <Text style={styles.termValue}>{quote.payment_terms}</Text>
      </View>
      <View style={styles.term}>
        <Text style={styles.termLabel}>{"Lead time".toUpperCase()}</Text>
        <Text style={styles.termValue}>{quote.lead_time}</Text>
      </View>
      <View style={styles.term}>
        <Text style={styles.termLabel}>{"Incoterms".toUpperCase()}</Text>
        <Text style={styles.termValue}>{incoterms}</Text>
      </View>
    </View>
  );
}

export function NotesBlock({ notes }: { notes: string | null }) {
  if (notes == null || notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      <Text style={styles.notesLabel}>{"Notes".toUpperCase()}</Text>
      <Text style={styles.notesP}>{notes}</Text>
    </View>
  );
}

export function HowToAccept() {
  return (
    <View style={styles.accept}>
      <Text style={styles.h3}>How to accept</Text>
      <Text style={styles.acceptP}>
        Reply to this quote with the tier and quantity you{"'"}d like to proceed
        on. We{"'"}ll issue a PO confirmation and production schedule within 2
        business days of acceptance.
      </Text>
    </View>
  );
}

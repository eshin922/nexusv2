// Slice 11 Step 3 — Pattern-30 verbatim port of CD's TermsBlock,
// NotesBlock, HowToAccept.
//
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:291-314 (components) + styles.css:290-318 (CSS).
//
// Pattern 30: structure preserved 1:1. `.pp-terms` + nested
// `.pp-term` cells map to flex-wrap container + 50% flex children.
// The sections paginate independently. Notes, conditions, and acceptance copy
// each stay together, without forcing the whole group onto a new page.
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

function VerbatimLines({ value }: { value: string }) {
  return (
    <View>
      {value.split(/\r\n|\r|\n/).map((line, index) => (
        <Text key={index} style={styles.notesP}>
          {line || "\u00a0"}
        </Text>
      ))}
    </View>
  );
}

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

/**
 * Customer Terms & Conditions.
 *
 * Absent when unconfigured — no heading, no placeholder. A Terms heading over
 * nothing tells the customer a clause exists and then declines to state it,
 * which is worse than silence on the one document the firm does not get to
 * clarify afterwards (Pattern 45).
 */
export function TcsBlock({ tcs }: { tcs: string | null }) {
  if (tcs == null || tcs.length === 0) return null;
  return (
    <View style={styles.notes} wrap={false}>
      <Text style={styles.notesLabel}>{"Terms & conditions".toUpperCase()}</Text>
      <VerbatimLines value={tcs} />
    </View>
  );
}

export function NotesBlock({ notes }: { notes: string | null }) {
  if (notes == null || notes.length === 0) return null;
  return (
    <View style={styles.notes} wrap={false}>
      <Text style={styles.notesLabel}>{"Notes".toUpperCase()}</Text>
      <VerbatimLines value={notes} />
    </View>
  );
}

export function HowToAccept() {
  return (
    <View style={styles.accept} wrap={false}>
      <Text style={styles.h3}>How to accept</Text>
      <Text style={styles.acceptP}>
        Reply to this quote with the tier and quantity you{"'"}d like to proceed
        on. We{"'"}ll issue a PO confirmation and production schedule within 2
        business days of acceptance.
      </Text>
    </View>
  );
}

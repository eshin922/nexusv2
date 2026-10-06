// The quote masthead shares the exact subsidiary logo used by the sandbox
// NetSuite purchase order. Its quote metadata still follows the customer PDF
// layout; the logo replaces only the former text wordmark and tagline.

import { Image, Text, View } from "@react-pdf/renderer";

import { DPS_LOGO_DATA_URI } from "@/lib/dps-logo-data";
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
      {/* Subsidiary mark, sized to the purchase-order masthead. */}
      <View style={styles.vId}>
        <Image src={DPS_LOGO_DATA_URI} style={styles.vLogo} />
      </View>
      {/* .v-meta (CD `pdf-render.jsx:48`) */}
      <View style={styles.vMeta}>
        {/* Omitted rather than emptied when publication has not governed a
            number -- the same grammar the project-title line below already
            uses, and the same answer `CustomerViewLive` gives on the HTML
            twin: "absence is rendered as absence. No invented number or
            date." The masthead is a flex column, so the line collapses. */}
        {quote.quote_number !== null && quote.quote_number.length > 0 && (
          <Text style={styles.vMetaQnum}>{quote.quote_number}</Text>
        )}
        {/* Nexus extension per Pattern 39 — project title line.
            Null-safe: absent → line drops cleanly, hierarchy
            reverts to CD canonical. */}
        {quote.project_title != null && quote.project_title.length > 0 && (
          <Text style={styles.vMetaTitle}>{quote.project_title}</Text>
        )}
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

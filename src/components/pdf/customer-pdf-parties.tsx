// Slice 11 Step 3 — Pattern-30 verbatim port of CD's Parties.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:58-77 (component) + styles.css:157-167 (CSS).
//
// Pattern 30: structure preserved 1:1. Null-guards on optional
// customer subfields (contact / role / email / address) per brief
// §3.A (email NULL-safe) + §3.G (contact·role separator drops when
// either is missing). CD's fixture renders the fields raw; the
// production type permits NULL on all four — port-time null-guards
// keep the render PDF-safe even when the adapter lands them.
//
// Pattern 45 boundary: prop types from `customer-pdf-types`; zero
// costing-surface imports.

import { Text, View } from "@react-pdf/renderer";

import { styles } from "./customer-pdf-styles";
import type { CpdfCustomer, CpdfVendor } from "./customer-pdf-types";

export function Parties({
  vendor,
  customer,
}: {
  vendor: CpdfVendor;
  customer: CpdfCustomer;
}) {
  // Brief §3.G — render present parts only; drop separator if missing.
  const contactLine = [customer.contact, customer.role]
    .filter((s) => s != null && s.length > 0)
    .join(" · ");

  return (
    <View style={styles.parties}>
      {/* "Prepared for" — customer party (CD `pdf-render.jsx:61`) */}
      <View style={styles.party}>
        <Text style={styles.partyLabel}>{"Prepared for".toUpperCase()}</Text>
        <Text style={styles.pname}>{customer.name}</Text>
        {contactLine.length > 0 && (
          <Text style={styles.pline}>{contactLine}</Text>
        )}
        {customer.email != null && customer.email.length > 0 && (
          <Text style={styles.pline}>{customer.email}</Text>
        )}
        {customer.address != null && customer.address.length > 0 && (
          <Text style={styles.pline}>{customer.address}</Text>
        )}
      </View>
      {/* "Prepared by" — vendor party (CD `pdf-render.jsx:68`) */}
      <View style={styles.party}>
        <Text style={styles.partyLabel}>{"Prepared by".toUpperCase()}</Text>
        <Text style={styles.pname}>{vendor.name}</Text>
        <Text style={styles.pline}>{vendor.contact_name}</Text>
        <Text style={styles.pline}>
          {vendor.contact_email}
          {vendor.contact_phone != null && vendor.contact_phone.length > 0
            ? ` · ${vendor.contact_phone}`
            : ""}
        </Text>
        <Text style={styles.pline}>{vendor.address}</Text>
      </View>
    </View>
  );
}

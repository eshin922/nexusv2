// Slice 11 Step 3b — Pattern-30 verbatim port of the spec addendum
// component tree to react-pdf primitives.
//
// Source(s):
//   - docs/design-prototypes/dist/qw_a1v2.jsx `AddendumPage`
//     (L1019-1089) — the canonical shipped prototype.
//   - src/styles/r-a1v2-setup.css L658+ — CSS canon (visual SoT
//     per the brief).
//   - src/components/pdf/pdf-addendum.tsx — the impl-6 DOM
//     realization of the same design; used as a structural
//     reference for component composition + Pattern 45 boundary
//     calls (e.g., version-stamp omission).
//
// Pattern 30 discipline: structure preserved 1:1 with the
// mandatory mechanical substitutions enumerated in the styles
// file (`./customer-pdf-addendum-styles.ts`). Where impl-6 differs
// from the prototype, this port honors impl-6 (Pattern 45 boundary
// guard already vetted impl-6's omissions; redoing those calls
// here would re-litigate boundary work).
//
// Specifically inherited from impl-6 (NOT in the prototype):
//   - `.version-stamp` (`v{leaf.current_version}`) on
//     `.leaf-block-head` — omitted per "Customer-view boundary
//     guard" (version_number is internal versioning).
//   - The `clientName` subtitle reads "Leaf specs · for {name}"
//     (impl-6 wording) rather than the prototype's "Leaf specs
//     pinned at send · for {client}" — the "pinned at send"
//     phrasing implies the version stamp story that boundary
//     deferred.
//   - The header meta reads simply "Quotation" rather than the
//     prototype's "Quotation · DPS-2418" — quote number is
//     surfaced in the page footer instead, parallel to how the
//     pricing pages handle it.
//
// Specifically inherited from the prototype (NOT in impl-6):
//   - The `.pdf-pagenum` page footer ("VENDOR · QUOTE# · PAGE X
//     OF Y") — impl-6 uses `<PdfPage>` which lacks an addendum
//     pdf-pagenum. Honoring the prototype here because (a) the
//     CSS canon includes `.a1v2-pdf-paper .pdf-pagenum` as a
//     load-bearing selector, (b) the pricing pages already have
//     "Page X of Y" footers and the addendum should match for
//     reader continuity.
//
// Pattern 45 boundary safe: imports limited to react,
// @react-pdf/renderer, @/lib/addendum-loader (types only), and
// sibling pdf/* modules. NO costing-surface / schema / actions
// reads.

import type { ReactNode } from "react";

import { Page, Text, View } from "@react-pdf/renderer";

import type {
  AddendumAssembly,
  AddendumLeaf,
  AddendumLeafField,
  QuoteAddendumData,
} from "@/lib/addendum-loader";

import { addendumStyles } from "./customer-pdf-addendum-styles";
import type {
  CpdfCustomer,
  CpdfQuote,
  CpdfVendor,
} from "./customer-pdf-types";

// ─── Top-level export ───────────────────────────────────────
//
// Caller wires the return value into the State composition's
// `addendumPages` slot in `customer-pdf-document.tsx`. Returns
// `null` when the data has no meaningful content (scenario ㉗ —
// all-empty addendum doesn't render). Returns a fragment of one
// `<Page>` per renderable assembly otherwise. Per impl-6
// loader's `renderedAssemblyCount` denominator, the count is
// scoped to assemblies that have at least one leaf — zero-leaf
// ASYs are suppressed by the per-page guard below.

export function CustomerPdfAddendumPages({
  addendum,
  vendor,
  quote,
  customer,
}: {
  addendum: QuoteAddendumData;
  vendor: CpdfVendor;
  quote: CpdfQuote;
  customer: CpdfCustomer;
}): ReactNode {
  if (!addendum.hasMeaningfulContent || addendum.assemblies.length === 0) {
    return null;
  }
  return (
    <>
      {addendum.assemblies.map((asy) =>
        asy.leaves.length === 0 ? null : (
          <AddendumAssemblyPage
            // OD-023 · `groupKey`, not `assemblyId`. A Direct Component is its
            // own group and has no assembly, so the assembly id is null for it
            // and would collide across every Direct on the quote.
            key={asy.groupKey}
            asy={asy}
            vendor={vendor}
            quote={quote}
            customer={customer}
          />
        ),
      )}
    </>
  );
}

// ─── One <Page> per assembly ─────────────────────────────────
//
// Matches impl-6 `AddendumAssemblyPage` shape. Each ASY gets its
// own physical page; if a single ASY's leaf list overflows, the
// react-pdf wrap engine breaks the leaf list (no hard-coded
// splits — matches Step 3's audit §5 LOUD CALL-OUT against
// hardcoded page splits).

function AddendumAssemblyPage({
  asy,
  vendor,
  quote,
  customer,
}: {
  asy: AddendumAssembly;
  vendor: CpdfVendor;
  quote: CpdfQuote;
  customer: CpdfCustomer;
}): ReactNode {
  const clientLabel = customer.name?.trim() || null;
  // impl-6 phrasing: "Leaf specs · for {client}" (vs prototype's
  // "Leaf specs pinned at send · for {client}").
  const subtitle = clientLabel
    ? `Leaf specs · for ${clientLabel}`
    : "Leaf specs";
  return (
    <Page size="LETTER" style={addendumStyles.page}>
      <AddendumPageFooter vendorName={vendor.name} quoteNumber={quote.quote_number} />
      <View style={addendumStyles.flow}>
        <View style={addendumStyles.header}>
          <View style={addendumStyles.headerL}>
            <Text style={addendumStyles.headerTitle}>Product specifications</Text>
            <Text style={addendumStyles.headerSubtitle}>{subtitle}</Text>
          </View>
          <View style={addendumStyles.headerR}>
            <Text style={addendumStyles.headerMeta}>
              {"Quotation".toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={addendumStyles.asy}>
          <View style={addendumStyles.asyHead}>
            <Text style={addendumStyles.asyHeadSku}>{asy.sku}</Text>
            <Text style={addendumStyles.asyHeadName}>{asy.name}</Text>
            <Text style={addendumStyles.asyHeadMeta}>
              {asy.leaves.length} LEAF{asy.leaves.length === 1 ? "" : "S"}
            </Text>
          </View>
          {asy.leaves.map((leaf) => (
            <AddendumLeafBlock key={leaf.leafKey} leaf={leaf} />
          ))}
        </View>
      </View>
    </Page>
  );
}

// ─── Fixed page footer ───────────────────────────────────────
//
// Mirrors prototype L1086 — "VENDOR · QUOTE# · PAGE X OF Y" at
// the bottom-right corner. react-pdf `fixed` prop fires on every
// page; `Text.render` exposes both pageNumber + totalPages.

function AddendumPageFooter({
  vendorName,
  quoteNumber,
}: {
  vendorName: string;
  quoteNumber: string | null;
}): ReactNode {
  return (
    <View style={addendumStyles.pageFooter} fixed>
      <Text
        style={addendumStyles.pageFooterText}
        render={({ pageNumber, totalPages }) =>
          [vendorName, quoteNumber, `Page ${pageNumber} of ${totalPages}`]
            .filter((part): part is string => part !== null)
            .join(" · ")
            .toUpperCase()
        }
      />
    </View>
  );
}

// ─── Per-leaf block ─────────────────────────────────────────
//
// Three discriminated variants mirroring `AddendumLeafVariant`:
//   - untyped → placeholder card with red "untyped" tag
//   - placeholder → placeholder card with type name tag
//   - typed → spec-field rows (with "--" for empty values)

function AddendumLeafBlock({ leaf }: { leaf: AddendumLeaf }): ReactNode {
  const v = leaf.variant;
  if (v.kind === "untyped") {
    return (
      <View style={addendumStyles.leafBlockPlaceholder}>
        <View style={addendumStyles.leafBlockHead}>
          <Text style={addendumStyles.leafBlockHeadName}>{leaf.name}</Text>
          <Text
            style={[
              addendumStyles.leafBlockHeadTypeTag,
              addendumStyles.leafBlockHeadTypeTagUntyped,
            ]}
          >
            {"untyped".toUpperCase()}
          </Text>
        </View>
        <Text style={addendumStyles.placeholderMsg}>
          {"No Product Type set · specs cannot render".toUpperCase()}
        </Text>
      </View>
    );
  }
  if (v.kind === "placeholder") {
    return (
      <View style={addendumStyles.leafBlockPlaceholder}>
        <View style={addendumStyles.leafBlockHead}>
          <Text style={addendumStyles.leafBlockHeadName}>{leaf.name}</Text>
          <Text style={addendumStyles.leafBlockHeadTypeTag}>
            {v.typeName.toUpperCase()}
          </Text>
        </View>
        <Text style={addendumStyles.placeholderMsg}>
          {`${v.typeName} · fields TBD · pending schema`.toUpperCase()}
        </Text>
      </View>
    );
  }
  // Typed-with-schema. Single-section layout per impl-6 + canonical
  // L1068. Both branches of the impl-6 `useWideGrid` switch
  // collapse to one column in react-pdf (only one `.section`
  // child); honoring the wrapper preserves CSS structure even
  // though the grid → flex mapping is a no-op here.
  return (
    <View style={addendumStyles.leafBlock}>
      <View style={addendumStyles.leafBlockHead}>
        <Text style={addendumStyles.leafBlockHeadName}>{leaf.name}</Text>
        <Text style={addendumStyles.leafBlockHeadTypeTag}>
          {v.typeName.toUpperCase()}
        </Text>
      </View>
      <View style={addendumStyles.ppSpGrid}>
        <View style={addendumStyles.section}>
          <Text style={addendumStyles.sectionTitle}>
            {v.typeName.toUpperCase()}
          </Text>
          {v.fields.map((f, i) => (
            <SpecRow
              key={f.key}
              field={f}
              isLast={i === v.fields.length - 1}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Per-spec-field row ─────────────────────────────────────
//
// `lbl` left (100w fixed) + `val` right (flex 1). Empty values
// render "--" in mono italic — `.val.empty` selector per CSS L786.

function SpecRow({
  field,
  isLast,
}: {
  field: AddendumLeafField;
  isLast: boolean;
}): ReactNode {
  const isEmpty = !field.value;
  return (
    <View style={isLast ? [addendumStyles.row, addendumStyles.rowLast] : addendumStyles.row}>
      <Text style={addendumStyles.rowLabel}>{field.label}</Text>
      <Text
        style={
          isEmpty
            ? [addendumStyles.rowValue, addendumStyles.rowValueEmpty]
            : addendumStyles.rowValue
        }
      >
        {field.value ?? "--"}
      </Text>
    </View>
  );
}

import type {
  AddendumAssembly,
  AddendumLeaf,
  QuoteAddendumData,
} from "@/lib/addendum-loader";
import { PdfPage } from "./pdf-page";

// Phase A.1 v2 impl-6 — PDF addendum components (Steps 3-5 folded).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// AddendumPage (lines 1019-1089). Renders one .a1v2-pdf-paper per
// assembly, each containing:
//   - .a1v2-addendum-header with title "Product specifications"
//   - .a1v2-addendum-asy block with asy-head (sku + name + leaf-count)
//     + one .a1v2-leaf-block per attached leaf
//
// Three leaf-block variants per discriminated union:
//   - untyped → .a1v2-leaf-block.placeholder + "No Product Type set ·
//     specs cannot render"
//   - placeholder → .a1v2-leaf-block.placeholder + "{type} · fields
//     TBD · pending schema"
//   - typed → .pp-sp-grid with per-field rows; empty values render
//     "--" per canonical line 1076
//
// Pattern 45 compliance — imports limited to:
//   - React (none needed; pure markup)
//   - @/lib/addendum-loader (types only; loader lives outside boundary)
// NO costing / audit / action / schema imports.
//
// Version stamps (canonical lines 1046, 1056, 1066) intentionally
// omitted; CLAUDE.md "Customer-view boundary guard" excludes
// version_number as internal versioning. Re-disposition with impl-7
// brief if Edward + CA prefer version stamps in customer-facing
// addendum.

export function PdfAddendumAssemblies({
  data,
  clientName,
}: {
  data: QuoteAddendumData;
  clientName: string | null;
}) {
  if (!data.hasMeaningfulContent || data.assemblies.length === 0) return null;
  return (
    <>
      {data.assemblies.map((asy) =>
        asy.leaves.length === 0 ? null : (
          <AddendumAssemblyPage
            key={asy.assemblyId}
            asy={asy}
            clientName={clientName}
          />
        ),
      )}
    </>
  );
}

function AddendumAssemblyPage({
  asy,
  clientName,
}: {
  asy: AddendumAssembly;
  clientName: string | null;
}) {
  // impl-6 patch round (Bug #P) — Use <PdfPage> as the page
  // container instead of `.a1v2-pdf-paper`. Pre-fix the addendum
  // paper used a different CSS class than the pricing PdfPage
  // (different width / margin / padding rules → horizontal
  // misalignment between pricing + addendum pages when stacked
  // in the preview shell).
  //
  // PdfPage produces the canonical `.pdf-page` chrome (R3 token
  // register); addendum-specific content (.a1v2-addendum-header
  // + .a1v2-addendum-asy) renders inside that container. Both
  // pricing + addendum now share the same page dimensions.
  return (
    <PdfPage>
      <div className="a1v2-addendum-header">
        <div>
          <h2 className="title">Product specifications</h2>
          <div
            style={{
              fontFamily: "var(--ui)",
              fontSize: 11.5,
              color: "var(--ink-3)",
            }}
          >
            Leaf specs{clientName ? ` · for ${clientName}` : ""}
          </div>
        </div>
        <div className="meta">Quotation</div>
      </div>
      <div className="a1v2-addendum-asy">
        <div className="asy-head">
          <span className="sku">{asy.sku}</span>
          <span className="name">{asy.name}</span>
          <span className="meta">
            {asy.leaves.length} LEAF{asy.leaves.length === 1 ? "" : "s"}
          </span>
        </div>
        {asy.leaves.map((leaf) => (
          <AddendumLeafBlock key={leaf.leafKey} leaf={leaf} />
        ))}
      </div>
    </PdfPage>
  );
}

function AddendumLeafBlock({ leaf }: { leaf: AddendumLeaf }) {
  const v = leaf.variant;

  if (v.kind === "untyped") {
    return (
      <div className="a1v2-leaf-block placeholder">
        <div className="leaf-block-head">
          <span className="name">{leaf.name}</span>
          <span
            className="type-tag"
            style={{ color: "var(--bad)", background: "var(--bad-soft)" }}
          >
            untyped
          </span>
        </div>
        <div className="placeholder-msg">
          No Product Type set · specs cannot render
        </div>
      </div>
    );
  }

  if (v.kind === "placeholder") {
    return (
      <div className="a1v2-leaf-block placeholder">
        <div className="leaf-block-head">
          <span className="name">{leaf.name}</span>
          <span className="type-tag">{v.typeName}</span>
        </div>
        <div className="placeholder-msg">
          {v.typeName} · fields TBD · pending schema
        </div>
      </div>
    );
  }

  // Typed-with-schema variant. Single-section layout (matches
  // canonical line 1068 — `gridTemplateColumns: 1fr` for sub-block
  // when schema.fields.length <= 8, otherwise default 2-col grid).
  const useWideGrid = v.fields.length > 8;
  return (
    <div className="a1v2-leaf-block">
      <div className="leaf-block-head">
        <span className="name">{leaf.name}</span>
        <span className="type-tag">{v.typeName}</span>
      </div>
      <div
        className="pp-sp-grid"
        style={useWideGrid ? undefined : { gridTemplateColumns: "1fr" }}
      >
        <div className="section">
          <h5>{v.typeName}</h5>
          {v.fields.map((f) => (
            <div key={f.key} className="row">
              <span className="lbl">{f.label}</span>
              <span className={`val${f.value ? "" : " empty"}`}>
                {f.value ?? "--"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

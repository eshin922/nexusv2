import type { SpecCompleteness } from "@/lib/assembly-tree";
import type {
  LeafSpecEntryData,
  LeafSpecEntryProductType,
} from "@/lib/leaf-spec-loader";
import { CompletenessChip } from "@/components/assembly-tree/completeness-chip";
import { SpecPanel } from "./spec-panel";

// Phase A.1 v2 impl-3 Step 3 — SpecEntry surface (server wrapper).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// `SpecEntry` (lines 280-345). Renders the header chrome (.a1v2-leaf-
// header) + the body slot. Body content depends on scenario:
//   - scenario ⑤/⑥: SpecPanel (Step 4)
//   - scenario ⑦/⑧: PlaceholderPanel (Step 6)
//   - scenario ⑨:    TypePicker empty state (Step 7)
//   - scenario ⑩:    same body as the leaf's type would render
//                    BUT every input disabled + RLS banner above
//                    (Step 8)
//
// Step 3 ships the chrome + a body-content placeholder; Step 4+
// fill the actual panels.

export function SpecEntrySurface({
  data,
  readOnly,
}: {
  data: LeafSpecEntryData;
  readOnly: boolean;
}) {
  const { leaf, productType, currentSpec, references } = data;
  const completeness = computeCompleteness(productType, currentSpec?.specValues);
  const refCount = references.length;

  return (
    <>
      {readOnly ? (
        <div className="a1v2-rls-banner">
          <span className="glyph" aria-hidden="true">
            🔒
          </span>
          <div>
            <strong>Read-only view.</strong> Your role doesn&apos;t
            have <code>spec_edit</code> permission. Spec values render
            but inputs are disabled.
          </div>
        </div>
      ) : null}
      <div className="a1v2-card">
        <div className="a1v2-leaf-header">
          <span className="icon" aria-hidden="true">
            ◦
          </span>
          <div>
            <div className="name">{leaf.name}</div>
            <div className="meta">
              <span>SKU {leaf.sku ?? "—"}</span>
              <span className="sep">·</span>
              <span>v{currentSpec?.versionNumber ?? 1}</span>
              {leaf.unitCost ? (
                <>
                  <span className="sep">·</span>
                  <span>${Number(leaf.unitCost).toFixed(2)} unit cost</span>
                </>
              ) : null}
              <span className="sep">·</span>
              <span>
                Referenced by {refCount} ASY{refCount === 1 ? "" : "s"}
              </span>
              {leaf.fscClaim ? (
                <>
                  <span className="sep">·</span>
                  <span>FSC {leaf.fscStatus ?? "—"}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="right">
            <CompletenessChip completeness={completeness} />
            {productType ? (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "0.04em",
                  color: "var(--accent-ink)",
                  background: "oklch(from var(--accent) l c h / 0.10)",
                  padding: "3px 8px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                }}
              >
                {productType.name}
              </span>
            ) : null}
          </div>
        </div>
        <div className="a1v2-card-body">
          {!productType ? (
            // Scenario ⑨ — TypePicker empty state lands in Step 7.
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 13,
                padding: "8px 0",
              }}
            >
              TypePicker (scenario ⑨) renders here in Step 7.
            </p>
          ) : productType.placeholder ? (
            // Scenarios ⑦/⑧ — PlaceholderPanel lands in Step 6.
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 13,
                padding: "8px 0",
              }}
            >
              PlaceholderPanel (scenarios ⑦/⑧) renders here in Step 6.
            </p>
          ) : productType.fieldSchema ? (
            // Scenarios ⑤/⑥ — SpecPanel field grid (Step 4-5).
            <SpecPanel
              title={productType.name}
              fields={productType.fieldSchema.fields}
              leafId={leaf.id}
              initialValues={currentSpec?.specValues ?? {}}
              filled={getFilledCount(completeness)}
              total={productType.fieldSchema.fields.length}
              readOnly={readOnly}
            />
          ) : (
            <p
              style={{
                color: "var(--ink-3)",
                fontSize: 13,
                padding: "8px 0",
              }}
            >
              Product type has no field schema configured.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Read the filled count out of a completeness state. SpecPanel
 * needs the raw filled number for its panel-head caption.
 */
function getFilledCount(c: SpecCompleteness | null): number {
  if (!c) return 0;
  switch (c.kind) {
    case "complete":
      return c.total;
    case "partial":
      return c.filled;
    case "empty":
    case "no_type":
    case "placeholder":
      return 0;
  }
}

/**
 * Computes the surface-level completeness chip state from the
 * loaded data shape. Mirrors src/lib/assembly-tree.ts computeSpecCompleteness
 * but adapted for the LeafSpecEntryData inputs.
 */
function computeCompleteness(
  productType: LeafSpecEntryProductType | null,
  specValues: Record<string, unknown> | undefined,
): SpecCompleteness | null {
  if (!productType) return { kind: "no_type" };
  if (productType.placeholder) {
    return { kind: "placeholder", typeName: productType.name };
  }
  const schema = productType.fieldSchema;
  if (!schema || schema.fields.length === 0) {
    return { kind: "placeholder", typeName: productType.name };
  }
  const total = schema.fields.length;
  const values = specValues ?? {};
  const filled = schema.fields.filter((f) => {
    const v = values[f.key];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  }).length;
  if (filled === 0) {
    return { kind: "empty", typeName: productType.name, total };
  }
  if (filled < total) {
    return { kind: "partial", typeName: productType.name, filled, total };
  }
  return { kind: "complete", typeName: productType.name, total };
}

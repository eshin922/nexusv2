import type { SpecCompleteness } from "@/lib/assembly-tree";
import type {
  LeafSpecEntryData,
  LeafSpecEntryProductType,
} from "@/lib/leaf-spec-loader";
import { CompletenessChip } from "@/components/assembly-tree/completeness-chip";
import { SpecPanel } from "./spec-panel";
import { PlaceholderPanel } from "./placeholder-panel";

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
  scope,
  data,
  readOnly,
}: {
  /**
   * B-3 — which authority these edits target. No default: the two candidates
   * are one quote and every future quote.
   */
  scope: { quoteId: string } | { library: true };
  data: LeafSpecEntryData;
  readOnly: boolean;
}) {
  const { leaf, productType, currentSpec, references } = data;
  const completeness = computeCompleteness(productType, currentSpec?.specValues);

  const isLibrary = "library" in scope;

  return (
    <>
      {/* B-6 — scope is part of correctness now, so each surface says which
          authority it edits rather than leaving it to the URL or the nav rail.
          One sentence, and the same shape on both, so the DIFFERENCE is what
          reads rather than the wording. */}
      <div className={`a1v2-scope-head ${isLibrary ? "library" : "quote"}`}>
        <h2>{isLibrary ? "Default specifications" : "Quote specifications"}</h2>
        <p>
          {isLibrary
            ? "Used as the starting point for future quotes. Existing quotes are not changed."
            : "Changes apply only to this quote. Library defaults and other quotes are not changed."}
        </p>
      </div>
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
            {/* Step 8 · the change-type control is retired. Classification is
                HubSpot's, and the Spec Schema follows from it — so there is
                nothing here for an operator to choose. Offering a choice was
                what created a second authority. */}
          </div>
        </div>
        <div className="a1v2-card-body">
          {!productType ? (
            <NoSchemaPanel
              state={data.specSchemaState}
              typeValue={leaf.hubspotProductType}
            />
          ) : productType.placeholder ? (
            <PlaceholderPanel productType={productType} />
          ) : productType.fieldSchema ? (
            // Scenarios ⑤/⑥ — SpecPanel field grid (Step 4-5).
            <SpecPanel
              scope={scope}
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
    case "no_schema":
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

/**
 * Step 8 · what the spec surface says when no field set applies.
 *
 * Replaces the TypePicker. There is no longer a choice to offer here: a
 * product's classification is HubSpot's, and the Spec Schema follows from it.
 * So the panel explains WHICH of the two situations this is, and where the
 * operator would go to change it — which is HubSpot, not Nexus.
 *
 * The two states are kept apart deliberately. "Not classified" is an
 * unanswered question with an action attached; "specifications do not apply"
 * is a finished answer with none. Showing one message for both is what made
 * classified and unclassified products look identical.
 */
function NoSchemaPanel({
  state,
  typeValue,
}: {
  state: "schema" | "no_schema" | "unmapped" | "no_type";
  typeValue: string | null;
}) {
  if (state === "no_schema") {
    return (
      <div className="a1v2-empty">
        <strong>Specifications not applicable</strong>
        <p>
          {typeValue ?? "This category"} does not carry a product
          specification. Nothing is missing.
        </p>
      </div>
    );
  }
  if (state === "unmapped") {
    return (
      <div className="a1v2-empty">
        <strong>No specification schema for “{typeValue}”</strong>
        <p>
          This Product Type has no governed schema yet. It needs adding to the
          mapping before specifications can be authored.
        </p>
      </div>
    );
  }
  return (
    <div className="a1v2-empty">
      <strong>No Product Type set</strong>
      <p>
        This product has no Product Type in HubSpot, so no specification schema
        applies. Classify it in HubSpot and it will pick up its schema on the
        next attachment.
      </p>
    </div>
  );
}

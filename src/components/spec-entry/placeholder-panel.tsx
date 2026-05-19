import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";

// Phase A.1 v2 impl-3 Step 6 — PlaceholderPanel (scenarios ⑦ + ⑧).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// PlaceholderPanel (lines 371-382). Renders when leaf's
// product_type has placeholder=true (Soft goods, Tertiary
// packaging in v1; future placeholder types added by the seed
// without code changes).
//
// Copy verbatim from canonical — "Edward provides field lists
// iteratively per type" reflects the v1.1+ rollout cadence
// for placeholder type field_schemas.

export function PlaceholderPanel({
  productType,
}: {
  productType: LeafSpecEntryProductType;
}) {
  return (
    <div className="a1v2-placeholder-panel">
      <h4>
        {productType.name} specs{" "}
        <span className="type-name">fields TBD</span>
      </h4>
      <p>
        Field schema for <strong>{productType.name}</strong> is pending.
        Edward provides field lists iteratively per type. Once defined,
        this leaf&apos;s spec entry renders the configured field set in
        the same panel pattern as PP/SP.
      </p>
      <div className="stub">
        design pattern · type-aware rendering · field count TBD
      </div>
    </div>
  );
}

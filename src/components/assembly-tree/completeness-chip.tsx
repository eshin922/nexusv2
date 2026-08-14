import type { SpecCompleteness } from "@/lib/assembly-tree";

// Phase A.1 v2 — shared completeness chip primitive.
//
// Originally embedded in asy-row.tsx as LeafCompletenessChip
// (impl-2 Step 4). Extracted impl-3 Step 3 for reuse on the
// SpecEntry surface (canonical CompletenessChip lines 85-98 of
// qw_a1v2.jsx). Renders the 5 states + copy verbatim from
// canonical:
//   - complete:    ✓ Complete (dot prefix)
//   - partial:     ⚠ N fields pending  (or "⚠ Fields pending" for placeholders)
//   - empty:       — No specs entered
//   - no_type:     ⚠ No type set
//   - placeholder: ⚠ Fields pending

export function CompletenessChip({
  completeness,
}: {
  completeness: SpecCompleteness | null;
}) {
  if (!completeness) {
    return <span className="a1v2-chip empty">— No specs entered</span>;
  }
  switch (completeness.kind) {
    case "complete":
      return (
        <span className="a1v2-chip complete">
          <span className="dot" />✓ Complete
        </span>
      );
    case "partial":
      return (
        <span className="a1v2-chip partial">
          ⚠ {completeness.total - completeness.filled} fields pending
        </span>
      );
    case "placeholder":
      return <span className="a1v2-chip partial">⚠ Fields pending</span>;
    case "empty":
      return <span className="a1v2-chip empty">— No specs entered</span>;
    // Step 4.5 · a FINISHED answer, and it reads like one. Freight, services
    // and one-time charges have no product specification, so nothing is
    // pending and nothing is missing. It takes the quiet `empty` register
    // rather than the `no_type` warning register precisely because there is
    // no action for the operator to take.
    case "no_schema":
      return <span className="a1v2-chip empty">— Specs not applicable</span>;
    // Step 4.5 · this now means the AUTHORITATIVE classification is missing.
    // Before the cutover it fired whenever nobody had run the Nexus
    // TypePicker, which was almost every product — so it was noise. It is a
    // warning again because it is once more actionable: classify the product
    // in HubSpot.
    case "no_type":
      return <span className="a1v2-chip no_type">⚠ No type set</span>;
  }
}

// Slice 12 Step 1 — Legend.
// Pattern 30 port of R8 canonical `Legend` in umbrella.jsx:76-83.
// Copy verbatim per Pattern 28 (design docs are fidelity contracts).
//
// Renders below the sub-tab strip when the quote isn't in `complete`
// state. Once locked, the legend is replaced by the read-only note
// on the Complete surface (Step 8 territory) — the caller decides
// whether to render this or not.

export function Legend() {
  return (
    <div className="r8-legend">
      <span className="item">
        <span className="rev">↺</span> steps 1–4 are reversible — a sent quote
        can be revised, an acceptance rolled back
      </span>
      <span className="item">
        <span className="irr">🔒</span> step 5 pushes a NetSuite Sales Order —
        the only irreversible act
      </span>
    </div>
  );
}

"use client";

// Phase A.1 v2 impl-6 Step 6 — Addendum toggle (PM preview chrome).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// AddendumSurface (lines 921-928). Toggle is PM-internal preview
// chrome — lives OUTSIDE the customer-view boundary (in
// src/components/quote/ alongside PreviewToolbar). The toggle
// state controls whether <PdfAddendumAssemblies> renders inside
// the boundary; the data crosses via the typed
// QuoteAddendumData prop chain.
//
// Pattern 32 — toggle state is session-transient. Persistence
// candidates (per-quote column, per-user preference) deferred to
// impl-7 brief disposition.

export function AddendumToggle({
  on,
  onToggle,
  totalLeaves,
  totalAssemblies,
  hasMeaningfulContent,
}: {
  on: boolean;
  onToggle: () => void;
  totalLeaves: number;
  totalAssemblies: number;
  hasMeaningfulContent: boolean;
}) {
  let meta: string;
  if (on && hasMeaningfulContent) {
    meta = `· ${totalLeaves} leaves across ${totalAssemblies} ASY${totalAssemblies === 1 ? "" : "s"}`;
  } else if (on && !hasMeaningfulContent) {
    meta = "· all empty — will suppress";
  } else {
    meta = "· pricing-only PDF";
  }
  return (
    <div
      className={`a1v2-addendum-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="tog" aria-hidden="true" />
      <span className="lab">Include spec addendum</span>
      <span className="meta">{meta}</span>
    </div>
  );
}

import type { LeafSpecReference } from "@/lib/leaf-spec-loader";

// Phase A.1 v2 impl-3 Step 10 — Cascade warning banner.
//
// Per CD designer notes Pushback 2: "Cascade warning is
// informational, not blocking — same risk as iter 1's soft gate."
// The banner surfaces awareness for widely-referenced edits;
// autosave continues per-field; PMs see the impact context.
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// CascadeWarningDemo (lines 801-829) — only the banner portion;
// the canonical's "Save · cascade to N drafts" button is intentionally
// dropped (autosave model, not explicit-save).
//
// Trigger heuristic: render when the leaf is referenced by more
// than 1 ASY OR spans more than 1 scenario/quote. Below the
// threshold, the surface stays uncluttered.

export function CascadeWarning({
  references,
  leafName,
  currentVersion,
}: {
  references: LeafSpecReference[];
  leafName: string;
  currentVersion: number;
}) {
  const distinctScenarios = new Set(
    references.map((r) => `${r.quoteId}:${r.scenarioLabel ?? ""}`),
  );
  if (references.length <= 1 && distinctScenarios.size <= 1) return null;

  // Quote-status grouping per the canonical's sent/draft distinction.
  // Sent + accepted quotes "stay pinned"; drafts "auto-update" on
  // edits since they re-read current spec values at quote-pin time.
  const sentStatuses = new Set(["sent", "accepted", "superseded"]);

  return (
    <div className="a1v2-cascade-warning">
      <span className="glyph" aria-hidden="true">
        ⚠
      </span>
      <div className="body">
        <span>
          <strong>
            {leafName} is used in {references.length} ASY
            {references.length === 1 ? "" : "s"} across{" "}
            {distinctScenarios.size} scenario
            {distinctScenarios.size === 1 ? "" : "s"}.
          </strong>{" "}
          Editing specs affects referencing quotes per their state:{" "}
          <strong>sent quotes stay pinned</strong> to v{currentVersion};{" "}
          <strong>draft quotes auto-update</strong> to the new values.
        </span>
        <div className="ref-list">
          {references.map((r) => {
            const isSent = sentStatuses.has(r.quoteStatus);
            return (
              <div key={r.assemblyId} className="ref-row">
                <span className="scenario">
                  {r.scenarioLabel ?? "(no scenario)"}
                </span>
                <span className="asy">
                  {r.assemblySku} · {r.assemblyName}
                </span>
                <span className={`status ${isSent ? "sent" : "draft"}`}>
                  {isSent
                    ? `${r.quoteStatus} · stays pinned`
                    : "draft · will update"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

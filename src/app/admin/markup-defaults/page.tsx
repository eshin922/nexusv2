import { requireAdminPage } from "@/lib/admin-guard";
import {
  listMarkupDefaultReferenceCounts,
  listMarkupDefaults,
} from "@/app/actions/markup-defaults";
import { MarkupDefaultsTable } from "./markup-defaults-table";

// Slice RI.8 step 2 — Markup defaults Round 5 rebuild per brief §3.11.
// R5 source: docs/design-prototypes/dist/source/round-5/6b746616.js
// + R5 styles in r5-admin.css.
//
// Key Round 5 commitments landed in this step:
// - Propagation rule banner (persistent, top of page) explaining how
//   default edits propagate to draft quotes vs. sent quotes (frozen).
// - Inline-edit per row (click Edit → row turns into editor with
//   Cancel + Save) replacing prior auto-save-on-change behavior.
// - Live disclosure during edit: counts of affected line items +
//   draft quotes + approximate margin-shift range. Engine is
//   `previewMarkupDefaultRecompute` per §1.2 Edward disposition
//   (approximate ranges, not exact recompute simulation).
// - "+ NEW CATEGORY" button drawn but inert in v1 per Round 5
//   backlog (vocabulary is locked at the 15-entry FR-15 set).
// - "Unused — never used" chip on zero-reference rows (Round 5
//   commitment).
// - Designer note panel at bottom (PM-internal context).

export default async function MarkupDefaultsAdminPage() {
  await requireAdminPage();
  const [rows, refCounts] = await Promise.all([
    listMarkupDefaults(),
    listMarkupDefaultReferenceCounts(),
  ]);
  // Plain object for client-component prop (Maps don't survive RSC
  // serialization — same pattern noted in costing.ts markupDefaults).
  const referenceCounts: Record<string, number> = {};
  for (const [k, v] of refCounts) referenceCounts[k] = v;

  const inUse = rows.filter((r) => (referenceCounts[r.category] ?? 0) > 0)
    .length;

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <p className="eyebrow">Admin · Markup defaults</p>
        <h1>
          Default <em>markups</em> by category
        </h1>
        <p className="sub">
          When a costing line gets a category, it inherits that category&rsquo;s
          default markup. PMs can override on the line itself. These numbers
          are the firm&rsquo;s starting point — set once, drift rarely.
        </p>
      </div>

      <div className="r5-md-rule">
        <div className="icon" aria-hidden>
          !
        </div>
        <div>
          <strong>How changes propagate.</strong> Editing a default updates{" "}
          <strong>draft quotes</strong> only, recomputing affected line items
          in place. <strong>Sent quotes are frozen</strong> at the markup that
          was in force when they were sent — re-sending a v2 picks up new
          defaults, the original v1 record stays intact. Audit log captures
          every change with before/after.
        </div>
      </div>

      <MarkupDefaultsTable
        rows={rows}
        referenceCounts={referenceCounts}
        inUseCount={inUse}
        totalCount={rows.length}
      />

      <div className="r5-dn">
        <span className="lbl">Designer note</span>
        Inline editing, no modal. The whole row is the form: row turns into
        the editor, name stays put for anchoring. We considered grouping
        into &ldquo;Materials / Operations / Services / Other&rdquo; — the
        FR-15 categories almost cluster that way — but introducing a layer
        over ~15 rows that fit on one screen is gratuitous. Re-evaluate when
        the count crosses 25.
      </div>
    </div>
  );
}

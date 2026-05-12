"use client";

import { useState, useTransition } from "react";
import {
  deleteMarkupDefault,
  previewMarkupDefaultRecompute,
  upsertMarkupDefault,
  type MarkupDefaultRow,
  type RecomputePreview,
} from "@/app/actions/markup-defaults";
import { validatePercentDecimal } from "@/lib/percent-validation";

// Slice RI.8 step 2 — Markup defaults Round 5 inline-edit table.
// Click-Edit → row becomes the editor (Cancel + Save buttons) per
// R5 source. Live disclosure renders below the editing row with
// counts + approximate margin-shift range from
// previewMarkupDefaultRecompute (per §1.2 Edward disposition).

// Slice RI.8 Designer audit M2 — split display vs edit-state precision.
// R5 fixture (6b746616.js:60) renders whole-percent: (pct * 100).toFixed(0).
// Browse state uses the whole-percent shape; edit-state retains 4-decimal
// precision so PMs entering sub-percent values (e.g. 32.5%) don't lose data.
function decimalToPctBrowseDisplay(d: string): string {
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return n.toFixed(0);
}
function decimalToPctEditDisplay(d: string): string {
  const n = Number(d) * 100;
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(4)).toString();
}

function fmtRelativeDate(d: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export function MarkupDefaultsTable({
  rows,
  referenceCounts,
  inUseCount,
  totalCount,
}: {
  rows: MarkupDefaultRow[];
  referenceCounts: Record<string, number>;
  inUseCount: number;
  totalCount: number;
}) {
  const [editCategory, setEditCategory] = useState<string | null>(null);

  return (
    <div className="r5-md-table">
      <div className="r5-md-table-head">
        <div>Category</div>
        <div style={{ textAlign: "right" }}>Default markup</div>
        <div>In use</div>
        <div>Last edited</div>
        <div></div>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "24px 22px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-3)",
            fontStyle: "italic",
          }}
        >
          No categories yet.
        </div>
      ) : (
        rows.map((row) => {
          const refCount = referenceCounts[row.category] ?? 0;
          const isEditing = editCategory === row.category;
          return (
            <ExistingRow
              key={row.category}
              row={row}
              referenceCount={refCount}
              editing={isEditing}
              onStartEdit={() => setEditCategory(row.category)}
              onCancel={() => setEditCategory(null)}
              onSaved={() => setEditCategory(null)}
            />
          );
        })
      )}

      <div className="r5-md-foot">
        <span>
          {totalCount} categor{totalCount === 1 ? "y" : "ies"} ·{" "}
          {inUseCount} in use
        </span>
        {/* "+ NEW CATEGORY" inert per Round 5 brief — vocabulary is
            locked at the FR-15 entries; drawn-but-disabled signals
            the affordance is intentional, not missing. */}
        <button
          type="button"
          disabled
          title="Vocabulary is locked at the FR-15 entries. Re-evaluate when category count crosses 25 (Round 5 designer note)."
        >
          + NEW CATEGORY
        </button>
      </div>
    </div>
  );
}

function ExistingRow({
  row,
  referenceCount,
  editing,
  onStartEdit,
  onCancel,
  onSaved,
}: {
  row: MarkupDefaultRow;
  referenceCount: number;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const unused = referenceCount === 0;
  // Browse-state: whole-percent display per R5 fixture (M2). Edit-state
  // input receives 4-decimal precision so sub-percent values survive.
  const browseDisplay = decimalToPctBrowseDisplay(row.defaultMarkupPct);
  const editDisplay = decimalToPctEditDisplay(row.defaultMarkupPct);

  if (editing) {
    return (
      <EditingRow
        row={row}
        referenceCount={referenceCount}
        currentDisplay={editDisplay}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className={`r5-md-row ${unused ? "unused" : ""}`}>
      <div className="name">
        {row.category}
        {unused && <span className="unused-chip">unused</span>}
      </div>
      <div className="markup">
        {browseDisplay}
        <span className="pct">%</span>
      </div>
      <div className="lic">
        {referenceCount > 0 ? (
          <>
            {referenceCount} line item{referenceCount === 1 ? "" : "s"}
          </>
        ) : (
          <span className="zero">0 — never used</span>
        )}
      </div>
      <div className="last">
        {fmtRelativeDate(row.updatedAt)}
        <span className="by" aria-hidden>
          {/* TODO(RI.8 step 5 audit-log polish): resolve user
              initials from updated_by_user_id. For now, blank. */}
        </span>
      </div>
      <div className="actions">
        <button type="button" onClick={onStartEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}

function EditingRow({
  row,
  referenceCount,
  currentDisplay,
  onCancel,
  onSaved,
}: {
  row: MarkupDefaultRow;
  referenceCount: number;
  currentDisplay: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pct, setPct] = useState(currentDisplay);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<RecomputePreview | null>(null);
  const [, startPreview] = useTransition();
  const unused = referenceCount === 0;

  // Fire preview on pct change (debounced via setTimeout would be
  // cleaner but transitional + React 19 useTransition already coalesces
  // intermediate renders — accept that the action runs more often than
  // strictly necessary for the live-disclosure value).
  function refreshPreview(value: string) {
    if (value === "") {
      setPreview(null);
      return;
    }
    const decimal = Number(value) / 100;
    if (!Number.isFinite(decimal)) {
      setPreview(null);
      return;
    }
    startPreview(async () => {
      const r = await previewMarkupDefaultRecompute(
        row.category,
        String(decimal),
      );
      if (r.ok) setPreview(r.data);
    });
  }

  function handleChange(value: string) {
    setPct(value);
    setError(null);
    refreshPreview(value);
  }

  function handleSave() {
    setError(null);
    if (pct === "") {
      setError("Markup % is required.");
      return;
    }
    const decimal = Number(pct) / 100;
    const v = validatePercentDecimal(decimal, "markup");
    if (!v.valid) {
      setError(v.message);
      return;
    }
    const fd = new FormData();
    fd.set("category", row.category);
    fd.set("defaultMarkupPct", pct);
    startTransition(async () => {
      const r = await upsertMarkupDefault(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      onSaved();
    });
  }

  function handleDelete() {
    const message =
      referenceCount > 0
        ? `Delete category "${row.category}"?\n\n` +
          `${referenceCount} existing input row${referenceCount === 1 ? "" : "s"} use${referenceCount === 1 ? "s" : ""} this category and will be unaffected — they keep their saved markup. New rows of this category will have no default markup until you re-create it.`
        : `Delete category "${row.category}"?\n\nNo existing input rows reference this category.`;
    if (!confirm(message)) return;
    const fd = new FormData();
    fd.set("category", row.category);
    startTransition(async () => {
      const r = await deleteMarkupDefault(fd);
      if (!r.ok) {
        setError(r.error.message);
      } else {
        onSaved();
      }
    });
  }

  return (
    <div className={`r5-md-row editing ${unused ? "unused" : ""}`}>
      <div className="name">
        {row.category}
        {unused && <span className="unused-chip">unused</span>}
      </div>
      <div className="markup">
        <div className="r5-md-edit">
          <span></span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={pct}
            onChange={(e) => handleChange(e.target.value)}
            autoFocus
            aria-label={`${row.category} markup percent`}
          />
          <span className="pct">%</span>
        </div>
      </div>
      <div className="lic">
        {referenceCount > 0 ? (
          <>
            {referenceCount} line item{referenceCount === 1 ? "" : "s"}
          </>
        ) : (
          <span className="zero">0 — never used</span>
        )}
      </div>
      <div className="last">
        {fmtRelativeDate(row.updatedAt)}
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          style={{ color: "var(--bad)" }}
        >
          Delete
        </button>
        <button type="button" className="cancel" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="save"
          onClick={handleSave}
          disabled={pending || pct === ""}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Live disclosure — R5 commitment per brief §3.11. Renders
          below the editing row; references current preview state. */}
      <div className="r5-md-edit-help">
        {error ? (
          <span
            role="alert"
            style={{ color: "var(--bad)", fontWeight: 500 }}
          >
            {error}
          </span>
        ) : preview ? (
          <PreviewDisclosure preview={preview} />
        ) : (
          <span style={{ color: "var(--ink-3)" }}>
            Enter a new % to see the impact preview…
          </span>
        )}
      </div>
    </div>
  );
}

function PreviewDisclosure({ preview }: { preview: RecomputePreview }) {
  // Preview text reads as a sentence (e.g. "Saving 40% → 45% will
  // recompute markup on..."); align with browse-state R5 whole-percent.
  const oldDisplay = decimalToPctBrowseDisplay(preview.oldPct);
  const newDisplay = decimalToPctBrowseDisplay(preview.newPct);
  const noChange = preview.deltaPctPp === 0;
  const noDrafts = preview.affectedDraftQuotes === 0;

  if (noChange) {
    return (
      <span style={{ color: "var(--ink-3)" }}>
        No change yet. Adjust the % to see the impact preview.
      </span>
    );
  }

  // Shift sign convention: positive deltaPp (higher markup) trends
  // positive blended-margin shift. Display absolute range with
  // direction prefix; PMs read the sign quickly.
  const shiftSign = preview.deltaPctPp > 0 ? "+" : "";
  const shiftLow = preview.shiftLowPp.toFixed(1);
  const shiftHigh = preview.shiftHighPp.toFixed(1);

  return (
    <>
      <strong>
        Saving {oldDisplay}% → {newDisplay}%
      </strong>{" "}
      will recompute markup on{" "}
      <strong>
        {preview.affectedLineItems} line item
        {preview.affectedLineItems === 1 ? "" : "s"}
      </strong>{" "}
      across{" "}
      <strong>
        {preview.affectedDraftQuotes} draft quote
        {preview.affectedDraftQuotes === 1 ? "" : "s"}
      </strong>
      .{noDrafts ? " " : " Sent quotes are not affected."}
      <div className="impact">
        {noDrafts ? (
          <>No draft quotes affected — this change is forward-only.</>
        ) : (
          <>
            Estimated blended-margin shift on those drafts:{" "}
            <strong style={{ color: "var(--ink-2)" }}>
              {shiftSign}
              {shiftLow} to {shiftSign}
              {shiftHigh} pts
            </strong>{" "}
            (approximate; assumes 20–40% packaging cost share)
          </>
        )}
      </div>
    </>
  );
}

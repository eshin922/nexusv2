"use client";

// Slice 11 follow-up (2026-07-15) — click-to-edit scenario title on
// the project detail card header. Complements ScenarioActionsMenu
// (Copy + Drop). Editable in place per Edward's disposition.
//
// Interaction pattern:
//   - Idle: renders as <h3> heading (matches existing card typography)
//   - Click title → transforms to <input>, focuses, selects text
//   - Blur OR Enter → commit via renameScenarioLabel action
//   - Esc → revert to previous label, no save
//   - Server validates non-empty + uniqueness within project
//   - Optimistic UX: input stays open with error message on rejection
//
// Pattern 47 rule (e) exemption: the disabled attribute on the
// input during save uses `disabled={pending}` for the SHORT
// blur-Enter commit window — matches the LegDateInput sub-pattern
// (blur/Enter commit; input focus is already off the element by the
// time pending flips).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameScenarioLabel } from "@/app/actions/quotes";

export function EditableScenarioLabel({
  projectId,
  scenarioLabel,
  className,
}: {
  projectId: string;
  scenarioLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scenarioLabel);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commit() {
    const next = draft.trim();
    if (next === scenarioLabel) {
      setEditing(false);
      setDraft(scenarioLabel);
      return;
    }
    if (next.length === 0) {
      setError("Scenario label cannot be empty.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await renameScenarioLabel({
        projectId,
        oldScenarioLabel: scenarioLabel,
        newScenarioLabel: next,
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setEditing(false);
    setDraft(scenarioLabel);
    setError(null);
  }

  if (!editing) {
    return (
      <h3
        className={className}
        onClick={() => setEditing(true)}
        title="Click to rename scenario"
        style={{ cursor: "pointer" }}
      >
        {scenarioLabel}
      </h3>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        disabled={pending}
        className={className}
        style={{
          background: "var(--paper)",
          border: "1px solid var(--accent)",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: "inherit",
          fontFamily: "inherit",
          color: "inherit",
          minWidth: 200,
        }}
      />
      {error && (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--bad)",
            fontFamily: "var(--mono)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";

import { updateAccountingInstruction } from "@/app/actions/accounting-instruction";

/**
 * Card 3's authored instruction to Accounting.
 *
 * ── INTERNAL, AND STRUCTURALLY SO ────────────────────────────────────────
 *
 * Never printed for the customer. That is not enforced by remembering: this
 * value is not on `CustomerView`, the customer render tree may not import from
 * the schema, and `verify:boundaries` fails the build if it tries. There is
 * nowhere for it to leak to.
 *
 * ── UNCAPPED, UNLIKE THE CUSTOMER NOTE ───────────────────────────────────
 *
 * The authority is explicit: the customer note is capped at 400 and this is
 * not. The reason is the audience. A customer note is a sentence on a document
 * with a layout; an accounting instruction is whatever the operator needs the
 * person booking this quote to know, and truncating it would silently drop the
 * part that mattered.
 *
 * ── COMMIT ON BLUR, NOT PER KEYSTROKE ────────────────────────────────────
 *
 * Pattern 47's blur/Enter shape rather than debounced autosave. Free-form prose
 * has no meaningful mid-typing state to persist, and per-keystroke writes on a
 * field someone is composing in produce a row of half-sentences in the audit
 * log.
 *
 * `disabled` carries no pending flag (Pattern 47(e)): disabling an input
 * mid-save drops focus and the next keystroke goes nowhere.
 */
export function AccountingInstruction({
  quoteId,
  editable,
  value,
}: {
  quoteId: string;
  editable: boolean;
  value: string | null;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  // Follow the server when it changes underneath — a revision, another tab —
  // but never while the operator has unsaved work in the box.
  useEffect(() => {
    if (!dirty) setDraft(value ?? "");
  }, [value, dirty]);

  const commit = () => {
    if (!dirty) return;
    if (draft === (value ?? "")) {
      setDirty(false);
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("accountingInstruction", draft);
    startTransition(async () => {
      await updateAccountingInstruction(fd);
      setDirty(false);
    });
  };

  return (
    <>
      <textarea
        className="cv-note-input cv-instruction-input"
        rows={3}
        disabled={!editable}
        placeholder={
          editable
            ? "What whoever books this quote needs to know."
            : "Frozen with this version."
        }
        value={draft}
        data-testid="cv-accounting-instruction"
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
      />
      {dirty && !pending && (
        <span className="cv-note-dirty">unsaved — click away to save</span>
      )}
      {pending && <span className="cv-note-dirty">saving…</span>}
      {!editable && (
        <span className="cv-note-dirty">
          Frozen with this version. Revise the quote to change it.
        </span>
      )}
    </>
  );
}

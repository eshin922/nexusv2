"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  clearOtherServiceItem,
  setOtherServiceItem,
} from "@/app/actions/other-service-item";

/**
 * The NetSuite item for an `OTC - Other Service` charge, chosen per line.
 *
 * EXCLUSIVE to this destination, and the exclusivity is the point. Every other
 * BV-011 destination means one thing, so one firm-wide mapping in Settings is
 * correct for all of them — offering a per-line override anywhere else would
 * create a second, competing source for a question already governed.
 *
 * `OTC - Other Service` is the catch-all: two quotes can use it for unrelated
 * charges, which is why migration 0081 refuses it a firm row by CHECK. Here the
 * operator's choice IS the governance for the line, which is also why it is
 * frozen at send rather than resolved at push.
 */
export function OtherServiceItemPicker({
  assemblyId,
  quoteLeafId,
  selected,
  disabled,
}: {
  assemblyId?: string;
  quoteLeafId?: string;
  selected: { code: string; internalId: string } | null;
  /** True once the quote leaves draft — the selection is frozen at send. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(selected?.code ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function owner(fd: FormData) {
    if (assemblyId) fd.set("assemblyId", assemblyId);
    if (quoteLeafId) fd.set("quoteLeafId", quoteLeafId);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const fd = new FormData();
      owner(fd);
      fd.set("netsuiteItemCode", draft);
      const r = await setOtherServiceItem(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      // The resolver may normalise the code; show what was actually stored
      // rather than what was typed.
      setDraft(r.data.itemCode);
      router.refresh();
    });
  }

  function clear() {
    setError("");
    startTransition(async () => {
      const fd = new FormData();
      owner(fd);
      const r = await clearOtherServiceItem(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setDraft("");
      router.refresh();
    });
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--ink-3)]">
          NetSuite item
        </span>
        <input
          className="w-32 rounded border border-[var(--rule)] bg-[var(--paper-2)] px-1 py-0.5 font-mono text-[11px]"
          value={draft}
          // Pattern 47(e) — `pending` never disables the input. A disabled
          // input drops focus mid-save and the next keystroke goes nowhere.
          disabled={disabled}
          placeholder="item code"
          aria-label="Other Service NetSuite item code"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              save();
            }
          }}
        />
        <button
          type="button"
          className="rounded border border-[var(--rule)] px-1.5 py-0.5 text-[11px] disabled:opacity-50"
          // Pattern 47(f) — gated only by ITS OWN action, and the title says
          // why whenever it is off.
          disabled={disabled || pending || draft.trim() === ""}
          title={
            disabled
              ? "This quote has been sent — the item was frozen at send"
              : draft.trim() === ""
                ? "Enter a NetSuite item code first"
                : pending
                  ? "Resolving this code against NetSuite…"
                  : undefined
          }
          onClick={save}
        >
          {pending ? "…" : "Save"}
        </button>
        {selected && !disabled && (
          <button
            type="button"
            className="rounded px-1 py-0.5 text-[11px] text-[var(--ink-3)] underline disabled:opacity-50"
            disabled={pending}
            title={pending ? "Working…" : "Clear the selection"}
            onClick={clear}
          >
            clear
          </button>
        )}
      </div>
      {selected ? (
        <span className="text-[10px] text-[var(--ink-3)]">
          resolved · id {selected.internalId}
        </span>
      ) : (
        <span className="text-[10px] text-[var(--ink-3)]">
          not chosen — blocks the NetSuite push
        </span>
      )}
      {error ? (
        <p className="mt-0.5 max-w-xs text-[10px] text-red-700">{error}</p>
      ) : null}
    </div>
  );
}

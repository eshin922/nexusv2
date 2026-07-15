"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CanonicalScenarioModal,
  type CanonicalScenarioModalProps,
} from "./canonical-modal";

// canonical-scenario-create-flow Step 5 — "+ New scenario"
// trigger button + modal host. Mirrors the LibraryBrowseTrigger
// pattern: lightweight client component, owns the modal's
// open/close state, accepts all modal data as props from the
// server-side page loader (Step 6 wires the project detail page).
//
// Scenario actions menu (2026-07-15) — auto-open path.
// When `initialSourceQuoteId` is set (from a `?copy_from=<id>`
// URL param on the project detail page), the trigger auto-opens
// the modal on mount in copy-scenario mode with the source
// pre-selected. On modal close, clears the URL param so a page
// refresh doesn't re-open the modal.

export type NewScenarioTriggerProps = Omit<
  CanonicalScenarioModalProps,
  "open" | "onClose"
> & {
  disabled?: boolean;
};

export function NewScenarioTrigger({
  disabled = false,
  ...modalProps
}: NewScenarioTriggerProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Auto-open when initialSourceQuoteId is set (menu-driven copy).
  const [open, setOpen] = useState(Boolean(modalProps.initialSourceQuoteId));

  // If the trigger later receives a new initialSourceQuoteId
  // (e.g., PM clicks copy on a different card without page
  // navigation), open the modal.
  useEffect(() => {
    if (modalProps.initialSourceQuoteId) setOpen(true);
  }, [modalProps.initialSourceQuoteId]);

  function handleClose() {
    setOpen(false);
    // If we were opened via the `?copy_from=` URL param, strip it
    // on close so refreshing the page doesn't re-open the modal.
    if (modalProps.initialSourceQuoteId) {
      router.replace(pathname);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="rounded border border-rule bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-rule-2 hover:text-ink"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        + New scenario
      </button>
      <CanonicalScenarioModal
        {...modalProps}
        open={open}
        onClose={handleClose}
      />
    </>
  );
}

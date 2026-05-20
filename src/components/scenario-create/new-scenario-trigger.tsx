"use client";

import { useState } from "react";
import {
  CanonicalScenarioModal,
  type CanonicalScenarioModalProps,
} from "./canonical-modal";

// canonical-scenario-create-flow Step 5 — "+ New scenario"
// trigger button + modal host. Mirrors AddProductTrigger pattern
// from impl-4: lightweight client component, owns the modal's
// open/close state, accepts all modal data as props from the
// server-side page loader (Step 6 wires the project detail page).

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
  const [open, setOpen] = useState(false);

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
        onClose={() => setOpen(false)}
      />
    </>
  );
}

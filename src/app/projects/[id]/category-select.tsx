"use client";

import { useRef, useTransition } from "react";
import { updateProjectCategory } from "@/app/actions/projects";

const CATEGORIES = [
  { value: "packaging", label: "Packaging" },
  { value: "turnkey", label: "Turnkey" },
  { value: "soft_goods", label: "Soft Goods" },
  { value: "secondary", label: "Secondary" },
  { value: "other", label: "Other" },
] as const;

/**
 * A value this list does not know must NEVER fall through to the first option.
 *
 * `<select>` with a `defaultValue` matching no `<option>` silently selects the
 * FIRST one — so an unrecognised category renders as "Packaging", which is not
 * a display bug but a false claim about the project on the page an operator
 * reads to learn what the project is.
 *
 * That is not hypothetical. Automatic HubSpot project shells will materialise
 * as `unclassified`, because the HubSpot and Nexus category vocabularies do not
 * align and inventing a mapping is forbidden. Without this, 56 shells would each
 * assert "Packaging" on sight.
 *
 * ATOMIC REQUIREMENT: this rendering and the `unclassified` enum value ship
 * together. This half is safe to land first — the option is DISABLED, so it
 * displays truthfully without offering a value the database would reject.
 */
const UNKNOWN_LABEL = "Unclassified — not set";

export function CategorySelect({
  projectId,
  value,
}: {
  projectId: string;
  value: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const isKnown = CATEGORIES.some((c) => c.value === value);

  return (
    <form ref={formRef} action={updateProjectCategory} className="inline-flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="category"
        defaultValue={value}
        onChange={() => {
          startTransition(() => formRef.current?.requestSubmit());
        }}
        className="rounded-md border border-rule bg-paper px-2 py-1 text-sm text-ink focus:border-ink-3 focus:outline-none disabled:opacity-50"
      >
        {/*
          Rendered ONLY when the stored value is unrecognised, so the ordinary
          case is untouched. Disabled: it states what the project currently is
          without offering it as something an operator can choose.
        */}
        {!isKnown && (
          <option value={value} disabled>
            {UNKNOWN_LABEL}
          </option>
        )}
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-gray-400">Saving…</span>}
    </form>
  );
}

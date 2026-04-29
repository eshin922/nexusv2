"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateQuoteNotes } from "@/app/actions/quotes";

const DEBOUNCE_MS = 800;

export function NotesEditor({
  quoteId,
  internalNotes,
  customerFacingNotes,
  disabled = false,
}: {
  quoteId: string;
  internalNotes: string | null;
  customerFacingNotes: string | null;
  disabled?: boolean;
}) {
  const [internal, setInternal] = useState(internalNotes ?? "");
  const [customer, setCustomer] = useState(customerFacingNotes ?? "");

  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ internal, customer });
  stateRef.current = { internal, customer };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  type Overrides = Partial<{ internal: string; customer: string }>;

  function fireSave(overrides: Overrides = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("internalNotes", s.internal);
    fd.set("customerFacingNotes", s.customer);
    startTransition(async () => {
      const r = await updateQuoteNotes(fd);
      if (!r.ok) setSaveError(r.error.message);
      else setSaveError(null);
    });
  }

  function scheduleSave(overrides: Overrides = {}) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(overrides), DEBOUNCE_MS);
  }

  return (
    <div className="grid gap-4">
      <Field label="Internal notes" hint="Never appears on the customer PDF.">
        <textarea
          value={internal}
          rows={4}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setInternal(v);
            scheduleSave({ internal: v });
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
      </Field>
      <Field
        label="Customer-facing notes"
        hint="Renders on the quote PDF; visible to the customer."
      >
        <textarea
          value={customer}
          rows={4}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setCustomer(v);
            scheduleSave({ customer: v });
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
      </Field>
      {saveError ? (
        <span className="text-xs text-red-700" role="alert">
          {saveError}
        </span>
      ) : pending ? (
        <span className="text-xs text-gray-500" aria-live="polite">
          Saving…
        </span>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-gray-700">
        {label}
      </span>
      <span className="mb-1 block text-xs text-gray-500">{hint}</span>
      {children}
    </label>
  );
}

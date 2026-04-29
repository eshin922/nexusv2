"use client";

import { useEffect, useRef, useState } from "react";
import { updateQuoteNotes } from "@/app/actions/quotes";

const DEBOUNCE_MS = 800;

export function NotesEditor({
  quoteId,
  internalNotes,
  customerFacingNotes,
}: {
  quoteId: string;
  internalNotes: string | null;
  customerFacingNotes: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initialRef = useRef({
    internalNotes: internalNotes ?? "",
    customerFacingNotes: customerFacingNotes ?? "",
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const data = new FormData(form);
      const internal = String(data.get("internalNotes") ?? "");
      const customer = String(data.get("customerFacingNotes") ?? "");
      if (
        internal === initialRef.current.internalNotes &&
        customer === initialRef.current.customerFacingNotes
      ) {
        return;
      }
      initialRef.current = {
        internalNotes: internal,
        customerFacingNotes: customer,
      };
      setSaving(true);
      form.requestSubmit();
      setTimeout(() => setSaving(false), 500);
    }, DEBOUNCE_MS);
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <form ref={formRef} action={updateQuoteNotes} className="grid gap-4">
      <input type="hidden" name="quoteId" value={quoteId} />
      <Field label="Internal notes" hint="Never appears on the customer PDF.">
        <textarea
          name="internalNotes"
          defaultValue={internalNotes ?? ""}
          rows={4}
          onChange={scheduleSave}
          onBlur={scheduleSave}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
      </Field>
      <Field
        label="Customer-facing notes"
        hint="Renders on the quote PDF; visible to the customer."
      >
        <textarea
          name="customerFacingNotes"
          defaultValue={customerFacingNotes ?? ""}
          rows={4}
          onChange={scheduleSave}
          onBlur={scheduleSave}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
      </Field>
      {saving && (
        <span className="text-xs text-gray-500" aria-live="polite">
          Saving…
        </span>
      )}
    </form>
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

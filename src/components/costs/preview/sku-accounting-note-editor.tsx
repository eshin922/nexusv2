"use client";

import { useEffect, useState, useTransition } from "react";
import { updateSkuAccountingNote } from "@/app/actions/sku-accounting-note";
import { runGoverned } from "@/lib/governed-action";

function EditableSkuAccountingNote({ quoteId, quoteLeafId, sku, value }: {
  quoteId: string;
  quoteLeafId: string;
  sku: string;
  value: string | null;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saved, setSaved] = useState(value ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(value ?? "");
    setDraft((current) => current === saved ? value ?? "" : current);
  }, [value]);

  function save() {
    if (pending || draft === saved) return;
    const submitted = draft;
    const form = new FormData();
    form.set("quoteId", quoteId);
    form.set("quoteLeafId", quoteLeafId);
    form.set("note", submitted);
    setError(null);
    startTransition(async () => {
      const result = await runGoverned(() => updateSkuAccountingNote(form));
      if (result.kind !== "ok") {
        setError(result.message);
        return;
      }
      setSaved(result.data.note ?? "");
    });
  }

  const dirty = draft !== saved;
  return (
    <label className="cm2-sku-accounting-note">
      <span>Note to Accounting{sku ? ` · ${sku}` : ""}</span>
      <textarea rows={2} maxLength={4000} value={draft}
        placeholder="Instructions for this SKU"
        aria-label={`Note to Accounting for ${sku || "this SKU"}`}
        onChange={(event) => setDraft(event.target.value)} onBlur={save} />
      {dirty && !pending && !error && <small>Unsaved — click away to save</small>}
      {pending && <small>Saving…</small>}
      {error && <small role="alert" className="cm2-sku-accounting-error">{error}</small>}
    </label>
  );
}

export default EditableSkuAccountingNote;

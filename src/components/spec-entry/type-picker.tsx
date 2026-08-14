"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { assignLeafProductType } from "@/app/actions/leaf-specs";

// Phase A.1 v2 impl-3 Step 7 — TypePicker empty state (scenario ⑨).
//
// Canonical structure per docs/design-prototypes/dist/qw_a1v2.jsx
// TypePicker (lines 347-369). Renders when leaf.product_type_id is
// null. Shows the available non-hidden leaf-scope types as
// clickable .option cards; each carries:
//   - .lab (type name)
//   - .desc ("N fields" for real types / "fields TBD" for placeholders)
// .placeholder modifier class on placeholder-type cards (visual
// distinction).
//
// Clicking an option calls assignLeafProductType server action;
// on success the page re-renders with the new type and the
// appropriate body (SpecPanel for typed-with-schema; PlaceholderPanel
// for placeholder types).

export function TypePicker({
  quoteId,
  leafId,
  availableTypes,
  disabled,
}: {
  quoteId: string;
  leafId: string;
  availableTypes: LeafSpecEntryProductType[];
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const router = useRouter();

  function handlePick(typeId: string) {
    if (disabled || pending) return;
    setPickingId(typeId);
    setError(null);
    const fd = new FormData();
    fd.set("leafId", leafId);
      fd.set("quoteId", quoteId);
    fd.set("productTypeId", typeId);
    startTransition(async () => {
      const result = await assignLeafProductType(fd);
      if (!result.ok) {
        setError(result.error.message);
        setPickingId(null);
        return;
      }
      // Refresh server-rendered surface so the new type takes effect.
      router.refresh();
    });
  }

  return (
    <div className="a1v2-type-picker">
      <div className="glyph" aria-hidden="true">
        ∅
      </div>
      <h4>Set product type first</h4>
      <p>
        This leaf has no Product Type — pick one to render its spec
        schema. Type drives which fields appear.
      </p>
      <div className="options">
        {availableTypes.map((t) => {
          const fieldsLabel = t.placeholder
            ? "fields TBD"
            : `${t.fieldSchema?.fields.length ?? 0} fields`;
          const isPicking = pickingId === t.id;
          return (
            <button
              type="button"
              key={t.id}
              className={`option${t.placeholder ? " placeholder" : ""}${
                isPicking ? " picking" : ""
              }`}
              onClick={() => handlePick(t.id)}
              disabled={disabled || pending}
              aria-label={`Assign ${t.name} type`}
            >
              <div className="lab">{t.name}</div>
              <div className="desc">
                {isPicking && pending ? "assigning…" : fieldsLabel}
              </div>
            </button>
          );
        })}
      </div>
      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            color: "var(--bad)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

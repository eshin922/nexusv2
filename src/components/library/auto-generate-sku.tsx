"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { GenerateResult, SkuBrandContext } from "@/app/actions/sku-allocation";

/**
 * The two server calls, injected rather than imported.
 *
 * Same discipline as `EditProductModal`'s `save` / `recover`: a component that
 * imports its server actions at module scope drags the database client into
 * the import graph of everything that mounts it, including tests. Declaring
 * them as a structural type keeps the boundary at the call site, where the
 * real actions are passed in.
 */
export type SkuServices = {
  loadContext: (quoteId: string | null) => Promise<ActionResult<SkuBrandContext>>;
  generate: (formData: FormData) => Promise<ActionResult<GenerateResult>>;
};

/**
 * Auto-generate SKU, beside the SKU field.
 *
 * ── IT NEVER OVERWRITES ──────────────────────────────────────────────────
 *
 * The control does not render at all when the field already holds a value or
 * the product's SKU is established. Not disabled -- absent. A disabled button
 * beside a filled field still advertises that generating over it is a thing
 * one might do, and an established SKU is exactly the value that must never be
 * replaced by an ordinary edit.
 *
 * ── THE BRAND IS CHOSEN, NEVER GUESSED ───────────────────────────────────
 *
 * From a customer quote the registered brand for that customer's RECORD
 * preselects, and one click is enough. In the Library there is no customer in
 * context, so the operator picks -- and there is no default option, because a
 * default there would file a product under whichever brand sorted first.
 *
 * Nothing here derives a token from the product's name.
 *
 * ── THE VALUE SURVIVES RETRIES ───────────────────────────────────────────
 *
 * One `attemptKey` per creation intent, minted once per mount. Retrying a
 * failed save reuses it, and the same key returns the SAME allocation rather
 * than consuming a second number -- so the SKU an operator was shown is the
 * SKU they keep, even across a failure. The durability is in the allocation
 * row, not in this component's state.
 */
export function AutoGenerateSku({
  quoteId,
  currentValue,
  established,
  onGenerated,
  attemptKey,
  services,
}: {
  /** Null on the Library surface, which has no customer in context. */
  quoteId: string | null;
  currentValue: string;
  established: boolean;
  onGenerated: (sku: string) => void;
  attemptKey: string;
  services: SkuServices;
}) {
  const [ctx, setCtx] = useState<SkuBrandContext | null>(null);
  const [brand, setBrand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const loaded = useRef(false);

  const occupied = currentValue.trim() !== "" || established;

  useEffect(() => {
    if (occupied || loaded.current) return;
    loaded.current = true;
    void services.loadContext(quoteId).then((r) => {
      if (!r.ok) return;
      setCtx(r.data);
      if (r.data.preselected) setBrand(r.data.preselected);
    });
  }, [occupied, quoteId]);

  // Nothing to offer: field already has a value, the SKU is established, or
  // generation is unavailable in this environment. Renders nothing rather than
  // a control that cannot work.
  if (occupied || !ctx || !ctx.enabled || ctx.brands.length === 0) return null;

  const needsChoice = brand === "";

  function run() {
    setError(null);
    const fd = new FormData();
    fd.set("brandToken", brand);
    fd.set("attemptKey", attemptKey);
    startTransition(async () => {
      const r = await services.generate(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (!r.data.ok) {
        setError(r.data.refusal.message);
        return;
      }
      onGenerated(r.data.sku);
    });
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}
    >
      {/* Shown whenever the brand was not preselected. There is no
          "— choose —" default that could be submitted. */}
      {ctx.preselected === null && (
        <select
          aria-label="Brand for the generated SKU"
          data-testid="sku-brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          style={{ fontSize: 12, padding: "4px 8px" }}
        >
          <option value="">Choose a brand…</option>
          {ctx.brands.map((b) => (
            <option key={b.token} value={b.token}>
              {b.customerLabel} ({b.token})
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        data-testid="sku-autogenerate"
        onClick={run}
        disabled={pending || needsChoice}
        title={needsChoice ? "Choose a brand first — there is no default." : undefined}
        style={{
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 5,
          border: "1px solid var(--rule)",
          background: "var(--paper)",
          color: needsChoice ? "var(--ink-3)" : "var(--ink-2)",
          cursor: needsChoice ? "not-allowed" : "pointer",
        }}
      >
        {pending ? "Generating…" : "Auto-generate SKU"}
      </button>

      {/* A disabled control must say why. */}
      {needsChoice && (
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          Choose a brand — there is no default namespace.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--danger, #b42318)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

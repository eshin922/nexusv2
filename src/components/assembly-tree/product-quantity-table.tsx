"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProductTierQuantity } from "@/app/actions/product-quantities";

type Product = { id: string; kind: "assembly" | "leaf"; name: string; sku: string | null };
type Tier = { id: string; label: string; qty: number | null };
export type QuantityRow = { assemblyId: string | null; quoteLeafId: string | null; tierId: string; quantity: number };

function QuantityCell({ product, tier, entered, disabled }: { product: Product; tier: Tier; entered: number | undefined; disabled: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(entered === undefined ? "" : String(entered));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const draft = useRef(value);
  const persisted = useRef(value);
  const requested = useRef(value);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const next = entered === undefined ? "" : String(entered);
    if (draft.current === persisted.current) { draft.current = next; requested.current = next; setValue(next); }
    persisted.current = next;
  }, [entered]);
  const save = (next: string) => {
    if (next === requested.current) return;
    requested.current = next;
    setError(null);
    const write = async () => {
      const form = new FormData();
      form.set("kind", product.kind); form.set("ownerId", product.id);
      form.set("tierId", tier.id); form.set("quantity", next);
      try {
        const result = await setProductTierQuantity(form);
        if (!result.ok) { if (requested.current === next) requested.current = persisted.current; setError(result.error.message); return; }
        const saved = result.data.quantity === null ? "" : String(result.data.quantity);
        persisted.current = saved;
        if (draft.current === next) { draft.current = saved; setValue(saved); }
        router.refresh();
      } catch {
        if (requested.current === next) requested.current = persisted.current;
        setError("Quantity could not be saved. Your entry is still here; try again.");
      }
    };
    startTransition(async () => {
      queue.current = queue.current.then(write, write);
      await queue.current;
    });
  };
  return <div className="setup-subquantity-value">
    <input
      aria-label={`${product.name} quantity for ${tier.label}`}
      aria-invalid={error ? true : undefined}
      className="setup-subquantity-input"
      inputMode="numeric" value={value}
      placeholder={tier.qty === null ? "Not set" : String(tier.qty)}
      disabled={disabled}
      onChange={(event) => { draft.current = event.target.value; setValue(event.target.value); }}
      onBlur={() => save(value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
    {pending ? <span className="setup-subquantity-status">Saving…</span> : null}
    {!disabled && entered !== undefined ? <button type="button" disabled={pending} className="setup-subquantity-reset" title="Restore the order option’s quantity" onClick={() => { draft.current = ""; setValue(""); save(""); }}>Reset</button> : null}
    {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
  </div>;
}

export function ProductQuantityFields({ product, tiers, quantities, disabled }: {
  product: Product; tiers: readonly Tier[]; quantities: readonly QuantityRow[]; disabled: boolean;
}) {
  if (!tiers.length) return null;
  return <div className="setup-subquantities" role="group" aria-label={`${product.name} sub-quantities`}>
    {tiers.map((tier) => {
      const row = quantities.find((q) => (q.assemblyId ?? q.quoteLeafId) === product.id && q.tierId === tier.id);
      return <div key={tier.id} className="setup-subquantity-cell"><span>{tier.label}</span><QuantityCell product={product} tier={tier} entered={row?.quantity} disabled={disabled}/></div>;
    })}
  </div>;
}

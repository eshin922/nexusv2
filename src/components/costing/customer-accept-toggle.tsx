"use client";

import { useState, useTransition } from "react";
import {
  recordCustomerAcceptance,
  clearCustomerAcceptance,
} from "@/app/actions/quotes";

// Slice RI.7 — "Customer responded · Tier N" affordance on Costing
// Sheet head per CR-SM DEC-2. Lives adjacent to the Mark Accepted
// cluster (workflow proximity — PM looking at costing receives
// customer's email, records signal here, then proceeds to
// Mark-Accepted).
//
// Sub-states:
//   - status === 'sent' AND customer_accepted_at IS NULL → record
//     affordance (tier picker + "Record" button).
//   - status === 'sent' AND customer_accepted_at IS NOT NULL →
//     affirmation chip showing accepted tier + clear button.
//   - status === 'draft' → component not rendered (page caller's
//     responsibility — quote can't have customer signal pre-send).
//   - status === 'accepted'/'superseded'/'lost' → not rendered
//     (locked or moved on).

type Tier = { id: string; label: string; qty: number | null };

export function CustomerAcceptToggle({
  quoteId,
  customerAcceptedAt,
  customerAcceptedTierId,
  tiers,
}: {
  quoteId: string;
  customerAcceptedAt: Date | null;
  customerAcceptedTierId: string | null;
  tiers: ReadonlyArray<Tier>;
}) {
  if (customerAcceptedAt && customerAcceptedTierId) {
    return (
      <AcceptanceChip
        quoteId={quoteId}
        tierLabel={
          tiers.find((t) => t.id === customerAcceptedTierId)?.label ?? "Tier ?"
        }
      />
    );
  }

  return <RecordForm quoteId={quoteId} tiers={tiers} />;
}

function RecordForm({
  quoteId,
  tiers,
}: {
  quoteId: string;
  tiers: ReadonlyArray<Tier>;
}) {
  const [tierId, setTierId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!tierId) {
      setError("Pick a tier first.");
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("tierId", tierId);
    startTransition(async () => {
      const r = await recordCustomerAcceptance(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  return (
    <div className="r2-row r2-gap-1" style={{ alignItems: "center" }}>
      <select
        value={tierId}
        onChange={(e) => setTierId(e.target.value)}
        disabled={pending || tiers.length === 0}
        aria-label="Customer accepted tier"
        style={{
          fontSize: 12,
          padding: "4px 6px",
          border: "1px solid var(--ink-4)",
          background: "var(--paper-1)",
        }}
      >
        <option value="">— customer responded —</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
            {t.qty !== null ? ` (${t.qty.toLocaleString()} units)` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !tierId}
        className="r2-btn sm ghost"
        title="Records the customer signal (timestamped). Mark-Accepted finalizes the gates."
      >
        {pending ? "…" : "Record"}
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 11, color: "var(--bad)", marginLeft: 4 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function AcceptanceChip({
  quoteId,
  tierLabel,
}: {
  quoteId: string;
  tierLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function clear() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await clearCustomerAcceptance(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  return (
    <div
      className="r2-row r2-gap-1"
      style={{
        alignItems: "center",
        padding: "4px 10px",
        background: "var(--accent-soft, var(--paper-2))",
        border: "1px solid var(--accent, var(--ink-4))",
        borderRadius: 4,
        fontSize: 12,
        color: "var(--accent-strong, var(--ink-1))",
      }}
      title="Customer signal recorded. Mark-Accepted finalizes the gates."
    >
      <span style={{ fontWeight: 600 }}>✓ Customer accepted {tierLabel}</span>
      <button
        type="button"
        onClick={clear}
        disabled={pending}
        style={{
          marginLeft: 4,
          fontSize: 11,
          color: "var(--ink-3)",
          textDecoration: "underline",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        {pending ? "…" : "clear"}
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 11, color: "var(--bad)", marginLeft: 4 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

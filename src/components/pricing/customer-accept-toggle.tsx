"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  recordCustomerAcceptance,
  clearCustomerAcceptance,
} from "@/app/actions/quotes";

// Slice RI.7 — "Customer responded · Tier N" affordance on Pricing
// (was Costing Sheet) head per CR-SM DEC-2. Lives adjacent to the
// Mark Accepted cluster (workflow proximity — PM looking at pricing
// receives customer's email, records signal here, then proceeds to
// Mark-Accepted).
//
// Slice RI.8 — Edward's post-step-0 smoke surfaced UX friction with
// the original dropdown + Record button two-step inline form.
// Redesigned to chip + popover:
//
//   Default state: "Record customer response" chip → click opens
//   popover with tier picker + Confirm / Cancel
//   Recorded state: "✓ Customer accepted Tier N · clear" affirmation
//
// Popover pattern matches the SKU row overflow menu — same shape,
// same outside-click + ESC discipline.
//
// Sub-states (unchanged from RI.7):
//   - status === 'sent' AND customer_accepted_at IS NULL → record
//   - status === 'sent' AND customer_accepted_at IS NOT NULL → affirmation
//   - status === 'draft' → component not rendered (page caller's
//     responsibility — quote can't have customer signal pre-send)
//   - status === 'accepted'/'superseded'/'lost' → not rendered

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

  return <RecordChip quoteId={quoteId} tiers={tiers} />;
}

function RecordChip({
  quoteId,
  tiers,
}: {
  quoteId: string;
  tiers: ReadonlyArray<Tier>;
}) {
  const [open, setOpen] = useState(false);
  const [tierId, setTierId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Slice RI.8 — popover close-on-outside-click + ESC.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function confirm() {
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
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      // Server revalidates; component re-renders into AcceptanceChip.
      // Local state cleanup is no-op (component unmounts).
    });
  }

  function cancel() {
    setOpen(false);
    setTierId("");
    setError(null);
  }

  return (
    <div className="relative" ref={ref}>
      {/* Default chip — single-click target. Mono caption register
          matches the surrounding action cluster. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending || tiers.length === 0}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="r2-btn sm ghost"
        title="Record the customer's tier acceptance — Mark Accepted finalizes the gates after."
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        Record customer response
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Record customer response"
          className="absolute right-0 top-full mt-1 z-50 min-w-[260px] rounded border border-rule bg-paper p-3 shadow-md"
        >
          <p
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Customer accepted which tier?
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tiers.map((t) => (
              <label
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  padding: "4px 0",
                }}
              >
                <input
                  type="radio"
                  name="tier"
                  value={t.id}
                  checked={tierId === t.id}
                  onChange={(e) => setTierId(e.target.value)}
                  disabled={pending}
                />
                <span>
                  {t.label}
                  {t.qty !== null ? (
                    <span
                      className="mono"
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: "var(--ink-3)",
                      }}
                    >
                      ({t.qty.toLocaleString()} units)
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>

          {error && (
            <p
              role="alert"
              style={{
                fontSize: 11,
                color: "var(--bad)",
                marginTop: 8,
              }}
            >
              {error}
            </p>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
              marginTop: 10,
            }}
          >
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="r2-btn sm ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending || !tierId}
              className="r2-btn sm primary"
            >
              {pending ? "Recording…" : "Confirm"}
            </button>
          </div>
        </div>
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

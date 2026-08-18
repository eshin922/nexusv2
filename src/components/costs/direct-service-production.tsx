"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDirectServiceProduction } from "@/app/actions/direct-service-production";
import {
  DIRECT_SERVICE_PRODUCTION_LABEL,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";

/**
 * A Direct Service's Production economics — the other branch of the Stage 3 A
 * ownership XOR.
 *
 * ── ONE INPUT, NOT A FILTERED TABLE ───────────────────────────────────────
 *
 * The identity decides which input this is, and there is no code path here
 * that can render a second one. That distinction is the whole point: a full
 * Item Group Production table filtered to one row LOOKS the same and is not,
 * because the first widening of the filter turns it back into an Item Group
 * surface on a leaf — which is what #282 removed.
 *
 * Bulk Raw, Setup, Tooling, Artwork, Freight, Customs and the rest are not
 * absent by filtering. They are absent because this component has no notion
 * of them.
 *
 * ── GATED ON IDENTITY, NOT ON DATA ────────────────────────────────────────
 *
 * The caller builds its list from service-classified leaves attached to the
 * quote, so an unpriced service still shows its input. Gating on "has a
 * production row" would make the surface appear only after a value existed,
 * which is the same defect one level up.
 */

export type DirectServiceProductionRow = {
  quoteLeafId: string;
  name: string;
  serviceIdentity: DirectServiceIdentity;
  /** tierId → current amount for THIS service's one governed column. */
  amountsByTier: Record<string, string | null>;
};

function AmountCell({
  quoteLeafId,
  tierId,
  value,
  editable,
}: {
  quoteLeafId: string;
  tierId: string;
  value: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    const fd = new FormData();
    fd.set("quoteLeafId", quoteLeafId);
    fd.set("tierId", tierId);
    // Deliberately NO column name. The service identity decides where this
    // lands, server-side — so a client cannot aim a value at Bulk Raw.
    fd.set("amount", next);
    setError(null);
    start(async () => {
      const r = await updateDirectServiceProduction(fd);
      if (!r.ok) {
        setError(r.error.message);
        setDraft(value ?? "");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="r6-cell">
      <input
        type="text"
        inputMode="decimal"
        className="r6-cell-input"
        value={draft}
        placeholder="—"
        /* Pattern 47(e): never `pending` on an input — a disabled element
           drops focus mid-save. Blur/Enter commit per the R6.2 LegDateInput
           precedent, because a per-keystroke save on a currency field would
           write partial numbers. */
        disabled={!editable}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={`Amount for tier ${tierId}`}
      />
      {pending && <span className="r6-cell-sub">saving…</span>}
      {error && (
        <span className="r6-cell-sub" style={{ color: "var(--bad)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

export function DirectServiceProduction({
  services,
  tiers,
  editable,
}: {
  services: DirectServiceProductionRow[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  editable: boolean;
}) {
  if (services.length === 0) return null;

  return (
    <div className="r6-prod-services">
      <div className="r6-subhead">
        Direct Services
        <span className="r6-subhead-note">
          sold on their own line · each owns one production cost
        </span>
      </div>
      {services.map((svc) => (
        <div key={svc.quoteLeafId} className="r6-prod-service">
          <div className="r6-prod-service-head">
            <span className="r6-prod-service-name">{svc.name}</span>
            {/* The one governed input, named. Not a column header on a table
                of many — the label IS the input. */}
            <span className="r6-prod-service-input">
              {DIRECT_SERVICE_PRODUCTION_LABEL[svc.serviceIdentity]}
            </span>
          </div>
          <div className="r6-prod-service-tiers">
            {tiers.map((t) => (
              <div key={t.id} className="r6-prod-service-tier">
                <div className="r6-prod-service-tier-label">{t.label}</div>
                <AmountCell
                  quoteLeafId={svc.quoteLeafId}
                  tierId={t.id}
                  value={svc.amountsByTier[t.id] ?? null}
                  editable={editable}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

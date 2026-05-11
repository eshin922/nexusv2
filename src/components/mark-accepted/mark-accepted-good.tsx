"use client";

import { useState } from "react";
import { MarginVerdict } from "./margin-verdict";
import { TierCard, type TierCardData } from "./tier-card";
import { VersionWarning } from "./version-warning";
import { AcceptConfirmModal } from "./accept-confirm-modal";
import type { CustomerAcceptanceContext } from "./mark-accepted-host";

function formatRecordedAt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MarkAcceptedGood({
  blendedMarginPct,
  status,
  targetPct,
  floorPct,
  tiers,
  customerName,
  quoteNumber,
  sentVersion,
  draftVersion,
  showVersionMismatch,
  activeSiblings,
  customerAcceptance,
}: {
  blendedMarginPct: number;
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  targetPct: number;
  floorPct: number;
  tiers: TierCardData[];
  customerName: string;
  quoteNumber: string;
  sentVersion: string;
  draftVersion: string;
  showVersionMismatch: boolean;
  activeSiblings: ReadonlyArray<{ id: string; label: string; margin: number; lastEdit: string }>;
  customerAcceptance: CustomerAcceptanceContext | null;
}) {
  // When customer-acceptance was recorded, auto-select that tier
  // (PM's flow: read the chip, click Mark-accepted, finalize).
  // Otherwise default to the recommended tier.
  const recommendedIdx = Math.max(
    0,
    tiers.findIndex((t) => t.recommended),
  );
  const acceptedIdx = customerAcceptance
    ? tiers.findIndex((t) => t.id === customerAcceptance.tierId)
    : -1;
  const initialIdx = acceptedIdx >= 0 ? acceptedIdx : recommendedIdx;
  const [selected, setSelected] = useState(initialIdx);
  const [showConfirm, setShowConfirm] = useState(false);
  const tier = tiers[selected] ?? tiers[0];

  return (
    <>
      {customerAcceptance && (
        <div
          style={{
            margin: "16px 24px 0",
            padding: "10px 14px",
            background: "var(--accent-soft, var(--paper-2))",
            borderLeft: "3px solid var(--accent, var(--ink-3))",
            borderRadius: 4,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          role="status"
        >
          <span>
            <strong style={{ color: "var(--accent-strong, var(--ink-1))" }}>
              ✓ Customer accepted {customerAcceptance.tierLabel}
            </strong>{" "}
            <span style={{ color: "var(--ink-3)" }}>
              · recorded {formatRecordedAt(customerAcceptance.recordedAt)}
            </span>
          </span>
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            Tier auto-selected · review gates &amp; finalize below.
          </span>
        </div>
      )}
      <div className="macc-header">
        <MarginVerdict
          blendedMarginPct={blendedMarginPct}
          status={status}
          targetPct={targetPct}
          floorPct={floorPct}
        />
        <div className="macc-cta-cluster">
          <button
            className="macc-cta-primary accent"
            onClick={() => setShowConfirm(true)}
            disabled={!tier}
          >
            ✓ Mark accepted · {tier?.label ?? "—"}
          </button>
          <span className="macc-cta-secondary">
            All gates clear · ready to lock
          </span>
        </div>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>
            Tier-selection · which tier did the customer accept?
          </p>
          <h2
            style={{
              fontFamily: "var(--display)",
              fontSize: 22,
              fontWeight: 500,
              margin: "0 0 14px",
              letterSpacing: "-0.015em",
            }}
          >
            Pick the tier on{" "}
            <em style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
              {customerName}&rsquo;s
            </em>{" "}
            reply
          </h2>

          {showVersionMismatch && (
            <VersionWarning
              sentVersion={sentVersion}
              draftVersion={draftVersion}
            />
          )}

          {tiers.map((t, i) => (
            <TierCard
              key={t.id}
              tier={t}
              selected={i === selected}
              onSelect={() => setSelected(i)}
            />
          ))}
        </div>

        <aside className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            What happens when you click Mark accepted
          </p>
          <ol
            style={{
              margin: 0,
              padding: "0 0 0 18px",
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.7,
            }}
          >
            <li>
              Quote status: <code>sent</code> → <code>accepted</code>
            </li>
            <li>Captures: tier_id, accepted_at, your user_id</li>
            <li>Snapshot json stored (FR-11) — irreversible record</li>
            <li>Other active scenarios auto-dropped (auditable)</li>
            <li>HubSpot writeback fires (async)</li>
            <li>This page becomes read-only</li>
          </ol>

          {activeSiblings.length > 0 && (
            <div
              style={{
                marginTop: 22,
                padding: "12px 14px",
                background: "var(--paper-3)",
                borderRadius: 6,
              }}
            >
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                Other active scenarios
              </p>
              {activeSiblings.map((s) => (
                <div
                  key={s.id}
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                    padding: "6px 0",
                    borderTop: "1px solid var(--rule)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{s.label}</span>
                    <span className="mono" style={{ color: "var(--ink-3)" }}>
                      {s.margin.toFixed(1)}%
                    </span>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-4)",
                      letterSpacing: 0,
                    }}
                  >
                    {s.lastEdit}
                  </div>
                </div>
              ))}
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--warn)",
                  marginTop: 8,
                  letterSpacing: 0.04,
                }}
              >
                {activeSiblings.length === 1
                  ? "Will be"
                  : `All ${activeSiblings.length} will be`}{" "}
                auto-dropped on accept.
              </div>
            </div>
          )}
        </aside>
      </div>

      {tier && (
        <AcceptConfirmModal
          open={showConfirm}
          onClose={() => setShowConfirm(false)}
          tier={tier}
          customerName={customerName}
          quoteNumber={quoteNumber}
          sentVersion={sentVersion}
          activeSiblings={activeSiblings}
        />
      )}
    </>
  );
}

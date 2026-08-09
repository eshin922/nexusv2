"use client";

import { MarginVerdict } from "./margin-verdict";
import { TierCard, type TierCardData } from "./tier-card";

function fmtUSD(n: number, dec = 2) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    })
  );
}

export function MarkAcceptedLocked({
  blendedMarginPct,
  targetPct,
  floorPct,
  acceptedTier,
  acceptedAt,
  acceptedByName,
  sentVersion,
}: {
  blendedMarginPct: number | null;
  targetPct: number;
  floorPct: number;
  acceptedTier: TierCardData;
  acceptedAt: string;
  acceptedByName: string;
  sentVersion: string;
}) {
  return (
    <>
      <div className="locked-ribbon">
        <div className="icon">✓</div>
        <div className="text">
          <div className="heading">
            Accepted {acceptedAt} · {acceptedTier.label} ·{" "}
            {acceptedTier.qty.toLocaleString()} units
          </div>
          <div className="meta">
            by {acceptedByName} · {fmtUSD(acceptedTier.total, 0)} total ·{" "}
            {acceptedTier.marginPct.toFixed(1)}% margin · {sentVersion}
          </div>
        </div>
        <div className="right">
          <span className="chip good">
            <span className="dot" />
            HubSpot synced (stub)
          </span>
          <button className="btn sm">⤓ Final PDF</button>
          <button className="btn sm">View snapshot</button>
        </div>
      </div>

      <div
        className="macc-header"
        style={{ borderBottom: "1px solid var(--rule)" }}
      >
        <MarginVerdict
          blendedMarginPct={blendedMarginPct}
          status="GOOD"
          targetPct={targetPct}
          floorPct={floorPct}
        />
        <div className="macc-cta-cluster">
          <span className="chip" style={{ fontSize: 11 }}>
            🔒 Read-only · accepted
          </span>
          <span className="macc-cta-secondary">
            Quote locked · all surfaces frozen · canonical record is the snapshot
          </span>
        </div>
      </div>

      <div style={{ padding: "24px 32px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 24,
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              Accepted tier
            </p>
            <TierCard
              tier={acceptedTier}
              selected
              onSelect={() => undefined}
              disabled
            />

            <div
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                padding: "14px 18px",
                marginTop: 18,
              }}
            >
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Acceptance audit
              </p>
              {[
                { lbl: "Accepted by", val: `${acceptedByName} (you)` },
                { lbl: "Accepted at", val: acceptedAt },
                { lbl: "Accept source", val: "manual_button" },
                { lbl: "Sent version", val: sentVersion },
                {
                  lbl: "HubSpot writeback",
                  val: "Stub — Slice 12 fills real status",
                },
              ].map((r, i) => (
                <div
                  key={r.lbl}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 1fr",
                    padding: "6px 0",
                    borderTop: i > 0 ? "1px solid var(--rule)" : "none",
                    fontSize: 12.5,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      letterSpacing: 0.04,
                    }}
                  >
                    {r.lbl}
                  </span>
                  <span style={{ color: "var(--ink-2)" }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              What happens next
            </p>
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 20px",
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.7,
              }}
            >
              <li>Generate PO confirmation (next-step action card on Project view)</li>
              <li>Production schedule emails out</li>
              <li>
                Project enters <code>in-production</code> stage on the deal
                organizer (Round 4)
              </li>
            </ul>

            <div
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                padding: "14px 16px",
                marginTop: 16,
              }}
            >
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                If something&rsquo;s wrong
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  margin: "0 0 8px",
                  lineHeight: 1.5,
                }}
              >
                Acceptance is locked but not destroyed. To revert: admin can{" "}
                <code>scenario_status: accepted → active</code> with a reason;
                HubSpot writeback is rolled back. Logged to audit.
              </p>
              <button className="btn sm ghost">Request unlock (admin)</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

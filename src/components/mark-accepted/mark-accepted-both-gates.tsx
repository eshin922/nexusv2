"use client";

import { useState } from "react";
import { MarginVerdict } from "./margin-verdict";
import { OverrideModal } from "./override-modal";

export type FlaggedLine = {
  sku: string;
  tier: string;
  marginPct: number;
  rule: string;
};

export function MarkAcceptedBothGates({
  blendedMarginPct,
  targetPct,
  floorPct,
  flaggedLines,
  customerName,
  quoteNumber,
}: {
  blendedMarginPct: number;
  targetPct: number;
  floorPct: number;
  flaggedLines: FlaggedLine[];
  customerName: string;
  quoteNumber: string;
}) {
  const [showOverride, setShowOverride] = useState(false);

  return (
    <>
      <div className="macc-header">
        <MarginVerdict
          blendedMarginPct={blendedMarginPct}
          status="BELOW_FLOOR"
          targetPct={targetPct}
          floorPct={floorPct}
        />
        <div className="macc-cta-cluster">
          <button className="macc-cta-primary" disabled>
            ⚠ Mark accepted · blocked
          </button>
          <button
            className="btn bad sm"
            style={{ borderStyle: "dashed" }}
            onClick={() => setShowOverride(true)}
          >
            ⚡ Request admin override
          </button>
        </div>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>
            Acceptance blocked · gate(s) firing
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
            Quote-level{" "}
            <em style={{ color: "var(--bad)", fontStyle: "italic" }}>
              BELOW FLOOR
            </em>
            {flaggedLines.length > 0 && (
              <>, plus {flaggedLines.length} line-level UNDERPRICED</>
            )}
          </h2>

          {flaggedLines.length > 0 && (
            <div
              style={{
                background: "var(--bad-soft)",
                border: "1px solid oklch(from var(--bad) l c h / 0.4)",
                borderRadius: 8,
                padding: "14px 18px",
                marginBottom: 14,
              }}
            >
              <p
                className="eyebrow"
                style={{ color: "var(--bad)", marginBottom: 8 }}
              >
                Lines requiring review
              </p>
              {flaggedLines.map((l, i) => (
                <div
                  key={`${l.sku}-${l.tier}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderTop:
                      i > 0 ? "1px solid oklch(from var(--bad) l c h / 0.2)" : "none",
                    fontSize: 12.5,
                  }}
                >
                  <span>
                    <strong>{l.sku}</strong> · {l.tier}
                  </span>
                  <span className="mono" style={{ color: "var(--bad)" }}>
                    {l.marginPct.toFixed(1)}% margin · {l.rule}
                  </span>
                </div>
              ))}
              <div
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: "var(--bad)",
                  marginTop: 10,
                  letterSpacing: 0.04,
                }}
              >
                + 1 quote-level: blended margin below floor (
                {blendedMarginPct.toFixed(1)}% &lt; {(floorPct * 100).toFixed(1)}
                %)
              </div>
            </div>
          )}

          <p className="eyebrow" style={{ marginBottom: 6 }}>
            Two paths forward
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <div
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--display)",
                  fontSize: 16,
                  fontWeight: 500,
                  marginBottom: 6,
                }}
              >
                (a) Tune up
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                Open Cost Build → adjust the flagged lines back into range →
                re-Mark accepted.
              </p>
              <button className="btn sm" style={{ marginTop: 12 }}>
                ← Back to Cost Build
              </button>
            </div>
            <div
              style={{
                background: "var(--paper-2)",
                border: "1px dashed var(--bad)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--display)",
                  fontSize: 16,
                  fontWeight: 500,
                  marginBottom: 6,
                }}
              >
                (b) Admin override
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                Slack DM to sales leadership. Reason captured. Approval logs to
                the quote. Gate unlocks; Mark-accepted enables.
              </p>
              <button
                className="btn bad sm"
                style={{ marginTop: 12, borderStyle: "dashed" }}
                onClick={() => setShowOverride(true)}
              >
                ⚡ Request override
              </button>
            </div>
          </div>
        </div>

        <aside className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Override workflow
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
            <li>Request override (button →)</li>
            <li>Slack DM drafts to leadership</li>
            <li>
              Reason logged to <code>quote_warnings</code>
            </li>
            <li>Out-of-band approval</li>
            <li>Approval logs back via Slack reaction or button click</li>
            <li>Mark-accepted enables · proceeds normally</li>
          </ol>

          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              background: "var(--warn-soft)",
              border: "1px solid oklch(from var(--warn) l c h / 0.4)",
              borderRadius: 6,
            }}
          >
            <p
              className="eyebrow"
              style={{ color: "var(--warn)", marginBottom: 4 }}
            >
              Override is auditable
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                color: "var(--ink-2)",
                lineHeight: 1.5,
              }}
            >
              Your reason and the approval thread are logged to the quote
              permanently. Anyone with quote access can see who overrode, when,
              and why.
            </p>
          </div>
        </aside>
      </div>

      <OverrideModal
        open={showOverride}
        onClose={() => setShowOverride(false)}
        customerName={customerName}
        quoteNumber={quoteNumber}
        blendedMarginPct={blendedMarginPct}
        floorPct={floorPct}
        flaggedLineCount={flaggedLines.length}
      />
    </>
  );
}

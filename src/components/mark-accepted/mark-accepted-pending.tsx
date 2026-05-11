"use client";

import { MarginVerdict } from "./margin-verdict";

export function MarkAcceptedPending({
  blendedMarginPct,
  targetPct,
  floorPct,
  customerName,
}: {
  blendedMarginPct: number;
  targetPct: number;
  floorPct: number;
  customerName: string;
}) {
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
            ⏳ Mark accepted · waiting on override
          </button>
          <span className="macc-cta-secondary">
            Slack DM sent · waiting on admin approval
          </span>
        </div>
      </div>

      <div className="pending-banner" style={{ margin: "16px 32px 0" }}>
        <div className="pulse" />
        <div className="text">
          <strong>
            Override request pending · Slack DM sent to sales leadership.
          </strong>{" "}
          You&rsquo;ll be notified in Slack and in-app the moment approval
          lands; this page will refresh.
          <span className="meta">
            quote_warnings.override_status = pending · stub data — Slice 12 wires real timing.
          </span>
        </div>
        <button className="btn sm">Re-send DM</button>
        <button className="btn sm ghost">Cancel request</button>
      </div>

      <div className="macc-preview-rail">
        <div className="macc-tier-list">
          <p className="eyebrow" style={{ marginBottom: 6 }}>
            What you can do while waiting
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
            The quote is{" "}
            <em style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
              frozen
            </em>{" "}
            for editing until override resolves
          </h2>

          <div
            style={{
              background: "var(--paper-2)",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              padding: "14px 18px",
              marginBottom: 14,
            }}
          >
            <p className="eyebrow" style={{ marginBottom: 8 }}>
              Cost Build is read-only during approval window
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              Editing during a pending override would invalidate the gate state
              the approver is approving against. If you need to tune lines,{" "}
              <strong>cancel the request</strong> first — that sends a &ldquo;
              request withdrawn&rdquo; Slack reply automatically.
            </p>
          </div>

          <p className="eyebrow" style={{ marginBottom: 6 }}>
            Recent activity (stub)
          </p>
          <div
            style={{
              background: "var(--paper-2)",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            {[
              { who: customerName, what: "(stub) override request audit row would render here", when: "—" },
            ].map((e, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr 60px",
                  padding: "6px 0",
                  borderTop: i > 0 ? "1px solid var(--rule)" : "none",
                  fontSize: 12,
                  alignItems: "center",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    letterSpacing: 0.04,
                  }}
                >
                  {e.who}
                </span>
                <span style={{ color: "var(--ink-2)" }}>{e.what}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    letterSpacing: 0.04,
                    textAlign: "right",
                  }}
                >
                  {e.when}
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="macc-side-rail">
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            What approval looks like
          </p>
          <p
            style={{
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              margin: "0 0 12px",
            }}
          >
            Admin replies in Slack thread, or clicks the link in the DM. Either
            path:
          </p>
          <ol
            style={{
              margin: 0,
              padding: "0 0 0 18px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.7,
            }}
          >
            <li>
              Approval logs to <code>quote_warnings</code>
            </li>
            <li>This page refreshes; banner becomes &ldquo;Approved&rdquo;</li>
            <li>Mark-accepted button enables</li>
            <li>You proceed with tier selection + confirmation as normal</li>
          </ol>
        </aside>
      </div>
    </>
  );
}

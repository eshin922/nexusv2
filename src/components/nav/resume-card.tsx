import Link from "next/link";
import {
  resolveSurfaceHref,
  SURFACE_ROUTES,
} from "@/lib/nav/surface-routes";
import type { ResumeContext } from "@/lib/nav/home-queries";

// Slice RI.9 §6 step 4 — Resume card.
//
// Renders on Home (next to inbox). Reads from `user_surface_visits`
// LIMIT 1 (latest visit) via `getResumeContext`. The unit a PM
// cares about is THE SURFACE THEY LAST TOUCHED ON THE QUOTE — not
// the project, not the quote in general (per R7a designer notes).
//
// Empty state when no rows (first-time PM) — explicit empty state,
// not missing affordance.
//
// Pushback 1 (§6 step 6): when now-tier inbox count > 0, render a
// "Check inbox first — N items" callout chip inside the card.
// Behind-scenes priority + visible PM signal = actual UX.

function formatRelativeTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD === 1) return "yesterday";
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ResumeCard({
  context,
  nowTierCount,
}: {
  context: ResumeContext | null;
  nowTierCount: number;
}) {
  if (!context) {
    return <EmptyResumeCard />;
  }

  const href = resolveSurfaceHref(
    context.surfaceKey,
    context.projectId,
    context.quoteId,
  );
  const surfaceLabel = SURFACE_ROUTES[context.surfaceKey].displayLabel;
  const hasNowTier = nowTierCount > 0;

  return (
    <section
      className="r9-resume-card"
      aria-label="Resume where you left off"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        borderRadius: 10,
        padding: "16px 18px",
      }}
    >
      <p
        className="r2-eyebrow"
        style={{ marginBottom: 8, color: "var(--ink-3)" }}
      >
        Continue where you left off · {formatRelativeTime(context.visitedAt)}
      </p>

      <h2
        style={{
          margin: 0,
          fontFamily: "var(--display)",
          fontWeight: 500,
          fontSize: 18,
          letterSpacing: "-0.005em",
          color: "var(--ink)",
        }}
      >
        <em style={{ fontStyle: "italic", color: "var(--ink-2)" }}>
          {context.projectName}
        </em>{" "}
        · {context.scenarioLabel} v{context.versionNumber}
      </h2>

      <p
        style={{
          margin: "4px 0 12px",
          fontSize: 12,
          color: "var(--ink-3)",
          fontFamily: "var(--mono)",
          letterSpacing: "0.02em",
        }}
      >
        Last on {surfaceLabel}
        {context.lastChangeSummary && (
          <>
            {" · "}
            <span style={{ color: "var(--ink-2)" }}>
              {context.lastChangeSummary}
            </span>
          </>
        )}
      </p>

      {/* Slice RI.9 §6 step 6 — Pushback 1 priority signal.
          When now-tier inbox items exist, the Resume card surfaces a
          chip pointing PM at the inbox first. Behind-scenes priority
          (CD recommendation) + visible PM signal (CA refinement) =
          actual UX. Hides when count = 0. */}
      {hasNowTier && (
        <Link
          href="#whats-my-move"
          className="r9-resume-inbox-chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 12,
            padding: "4px 10px",
            background: "var(--bad-soft)",
            color: "var(--bad)",
            border: "1px solid oklch(from var(--bad) l c h / 0.30)",
            borderRadius: 999,
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textDecoration: "none",
          }}
        >
          <span aria-hidden style={{ fontSize: 8 }}>●</span>
          Check inbox first — {nowTierCount} now-tier item
          {nowTierCount === 1 ? "" : "s"}
        </Link>
      )}

      <div>
        <Link
          href={href}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "var(--accent)",
            color: "var(--paper)",
            borderRadius: 6,
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.05em",
            textDecoration: "none",
          }}
        >
          Resume {surfaceLabel} →
        </Link>
      </div>
    </section>
  );
}

function EmptyResumeCard() {
  return (
    <section
      className="r9-resume-card r9-resume-card--empty"
      aria-label="No recent activity"
      style={{
        background: "var(--paper-2)",
        border: "1px dashed var(--rule)",
        borderRadius: 10,
        padding: "20px 18px",
      }}
    >
      <p
        className="r2-eyebrow"
        style={{ marginBottom: 8, color: "var(--ink-4)" }}
      >
        Continue where you left off
      </p>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--ink-3)",
          fontStyle: "italic",
          lineHeight: 1.5,
        }}
      >
        No recent activity. Pick a project to get started.
      </p>
    </section>
  );
}

"use client";

// Slice 11 follow-up (2026-07-15) — per-scenario actions menu on
// the project detail card header. Kebab `⋯` icon opens a small
// dropdown with:
//   - Copy scenario → opens the canonical modal in copy-scenario
//     mode with this scenario pre-selected as source (via
//     preSelectedSourceQuoteId prop on NewScenarioTrigger)
//   - Drop scenario → confirm dialog → dropScenario action
//
// Per Edward's disposition:
//   - Drop only shows when latest version status === 'draft'
//     (sent + accepted scenarios can't be dropped from the menu;
//     that requires admin override)
//   - Copy always shows
//
// Menu doesn't render for scenario_status !== 'active' (dropped /
// accepted scenarios have no options).

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dropScenario } from "@/app/actions/quotes";

export function ScenarioActionsMenu({
  projectId,
  scenarioLabel,
  latestQuoteId,
  latestQuoteStatus,
}: {
  projectId: string;
  scenarioLabel: string;
  latestQuoteId: string;
  latestQuoteStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const canDrop = latestQuoteStatus === "draft";

  function onDrop() {
    if (
      !confirm(
        `Drop scenario "${scenarioLabel}"?\n\n` +
          "This marks the scenario dropped:\n" +
          "  • Hidden from the project card\n" +
          "  • Admin override required to restore\n" +
          "  • Audit row emitted (drop_reason: manual)\n\n" +
          "Continue?",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await dropScenario({ projectId, scenarioLabel });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Scenario actions"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        style={{
          background: open ? "var(--paper-3)" : "transparent",
          border: "1px solid transparent",
          borderRadius: 4,
          padding: "2px 8px",
          cursor: "pointer",
          color: "var(--ink-3)",
          fontSize: 18,
          lineHeight: 1,
        }}
        title="Scenario actions"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 10,
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            boxShadow: "0 4px 12px oklch(0 0 0 / 0.08)",
            minWidth: 180,
            padding: 4,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // Navigate to project detail with `?copy_from=<id>`.
              // The page reads the param, passes it to
              // NewScenarioTrigger's initialSourceQuoteId, which
              // auto-opens the canonical modal in copy-scenario
              // mode with this scenario's latest quote pre-selected
              // as the source.
              router.push(
                `/projects/${projectId}?copy_from=${latestQuoteId}`,
              );
            }}
            disabled={pending}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
              color: "var(--ink)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--paper-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            ⧉ Copy scenario
          </button>
          {canDrop ? (
            <button
              type="button"
              role="menuitem"
              onClick={onDrop}
              disabled={pending}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "6px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--bad)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bad-soft)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {pending ? "Dropping…" : "🗑 Drop scenario"}
            </button>
          ) : (
            <div
              style={{
                padding: "6px 10px",
                fontSize: 11,
                color: "var(--ink-4)",
                fontStyle: "italic",
                borderTop: "1px solid var(--rule)",
                marginTop: 2,
              }}
              title="Sent + accepted quotes require admin override to drop"
            >
              Drop unavailable — status is {latestQuoteStatus}
            </div>
          )}
          {error && (
            <div
              role="alert"
              style={{
                padding: "6px 10px",
                fontSize: 11,
                color: "var(--bad)",
                borderTop: "1px solid var(--rule)",
                marginTop: 2,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

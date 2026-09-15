"use client";

import { createContext, useContext, useState, useTransition } from "react";
import {
  completeFreightHandoff,
  getLatestFreightHandoff,
  markReadyForFreight,
  withdrawFreightRequest,
  type LatestFreightHandoff,
} from "@/app/actions/freight-handoff";
import {
  getProductionCompletion,
  markProductionComplete,
  reopenProduction,
  type ProductionCompletionState,
} from "@/app/actions/production-completion";
import type { ActionResult } from "@/lib/action-result";

/**
 * Mark complete, inside each module.
 *
 * ── ONE FACT, TWO MODULES, NO SECOND RECORD ──────────────────────────────
 *
 * The standalone freight-handoff banner used to sit between Production and
 * Freight and carry both halves of the packaging → logistics handoff at once:
 * the request, the assignee, the delivery outcome and the close. It said all
 * of that in a place that was neither module.
 *
 * It is gone, and nothing underneath it changed. Packaging renders the
 * request end — marking Packaging complete IS `markReadyForFreight`, and
 * reopening it IS `withdrawFreightRequest`. Freight renders the holding end —
 * the assignee, whether Slack was actually told, and `completeFreightHandoff`.
 * Same rows, same audit entries, same notification. What moved is where the
 * operator reads and presses it.
 *
 * Because the two modules are two views of ONE row, they share state here
 * rather than each holding a copy. Marking Packaging complete has to make the
 * assignee appear under Freight in the same breath; two independent copies
 * would let one module show a handoff the other had already closed.
 *
 * Production is the exception, and the only new state in this work: it hands
 * nothing to anyone, so it has no handoff to render and needed a record of
 * its own. See `@/app/actions/production-completion`.
 *
 * ── IT REPORTS A DECISION, NOT A STATE OF THE DATA ───────────────────────
 *
 * No control here inspects whether a module's tiers look costed, and none is
 * ever disabled on that basis. Completion is a judgement an operator makes;
 * these record that they made it. A control that waited for the fields to
 * look finished would be answering a different question and refusing work on
 * the answer.
 *
 * ── A FAILED NOTIFICATION IS STILL SAID OUT LOUD ─────────────────────────
 *
 * The handoff exists whether or not Slack accepted the message, so Freight
 * shows the delivery outcome as what it was. Reporting a silent failure as a
 * success would leave a PM believing logistics had been told.
 */

type Ctx = {
  quoteId: string;
  /** The quote's own edit permission. Governs asking and taking back. */
  editable: boolean;
  viewerUserId: string;
  viewerIsAdmin: boolean;
  handoff: LatestFreightHandoff | null;
  setHandoff: (next: LatestFreightHandoff | null) => void;
  production: ProductionCompletionState | null;
  setProduction: (next: ProductionCompletionState | null) => void;
};

const ModuleCompletionContext = createContext<Ctx | null>(null);

export function ModuleCompletionProvider({
  quoteId,
  editable,
  viewerUserId,
  viewerIsAdmin,
  handoff: initialHandoff,
  production: initialProduction,
  children,
}: {
  quoteId: string;
  editable: boolean;
  viewerUserId: string;
  viewerIsAdmin: boolean;
  handoff: LatestFreightHandoff | null;
  production: ProductionCompletionState | null;
  children: React.ReactNode;
}) {
  const [handoff, setHandoff] = useState(initialHandoff);
  const [production, setProduction] = useState(initialProduction);
  return (
    <ModuleCompletionContext.Provider
      value={{
        quoteId,
        editable,
        viewerUserId,
        viewerIsAdmin,
        handoff,
        setHandoff,
        production,
        setProduction,
      }}
    >
      {children}
    </ModuleCompletionContext.Provider>
  );
}

/**
 * Null outside the provider rather than a throw.
 *
 * A drilldown is rendered in places other than the Costs page — tests, and
 * any future surface that reuses it. Those render the module without its
 * completion control, which is a module missing an affordance; throwing would
 * make it a module that does not render at all.
 */
function useModuleCompletion(): Ctx | null {
  return useContext(ModuleCompletionContext);
}

/** Runs one action, names WHICH one is in flight, and re-reads the truth. */
function useRunner() {
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Pattern 47(f) — pending state is ACTION-SCOPED. One flag naming WHICH
  // action is in flight, so completing never greys out reopening, and neither
  // disables anything else on the page.
  const run = (
    name: string,
    fn: (fd: FormData) => Promise<ActionResult<unknown>>,
    fields: Record<string, string | null | undefined>,
    after: () => Promise<void> | void,
  ) => {
    setError(null);
    setPendingAction(name);
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value) fd.set(key, value);
    }
    startTransition(async () => {
      const result = await fn(fd);
      if (!result.ok) {
        setPendingAction(null);
        setError(result.error.message);
        return;
      }
      await after();
      setPendingAction(null);
    });
  };

  return { error, pendingAction, run };
}

/* ───────────────────────── Packaging ───────────────────────── */

/**
 * Packaging's completion, which IS the freight request.
 *
 * "Mark complete" replaces the banner's "Ready for freight" and calls the
 * same action. The assignee and the Slack outcome are deliberately NOT
 * repeated here: they belong to whoever is holding the work, and that is the
 * Freight module.
 */
export function PackagingCompletion() {
  const ctx = useModuleCompletion();
  const { error, pendingAction, run } = useRunner();
  if (!ctx) return null;

  const { handoff, quoteId, editable } = ctx;
  const refresh = async () => {
    // Re-read rather than assume. The action returns what actually exists —
    // including, on the second click of a double-click, the handoff that was
    // already open.
    const r = await getLatestFreightHandoff(quoteId);
    if (r.ok) ctx.setHandoff(r.data);
  };

  const requested = handoff?.status === "open";
  const finished = handoff?.status === "completed";

  if (!requested && !finished) {
    if (!editable) return null;
    return (
      <Strip tone="idle" label="Not complete" error={error}>
        <Button
          primary
          busy={pendingAction === "ready"}
          busyLabel="Handing over…"
          onClick={() =>
            run("ready", markReadyForFreight, { quoteId }, refresh)
          }
        >
          Mark complete
        </Button>
      </Strip>
    );
  }

  return (
    <Strip
      tone="done"
      label="Complete"
      note={
        finished
          ? "Freight is finished."
          : `Handed to logistics ${handoff!.requestedAt.toLocaleDateString()}.`
      }
      error={error}
    >
      {/* Reopening is withdrawing the request, and a request that logistics
          has already closed cannot be withdrawn — so once Freight is finished
          the control is not offered rather than offered and refused. */}
      {requested && editable && (
        <Button
          busy={pendingAction === "withdraw"}
          busyLabel="Reopening…"
          onClick={() =>
            run(
              "withdraw",
              withdrawFreightRequest,
              // Names the handoff THIS screen is showing. The action
              // conditions on it, so a screen left open across a
              // withdraw-and-re-request cannot act on the replacement it
              // never displayed.
              { quoteId, handoffId: handoff!.handoffId },
              refresh,
            )
          }
        >
          Reopen
        </Button>
      )}
    </Strip>
  );
}

/* ───────────────────────── Production ───────────────────────── */

/** Production's completion. The only module whose state is its own. */
export function ProductionCompletion() {
  const ctx = useModuleCompletion();
  const { error, pendingAction, run } = useRunner();
  if (!ctx) return null;

  const { production, quoteId, editable } = ctx;
  const refresh = async () => {
    const r = await getProductionCompletion(quoteId);
    if (r.ok) ctx.setProduction(r.data);
  };

  if (!production) {
    if (!editable) return null;
    return (
      <Strip tone="idle" label="Not complete" error={error}>
        <Button
          primary
          busy={pendingAction === "complete"}
          busyLabel="Saving…"
          onClick={() =>
            run("complete", markProductionComplete, { quoteId }, refresh)
          }
        >
          Mark complete
        </Button>
      </Strip>
    );
  }

  return (
    <Strip
      tone="done"
      label="Complete"
      note={`${production.completedByEmail ?? "Marked"} · ${production.completedAt.toLocaleDateString()}`}
      error={error}
    >
      {editable && (
        <Button
          busy={pendingAction === "reopen"}
          busyLabel="Reopening…"
          onClick={() =>
            run(
              "reopen",
              reopenProduction,
              { completionId: production.completionId },
              refresh,
            )
          }
        >
          Reopen
        </Button>
      )}
    </Strip>
  );
}

/* ───────────────────────── Freight ───────────────────────── */

/**
 * Freight's end of the handoff: who is holding it, whether they were actually
 * told, and the control that closes it.
 *
 * Completion is NOT gated on the quote being editable. Freight work continues
 * after a quote is sent, and requiring draft here would hide the control in
 * exactly the state the work is most often done in — which is also why the
 * action itself is not draft-gated.
 */
export function FreightCompletion() {
  const ctx = useModuleCompletion();
  const { error, pendingAction, run } = useRunner();
  if (!ctx) return null;

  const { handoff, quoteId, viewerUserId, viewerIsAdmin } = ctx;

  if (!handoff || handoff.status === "withdrawn") {
    return (
      <Strip
        tone="idle"
        label="Not handed over"
        note="Packaging hands the freight work over when it is complete."
        error={error}
      />
    );
  }

  if (handoff.status === "completed") {
    return (
      <Strip
        tone="done"
        label="Complete"
        note={
          handoff.completedAt
            ? `${handoff.completedByEmail ?? "Closed"} · ${handoff.completedAt.toLocaleDateString()}`
            : undefined
        }
        error={error}
      />
    );
  }

  // The holder, or an admin. The action enforces the same boundary; this is
  // the affordance.
  const canComplete = viewerIsAdmin || viewerUserId === handoff.assignedToUserId;

  return (
    <Strip
      tone="open"
      label="With logistics"
      note={
        `${handoff.assignedToEmail ?? "logistics"} · since ${handoff.requestedAt.toLocaleDateString()}` +
        (handoff.notificationStatus === "failed"
          ? " · Slack was not notified — tell them directly"
          : handoff.notificationStatus === "not_configured"
            ? " · no Slack notification was sent; none is configured"
            : "")
      }
      error={error}
    >
      {canComplete && (
        <Button
          primary
          busy={pendingAction === "complete"}
          busyLabel="Saving…"
          onClick={() =>
            run(
              "complete",
              completeFreightHandoff,
              { quoteId, handoffId: handoff.handoffId },
              async () => {
                const r = await getLatestFreightHandoff(quoteId);
                if (r.ok) ctx.setHandoff(r.data);
              },
            )
          }
        >
          Mark complete
        </Button>
      )}
    </Strip>
  );
}

/* ───────────────────────── presentation ───────────────────────── */

const TONES = {
  idle: "var(--ink-3)",
  open: "var(--accent)",
  done: "oklch(0.62 0.13 150)",
} as const;

function Strip({
  tone,
  label,
  note,
  error,
  children,
}: {
  tone: keyof typeof TONES;
  label: string;
  note?: string;
  error: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="mod-complete"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: TONES[tone],
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.04em",
          color: "var(--ink)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {note && (
        <span style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 0 }}>{note}</span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--danger, #b42318)" }}>
          {error}
        </span>
      )}
      {children}
    </div>
  );
}

function Button({
  primary,
  busy,
  busyLabel,
  onClick,
  children,
}: {
  primary?: boolean;
  busy: boolean;
  busyLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 5,
        border: primary ? "1px solid var(--accent)" : "1px solid var(--rule)",
        background: primary ? "var(--accent)" : "var(--paper)",
        color: primary ? "var(--paper)" : "var(--ink-2)",
        cursor: busy ? "default" : "pointer",
        flexShrink: 0,
      }}
    >
      {busy ? busyLabel : children}
    </button>
  );
}

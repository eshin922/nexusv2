"use client";

import { createContext, useContext, useRef, useState, useTransition } from "react";
import type { LatestFreightHandoff } from "@/app/actions/freight-handoff";
import type { ProductionCompletionState } from "@/app/actions/production-completion";
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
 * Same rows, same audit entries, same notification, same permissions. What
 * moved is where the operator reads and presses it.
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
 *
 * ── AND SO IS A FAILED READ-BACK ─────────────────────────────────────────
 *
 * Every one of these actions is followed by a re-read, because the action
 * returns what actually exists rather than what the click assumed. That
 * re-read can fail on its own, and when it does the write has ALREADY
 * LANDED. Swallowing it would leave the module showing "Not complete" beside
 * a completion that exists — and the obvious operator response to that is to
 * press the button again, which is the one thing that must not be suggested.
 *
 * So the three outcomes are kept apart, and the third is never folded into
 * the second (Pattern 60):
 *
 *   refused        the action said no. Nothing was written, the message is
 *                  the reason, and the control stays exactly as it was —
 *                  pressing again is a legitimate thing to do.
 *   indeterminate  the request failed before it could report. It may or may
 *                  not have saved, so the module refuses to claim either.
 *   stale          the action SUCCEEDED and the read-back failed. The save
 *                  landed; only the display is behind.
 *
 * The last two both replace the strip with `Unresolved`, which offers one
 * control: re-read the status. The completion action is deliberately NOT
 * reachable from there — a repeat is what the operator would reach for and
 * what neither state warrants.
 */

/**
 * The actions, injectable.
 *
 * Every behaviour above is a RENDER decision made in response to what an
 * action returned, and the interesting ones are the failures. Reading the
 * source cannot settle what the control does when a read-back rejects; a
 * mounted test driving these can.
 *
 * Supplied by the Costs page rather than imported here, and this file imports
 * only TYPES from the two action modules. Importing the actions themselves
 * would pull `@/db` into the module graph, and a mounted test would then need
 * a database to render a button.
 */
export type ModuleCompletionServices = {
  markReadyForFreight: (fd: FormData) => Promise<ActionResult<unknown>>;
  withdrawFreightRequest: (fd: FormData) => Promise<ActionResult<unknown>>;
  completeFreightHandoff: (fd: FormData) => Promise<ActionResult<unknown>>;
  markProductionComplete: (fd: FormData) => Promise<ActionResult<unknown>>;
  reopenProduction: (fd: FormData) => Promise<ActionResult<unknown>>;
  readHandoff: (quoteId: string) => Promise<ActionResult<LatestFreightHandoff | null>>;
  readProduction: (
    quoteId: string,
  ) => Promise<ActionResult<ProductionCompletionState | null>>;
};

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
  services: ModuleCompletionServices;
};

const ModuleCompletionContext = createContext<Ctx | null>(null);

export function ModuleCompletionProvider({
  quoteId,
  editable,
  viewerUserId,
  viewerIsAdmin,
  handoff: initialHandoff,
  production: initialProduction,
  services,
  children,
}: {
  quoteId: string;
  editable: boolean;
  viewerUserId: string;
  viewerIsAdmin: boolean;
  handoff: LatestFreightHandoff | null;
  production: ProductionCompletionState | null;
  services: ModuleCompletionServices;
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
        services,
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

/* ───────────────────────── the runner ───────────────────────── */

/** What happened, kept apart so the control can respond to each honestly. */
type Outcome =
  | { kind: "refused"; message: string }
  | { kind: "indeterminate"; message: string }
  | { kind: "stale"; message: string };

/** Re-reads the module's state. Returns the result rather than swallowing it. */
type ReadBack = () => Promise<ActionResult<unknown>>;

const REFRESH = "refresh";

function describe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The request did not complete.";
}

function useRunner() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // The last read-back attempted, so "Refresh status" re-reads THAT and
  // nothing else. It is deliberately not the action: a refresh must never be
  // able to repeat a completion.
  const readBackRef = useRef<ReadBack | null>(null);

  const readBack = async (): Promise<Outcome | null> => {
    const read = readBackRef.current;
    if (!read) return null;
    try {
      const result = await read();
      return result.ok ? null : { kind: "stale", message: result.error.message };
    } catch (error) {
      return { kind: "stale", message: describe(error) };
    }
  };

  // Pattern 47(f) — pending state is ACTION-SCOPED. One flag naming WHICH
  // action is in flight, so completing never greys out reopening, and neither
  // disables anything else on the page.
  const run = (
    name: string,
    action: (fd: FormData) => Promise<ActionResult<unknown>>,
    fields: Record<string, string | null | undefined>,
    read: ReadBack,
  ) => {
    setOutcome(null);
    setPendingAction(name);
    readBackRef.current = read;
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value) fd.set(key, value);
    }
    startTransition(async () => {
      // `finally`, not a call on each path. A throw anywhere in here used to
      // leave `pendingAction` set, which is a button that says "Saving…"
      // forever — the operator's only recourse being a reload, with no idea
      // whether anything saved.
      try {
        let result: ActionResult<unknown>;
        try {
          result = await action(fd);
        } catch (error) {
          // The request failed before it could report. Whether it reached the
          // server is exactly what is not known, so neither answer is given.
          setOutcome({ kind: "indeterminate", message: describe(error) });
          return;
        }
        if (!result.ok) {
          // An ordinary refusal: the guard threw before anything was written.
          // The control stays as it was, because pressing again is reasonable.
          setOutcome({ kind: "refused", message: result.error.message });
          return;
        }
        // Succeeded. Anything that goes wrong from here is the READ-BACK, and
        // the write has already landed.
        setOutcome(await readBack());
      } finally {
        setPendingAction(null);
      }
    });
  };

  /** Re-read the status. Never repeats the action that got us here. */
  const refreshStatus = () => {
    setPendingAction(REFRESH);
    startTransition(async () => {
      try {
        // `null` on success, which clears the banner and returns the module to
        // whatever the server actually says.
        setOutcome(await readBack());
      } finally {
        setPendingAction(null);
      }
    });
  };

  return { outcome, pendingAction, run, refreshStatus };
}

/* ───────────────────────── Packaging ───────────────────────── */

/**
 * Packaging's completion, which IS the freight request.
 *
 * "Mark complete" replaces the banner's "Ready for freight" and calls the
 * same action. The assignee and the Slack outcome are deliberately NOT
 * repeated here: they belong to whoever is holding the work, and that is the
 * Freight module.
 *
 * ── PACKAGING CANNOT BE REOPENED ONCE FREIGHT IS COMPLETE ────────────────
 *
 * Reopening Packaging IS withdrawing the freight request, and
 * `withdrawFreightRequest` updates `WHERE status = 'open'` — a request
 * logistics has already closed is not open, so the action refuses it as a
 * STALE_WRITE. That is existing, deliberate lifecycle behaviour: the work was
 * handed over, done, and reported done, and pulling the request back
 * afterwards would rewrite someone else's finished task.
 *
 * So the control is not offered in that state, and the strip SAYS why rather
 * than leaving a button quietly missing. Offering it and letting the refusal
 * surface would be the worse trade — Pattern 47(f) asks that a control the
 * operator cannot use explain itself, and an absent one has to as well.
 *
 * This fix does NOT change that behaviour. Whether a completed handoff should
 * ever be reopenable — by an admin, by a new request, at all — is a lifecycle
 * question, not a defect in how the failure is reported, and it is out of
 * scope here.
 */
export function PackagingCompletion() {
  const ctx = useModuleCompletion();
  const { outcome, pendingAction, run, refreshStatus } = useRunner();
  if (!ctx) return null;

  const { handoff, quoteId, editable, services } = ctx;
  // Re-read rather than assume. The action returns what actually exists —
  // including, on the second click of a double-click, the handoff that was
  // already open.
  const read: ReadBack = async () => {
    const result = await services.readHandoff(quoteId);
    if (result.ok) ctx.setHandoff(result.data);
    return result;
  };

  if (outcome && outcome.kind !== "refused") {
    return (
      <Unresolved outcome={outcome} busy={pendingAction === REFRESH} onRefresh={refreshStatus} />
    );
  }
  const error = outcome?.message ?? null;

  const requested = handoff?.status === "open";
  const finished = handoff?.status === "completed";

  if (!requested && !finished) {
    if (!editable) return null;
    return (
      <Strip state="idle" label="Not complete" error={error}>
        <Button
          primary
          busy={pendingAction === "ready"}
          busyLabel="Handing over…"
          onClick={() => run("ready", services.markReadyForFreight, { quoteId }, read)}
        >
          Mark complete
        </Button>
      </Strip>
    );
  }

  return (
    <Strip
      state="done"
      label="Complete"
      note={
        finished
          ? // Named, not silent. The absent Reopen is the lifecycle, not an
            // oversight, and an operator should not have to discover that by
            // looking for a button that is not there.
            "Freight is finished, so this can no longer be reopened."
          : `Handed to logistics ${handoff!.requestedAt.toLocaleDateString()}.`
      }
      error={error}
    >
      {requested && editable && (
        <Button
          busy={pendingAction === "withdraw"}
          busyLabel="Reopening…"
          onClick={() =>
            run(
              "withdraw",
              services.withdrawFreightRequest,
              // Names the handoff THIS screen is showing. The action
              // conditions on it, so a screen left open across a
              // withdraw-and-re-request cannot act on the replacement it
              // never displayed.
              { quoteId, handoffId: handoff!.handoffId },
              read,
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
  const { outcome, pendingAction, run, refreshStatus } = useRunner();
  if (!ctx) return null;

  const { production, quoteId, editable, services } = ctx;
  const read: ReadBack = async () => {
    const result = await services.readProduction(quoteId);
    if (result.ok) ctx.setProduction(result.data);
    return result;
  };

  if (outcome && outcome.kind !== "refused") {
    return (
      <Unresolved outcome={outcome} busy={pendingAction === REFRESH} onRefresh={refreshStatus} />
    );
  }
  const error = outcome?.message ?? null;

  if (!production) {
    if (!editable) return null;
    return (
      <Strip state="idle" label="Not complete" error={error}>
        <Button
          primary
          busy={pendingAction === "complete"}
          busyLabel="Saving…"
          onClick={() => run("complete", services.markProductionComplete, { quoteId }, read)}
        >
          Mark complete
        </Button>
      </Strip>
    );
  }

  return (
    <Strip
      state="done"
      label="Complete"
      note={`${production.completedByEmail ?? "Marked"} · ${production.completedAt.toLocaleDateString()}`}
      error={error}
    >
      {editable && (
        <Button
          busy={pendingAction === "reopen"}
          busyLabel="Reopening…"
          onClick={() =>
            run("reopen", services.reopenProduction, { completionId: production.completionId }, read)
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
  const { outcome, pendingAction, run, refreshStatus } = useRunner();
  if (!ctx) return null;

  const { handoff, quoteId, viewerUserId, viewerIsAdmin, services } = ctx;
  const read: ReadBack = async () => {
    const result = await services.readHandoff(quoteId);
    if (result.ok) ctx.setHandoff(result.data);
    return result;
  };

  if (outcome && outcome.kind !== "refused") {
    return (
      <Unresolved outcome={outcome} busy={pendingAction === REFRESH} onRefresh={refreshStatus} />
    );
  }
  const error = outcome?.message ?? null;

  if (!handoff || handoff.status === "withdrawn") {
    return (
      <Strip
        state="idle"
        label="Not handed over"
        note="Packaging hands the freight work over when it is complete."
        error={error}
      />
    );
  }

  if (handoff.status === "completed") {
    return (
      <Strip
        state="done"
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
      state="open"
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
              services.completeFreightHandoff,
              { quoteId, handoffId: handoff.handoffId },
              read,
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

/**
 * The module's state could not be read back.
 *
 * Replaces the strip rather than sitting beside it, and that is the point: a
 * state this cannot render honestly must not render a stale version of itself
 * with its action button still live. The one control offered re-reads the
 * status. Completing again is what an operator would otherwise reach for, and
 * neither of these two states warrants it — in one the save already landed,
 * and in the other whether it landed is precisely what is unknown.
 */
function Unresolved({
  outcome,
  busy,
  onRefresh,
}: {
  outcome: Outcome;
  busy: boolean;
  onRefresh: () => void;
}) {
  const stale = outcome.kind === "stale";
  return (
    <Strip
      state={stale ? "stale" : "indeterminate"}
      label={stale ? "Saved" : "Not known"}
      note={
        stale
          ? "The change saved. Reading the status back failed, so it is not shown here — refresh it rather than pressing complete again."
          : "The request failed before it reported, so whether it saved is not known. Refresh the status rather than pressing complete again."
      }
      error={outcome.message}
    >
      <Button busy={busy} busyLabel="Refreshing…" onClick={onRefresh}>
        Refresh status
      </Button>
    </Strip>
  );
}

const TONES = {
  idle: "var(--ink-3)",
  open: "var(--accent)",
  done: "oklch(0.62 0.13 150)",
  stale: "var(--warn, #b54708)",
  indeterminate: "var(--warn, #b54708)",
} as const;

function Strip({
  state,
  label,
  note,
  error,
  children,
}: {
  state: keyof typeof TONES;
  label: string;
  note?: string;
  error: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="mod-complete"
      data-testid="module-completion"
      data-state={state}
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
          background: TONES[state],
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

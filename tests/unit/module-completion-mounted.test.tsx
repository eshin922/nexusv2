// MOUNTED tests for the module completion controls.
//
// What is under test is the FAILURE handling, and every part of it is a render
// decision made in response to what an action returned. Reading the source
// cannot settle any of it:
//
//   * a refusal must clear the pending state — a button left saying "Saving…"
//     forever is an operator whose only recourse is a reload, with no idea
//     whether anything saved
//   * a THROWN request must clear it too, which is the path a `catch` on each
//     branch misses and a `finally` does not
//   * a save that landed while the read-back failed must SAY so, and must
//     offer to re-read the status — never to repeat the completion
//   * and the refresh it offers must call the read, not the action
//
// The database-bound half — who may complete, what a second click does, what
// the audit records — is exercised against real Postgres by
// `scripts/gate-1b/module-completion-walk.ts`.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { flush, mount } from "../support/mount.tsx";
import {
  FreightCompletion,
  ModuleCompletionProvider,
  PackagingCompletion,
  ProductionCompletion,
  type ModuleCompletionServices,
} from "../../src/components/costs/module-completion.tsx";
import type { LatestFreightHandoff } from "../../src/app/actions/freight-handoff.ts";
import type { ProductionCompletionState } from "../../src/app/actions/production-completion.ts";

const QUOTE = "quote-1";
const HOLDER = "user-logistics";

const OPEN_HANDOFF: LatestFreightHandoff = {
  handoffId: "handoff-1",
  quoteId: QUOTE,
  status: "open",
  assignedToUserId: HOLDER,
  assignedToEmail: "logistics@example.invalid",
  requestedAt: new Date("2026-09-01T00:00:00Z"),
  completedAt: null,
  completedByEmail: null,
  notificationStatus: "delivered",
  notificationError: null,
};

const COMPLETED_HANDOFF: LatestFreightHandoff = {
  ...OPEN_HANDOFF,
  status: "completed",
  completedAt: new Date("2026-09-03T00:00:00Z"),
  completedByEmail: "logistics@example.invalid",
};

const PRODUCTION_DONE: ProductionCompletionState = {
  completionId: "completion-1",
  quoteId: QUOTE,
  completedByUserId: "user-pm",
  completedByEmail: "pm@example.invalid",
  completedAt: new Date("2026-09-02T00:00:00Z"),
};

type Calls = { action: string[]; read: string[] };

/**
 * Services that record what was called.
 *
 * `action` and `read` are kept in SEPARATE lists on purpose: the claim under
 * test in the refresh cases is that one of them fires and the other does not,
 * and a single call log would make that claim harder to state than to check.
 */
function services(
  over: Partial<ModuleCompletionServices> = {},
): { svc: ModuleCompletionServices; calls: Calls } {
  const calls: Calls = { action: [], read: [] };
  const ok = (name: string) => async () => {
    calls.action.push(name);
    return { ok: true as const, data: {} };
  };
  const svc: ModuleCompletionServices = {
    markReadyForFreight: ok("markReadyForFreight"),
    withdrawFreightRequest: ok("withdrawFreightRequest"),
    completeFreightHandoff: ok("completeFreightHandoff"),
    markProductionComplete: ok("markProductionComplete"),
    reopenProduction: ok("reopenProduction"),
    readHandoff: async () => {
      calls.read.push("readHandoff");
      return { ok: true as const, data: OPEN_HANDOFF };
    },
    readProduction: async () => {
      calls.read.push("readProduction");
      return { ok: true as const, data: PRODUCTION_DONE };
    },
    ...over,
  };
  return { svc, calls };
}

function render(
  control: React.ReactNode,
  svc: ModuleCompletionServices,
  over: Partial<{
    handoff: LatestFreightHandoff | null;
    production: ProductionCompletionState | null;
    editable: boolean;
    viewerUserId: string;
    viewerIsAdmin: boolean;
  }> = {},
) {
  return (
    <ModuleCompletionProvider
      quoteId={QUOTE}
      editable={over.editable ?? true}
      viewerUserId={over.viewerUserId ?? HOLDER}
      viewerIsAdmin={over.viewerIsAdmin ?? false}
      handoff={over.handoff ?? null}
      production={over.production ?? null}
      services={svc}
    >
      {control}
    </ModuleCompletionProvider>
  );
}

const strip = (m: { byTestId: (id: string) => Element | null }) =>
  m.byTestId("module-completion");
const state = (m: { byTestId: (id: string) => Element | null }) =>
  strip(m)?.getAttribute("data-state");
const buttons = (m: { findAll: (s: string) => Element[] }) =>
  m.findAll("button").map((b) => b.textContent?.trim());

/* ── 1 · a refusal clears the pending state ───────────────────────────── */

test("a refused action reports the reason and frees the button", async () => {
  const { svc, calls } = services({
    markReadyForFreight: async () => ({
      ok: false as const,
      error: { code: "VALIDATION", message: "No logistics recipient is configured." },
    }),
  });
  const m = await mount(render(<PackagingCompletion />, svc));

  await m.click("button");
  await flush();

  assert.match(m.text(), /No logistics recipient is configured\./);
  // Still the ordinary strip: nothing was written, so pressing again is a
  // legitimate thing to do and the control stays exactly as it was.
  assert.equal(state(m), "idle");
  assert.deepEqual(buttons(m), ["Mark complete"], "the button is stuck mid-save");
  assert.equal(
    (m.find("button") as HTMLButtonElement).disabled,
    false,
    "the button is still disabled after the action already failed",
  );
  assert.deepEqual(calls.read, [], "a refused action still tried to re-read");
  await m.unmount();
});

test("and so does a request that throws", async () => {
  // The path a per-branch `catch` misses: the action never returns at all.
  // Before the `finally`, this left the button reading "Saving…" permanently.
  const { svc, calls } = services({
    markProductionComplete: async () => {
      // Records BEFORE throwing, so the last assertion can establish that the
      // action really was invoked. A double that throws first would leave an
      // empty log that reads the same as "never called".
      calls.action.push("markProductionComplete");
      throw new Error("Failed to fetch");
    },
  });
  const m = await mount(render(<ProductionCompletion />, svc));

  await m.click("button");
  await flush();

  const only = m.find("button") as HTMLButtonElement;
  assert.equal(only.disabled, false, "the button never came back from the throw");
  assert.notEqual(only.textContent?.trim(), "Saving…");
  // Indeterminate, NOT refused: whether it reached the server is exactly what
  // is unknown, so neither answer is claimed.
  assert.equal(state(m), "indeterminate");
  assert.match(m.text(), /whether it saved is not known/i);
  assert.match(m.text(), /Failed to fetch/);
  assert.deepEqual(buttons(m), ["Refresh status"], "a repeat of the action is offered");
  assert.deepEqual(calls.action, ["markProductionComplete"]);
  await m.unmount();
});

/* ── 2 · saved, but the read-back failed ──────────────────────────────── */

test("a save whose read-back fails says the save landed", async () => {
  const { svc, calls } = services({
    readHandoff: async () => {
      calls.read.push("readHandoff");
      return {
        ok: false as const,
        error: { code: "UNKNOWN", message: "Connection closed." },
      };
    },
  });
  const m = await mount(render(<PackagingCompletion />, svc));

  await m.click("button");
  await flush();

  assert.deepEqual(calls.action, ["markReadyForFreight"], "the action did not run");
  assert.equal(state(m), "stale");
  assert.match(m.text(), /The change saved\./);
  assert.match(m.text(), /Reading the status back failed/i);
  assert.match(m.text(), /Connection closed\./);
  // The completion is NOT reachable from here. An operator looking at a module
  // that still said "Not complete" would press it again; this is the state
  // that must not offer that.
  assert.deepEqual(buttons(m), ["Refresh status"]);
  assert.equal((m.find("button") as HTMLButtonElement).disabled, false);
  await m.unmount();
});

test("a read-back that throws is treated the same way", async () => {
  const { svc } = services({
    readProduction: async () => {
      throw new Error("NetworkError");
    },
  });
  const m = await mount(render(<ProductionCompletion />, svc));

  await m.click("button");
  await flush();

  assert.equal(state(m), "stale");
  assert.match(m.text(), /The change saved\./);
  assert.deepEqual(buttons(m), ["Refresh status"]);
  await m.unmount();
});

test("Refresh status re-reads, and does not repeat the completion", async () => {
  let readFails = true;
  const { svc, calls } = services({
    readHandoff: async () => {
      calls.read.push("readHandoff");
      if (readFails) {
        return { ok: false as const, error: { code: "UNKNOWN", message: "Connection closed." } };
      }
      return { ok: true as const, data: OPEN_HANDOFF };
    },
  });
  const m = await mount(render(<PackagingCompletion />, svc));

  await m.click("button");
  await flush();
  assert.equal(state(m), "stale");

  readFails = false;
  await m.click("button"); // the only button here is Refresh status
  await flush();

  // THE assertion this test exists for: refreshing called the read a second
  // time and the action not once more. A refresh that re-ran the completion
  // would be the failure mode the whole state was introduced to avoid.
  assert.deepEqual(calls.action, ["markReadyForFreight"], "refreshing repeated the action");
  assert.deepEqual(calls.read, ["readHandoff", "readHandoff"]);
  // And the module returns to whatever the server actually says.
  assert.equal(state(m), "done");
  assert.match(m.text(), /Handed to logistics/);
  await m.unmount();
});

test("a refresh that fails again stays unresolved rather than reverting", async () => {
  const { svc, calls } = services({
    readHandoff: async () => {
      calls.read.push("readHandoff");
      return { ok: false as const, error: { code: "UNKNOWN", message: "Still down." } };
    },
  });
  const m = await mount(render(<PackagingCompletion />, svc));

  await m.click("button");
  await flush();
  await m.click("button");
  await flush();

  assert.equal(state(m), "stale", "a failed refresh dropped back to a stale display");
  assert.deepEqual(buttons(m), ["Refresh status"]);
  assert.equal(calls.read.length, 2);
  assert.deepEqual(calls.action, ["markReadyForFreight"]);
  await m.unmount();
});

/* ── 3 · the same handling on the Freight end ─────────────────────────── */

test("Freight's Mark complete handles a failed read-back the same way", async () => {
  const { svc, calls } = services({
    readHandoff: async () => {
      calls.read.push("readHandoff");
      return { ok: false as const, error: { code: "UNKNOWN", message: "Connection closed." } };
    },
  });
  const m = await mount(render(<FreightCompletion />, svc, { handoff: OPEN_HANDOFF }));

  assert.equal(state(m), "open");
  await m.click("button");
  await flush();

  assert.deepEqual(calls.action, ["completeFreightHandoff"]);
  assert.equal(state(m), "stale");
  assert.deepEqual(buttons(m), ["Refresh status"]);
  await m.unmount();
});

/* ── 4 · the lifecycle this fix leaves alone ──────────────────────────── */

test("Packaging cannot be reopened once Freight is complete, and says why", async () => {
  // Reopening Packaging IS withdrawing the freight request, and the action
  // updates `WHERE status = 'open'` — a completed handoff is not open, so it
  // refuses as STALE_WRITE. Existing, deliberate lifecycle behaviour, left
  // unchanged here. What this asserts is that the absent control EXPLAINS
  // itself rather than being quietly missing.
  const { svc, calls } = services();
  const m = await mount(render(<PackagingCompletion />, svc, { handoff: COMPLETED_HANDOFF }));

  assert.equal(state(m), "done");
  assert.match(m.text(), /Freight is finished, so this can no longer be reopened\./);
  assert.deepEqual(buttons(m), [], "Reopen is offered on a handoff the action would refuse");
  assert.deepEqual(calls.action, []);
  await m.unmount();
});

test("but it can be reopened while the request is still open", async () => {
  // The control above is absent for a reason, not because nothing renders one.
  const { svc, calls } = services();
  const m = await mount(render(<PackagingCompletion />, svc, { handoff: OPEN_HANDOFF }));

  assert.deepEqual(buttons(m), ["Reopen"]);
  await m.click("button");
  await flush();
  assert.deepEqual(calls.action, ["withdrawFreightRequest"]);
  await m.unmount();
});

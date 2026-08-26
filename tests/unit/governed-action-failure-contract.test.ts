/**
 * The failure contract for governed server actions.
 *
 * Soak run 5 measured `POST .../quote 503` on Finalize: the quote stayed in
 * `draft`, no error appeared anywhere, and the button returned to looking
 * exactly as it had. The operator's only evidence that the freeze had failed
 * was that the page did not change.
 *
 * These assert the contract Edward set: a structured refusal keeps rendering
 * the server's authoritative message; a rejection is caught and surfaced; no
 * success is implied; pending clears; retry works; and a stale error does not
 * outlive a later success.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionResult } from "../../src/lib/action-result.ts";
import {
  runGoverned,
  runGovernedRaw,
  failureMessage,
  UNREACHABLE_MESSAGE,
} from "../../src/lib/governed-action.ts";

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const refused = (code: string, message: string): ActionResult<never> => ({
  ok: false,
  error: { code, message },
});

// ── 1 · structured server refusal ───────────────────────────────────────────

test("a structured refusal keeps the server's own message, verbatim", async () => {
  const sentence =
    "Tier 1 is below the 25.0% margin floor and has no valid authorization.";
  const r = await runGoverned(async () => refused("BELOW_FLOOR", sentence));

  assert.equal(r.kind, "refused");
  assert.equal(r.kind === "refused" && r.message, sentence);
  assert.equal(r.kind === "refused" && r.code, "BELOW_FLOOR");
  // Not paraphrased, and NOT replaced by the transport sentence — the two
  // failures send an operator to two different places.
  assert.notEqual(failureMessage(r), UNREACHABLE_MESSAGE);
});

test("a refusal carries its structured details through", async () => {
  const rows = [{ leaf: "Bottle", reason: "no cost" }];
  const r = await runGoverned(
    async () =>
      ({
        ok: false,
        error: { code: "UNRESOLVED_COSTS", message: "Unresolved costs.", details: rows },
      }) as ActionResult<never>,
  );
  assert.equal(r.kind, "refused");
  assert.deepEqual(r.kind === "refused" ? r.details : null, rows);
});

// ── 2 · rejected promise / simulated transport failure ──────────────────────

test("a rejected promise resolves to unreachable rather than escaping", async () => {
  const r = await runGoverned<never>(async () => {
    throw new Error("Failed to fetch");
  });

  assert.equal(r.kind, "unreachable");
  assert.equal(failureMessage(r), UNREACHABLE_MESSAGE);
  assert.equal(
    r.kind === "unreachable" && (r.cause as Error).message,
    "Failed to fetch",
  );
});

test("a synchronous throw is caught too", async () => {
  const r = await runGoverned<never>(() => {
    throw new Error("boom");
  });
  assert.equal(r.kind, "unreachable");
});

test("the unreachable sentence does not claim the write did not happen", () => {
  // A 503 can be a function that died before its transaction or after it. The
  // client cannot tell, so the message must not assert either.
  const lowered = UNREACHABLE_MESSAGE.toLowerCase();
  for (const claim of ["nothing was saved", "was not saved", "did not go through"]) {
    assert.ok(!lowered.includes(claim), `must not claim: ${claim}`);
  }
  assert.ok(lowered.includes("may or may not"));
  assert.ok(lowered.includes("try again"));
});

test("a malformed answer is unreachable, never ok", async () => {
  // Something replied, but not the action — an HTML error page, a proxy body.
  for (const junk of [undefined, null, "<!doctype html>", {}, 42]) {
    const r = await runGoverned(async () => junk as unknown as ActionResult<unknown>);
    assert.equal(r.kind, "unreachable", `junk: ${JSON.stringify(junk)}`);
  }
});

// ── 3 · successful action ───────────────────────────────────────────────────

test("a success carries its data and reports no failure", async () => {
  const r = await runGoverned(async () => ok({ quoteNumber: "DPS-1065" }));
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.kind === "ok" ? r.data : null, { quoteNumber: "DPS-1065" });
  assert.equal(failureMessage(r), null);
});

// ── 4 · retry after transport failure ───────────────────────────────────────

test("retry after a transport failure reaches the server and succeeds", async () => {
  let attempt = 0;
  const call = async (): Promise<ActionResult<{ sent: boolean }>> => {
    attempt += 1;
    if (attempt === 1) throw new Error("503");
    return ok({ sent: true });
  };

  const first = await runGoverned(call);
  assert.equal(first.kind, "unreachable");

  // Nothing about the first outcome blocks or poisons the second — the helper
  // holds no state, which is why retry is simply calling it again.
  const second = await runGoverned(call);
  assert.equal(second.kind, "ok");
  assert.equal(attempt, 2);
});

// ── 5 · no stale error survives a later success ─────────────────────────────

test("a later success clears the earlier failure at the call site", async () => {
  // The call-site shape every repaired component uses: clear on entry, set
  // only on failure. Modelled here so the ORDER is asserted, not assumed.
  let error: string | null = null;
  let saved = false;

  const attempt = async (call: () => Promise<ActionResult<unknown>>) => {
    error = null; // cleared on entry
    const r = await runGoverned(call);
    if (r.kind !== "ok") {
      error = r.message;
      return;
    }
    saved = true;
  };

  await attempt(async () => {
    throw new Error("503");
  });
  assert.equal(error, UNREACHABLE_MESSAGE);
  assert.equal(saved, false, "failure must not imply success");

  await attempt(async () => ok(null));
  assert.equal(error, null, "the stale error must not outlive the success");
  assert.equal(saved, true);
});

test("a failure never advances success bookkeeping", async () => {
  // The accounting-instruction and customer-note defect in miniature:
  // `setDirty(false)` ran unconditionally after the await, so a save that
  // never landed retired its own "unsaved" warning.
  let dirty = true;

  for (const call of [
    async () => {
      throw new Error("503");
    },
    async () => refused("FROZEN", "This quote is frozen."),
  ] as (() => Promise<ActionResult<unknown>>)[]) {
    const r = await runGoverned(call);
    if (r.kind !== "ok") continue; // the repaired shape: early return
    dirty = false;
  }

  assert.equal(dirty, true, "the draft must still read as unsaved");
});

// ── runGovernedRaw — the non-ActionResult shape (recovery flush) ────────────

test("runGovernedRaw distinguishes a settled false from an unreachable server", async () => {
  const settled = await runGovernedRaw(async () => false);
  assert.equal(settled.kind, "settled");
  assert.equal(settled.kind === "settled" && settled.value, false);

  const unreachable = await runGovernedRaw(async () => {
    throw new Error("dropped");
  });
  assert.equal(unreachable.kind, "unreachable");

  // The distinction is the point: "the flush reported not-durable" and "the
  // flush never answered" are different sentences for the operator, and
  // collapsing them would report a known state where none is known.
  assert.notEqual(settled.kind, unreachable.kind);
});

// ── the enforced region ────────────────────────────────────────────────────

test("every enforced call site routes through the helper", async () => {
  const { readFileSync } = await import("node:fs");
  const files = [
    "src/components/quote/finalize-quote-button.tsx",
    "src/components/quote/accounting-instruction.tsx",
    "src/components/quote/card-customer-presentation.tsx",
    "src/components/quote/customer-notes-drawer.tsx",
    "src/components/quote/use-recovery-draft.ts",
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(
      src.includes("runGoverned"),
      `${f} must route its governed actions through the helper`,
    );
  }

  // Finalize is named explicitly because that is where the soak exposed it.
  const finalize = readFileSync("src/components/quote/finalize-quote-button.tsx", "utf8");
  assert.ok(finalize.includes('r.kind === "unreachable"'));
  assert.ok(finalize.includes("runGovernedRaw"), "the elections flush is guarded too");

  // And every repaired surface renders its failure to assistive tech.
  for (const f of [
    "src/components/quote/accounting-instruction.tsx",
    "src/components/quote/card-customer-presentation.tsx",
    "src/components/quote/customer-notes-drawer.tsx",
    "src/components/quote/card-commercial-recovery.tsx",
  ]) {
    assert.ok(readFileSync(f, "utf8").includes('role="alert"'), `${f} needs role="alert"`);
  }
});

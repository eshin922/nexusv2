import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const DRAFT = "src/components/quote/use-recovery-draft.ts";
const RAIL = "src/components/quote/customer-view-rail.tsx";
const FINALIZE = "src/components/quote/finalize-quote-button.tsx";
const PERSIST = "src/app/actions/commercial-recovery-persist.ts";

/**
 * Evaluated, saving, unsaved — three states, kept distinct.
 *
 * ── WHY THE DISTINCTION IS THE POINT ────────────────────────────────────
 *
 * Evaluate-first makes the surface fast by showing a governed result before it
 * is durable. That is only safe if the surface is honest about which of those
 * two things is true at any moment, and only useful if the fast path cannot let
 * one surface get ahead of another.
 *
 *   clean    what is on screen is what is stored.
 *   saving   the governed result is shown; the write is in flight. No
 *            commercial number moves when it lands — the evaluation and the
 *            persistence are the same election.
 *   unsaved  the write FAILED. The result stays, because it is a true answer to
 *            a real question, but nothing downstream of an election may run
 *            against a state the database does not hold.
 *
 * Collapsing `saving` into `unsaved` would make half a second look like a write
 * that will never land. Collapsing `unsaved` into `clean` would let Finalize
 * freeze an artifact from elections the operator can see and the database
 * cannot.
 */

test("the three states are distinct, and named", async () => {
  const src = codeOnly(await read(DRAFT));
  assert.match(src, /status: "clean"/);
  assert.match(src, /status: "saving"/);
  assert.match(src, /status: "unsaved"; message: string/);
});

test("state 1 · the result shows BEFORE anything is written", async () => {
  const src = codeOnly(await read(DRAFT));
  const propose = src.slice(src.indexOf("const propose ="), src.indexOf("const flush ="));
  const evaluatedAt = propose.indexOf("onAuthoritative(res.data)");
  const savedAt = propose.indexOf("setTimeout");
  assert.ok(evaluatedAt > 0 && savedAt > 0);
  assert.ok(
    evaluatedAt < savedAt,
    "the projection must reach the surface before the save is even scheduled",
  );
  assert.match(propose, /setState\(\{ status: "saving" \}\)/);
});

test("state 2 · a successful save clears the flag and moves no money", async () => {
  // The write persists the SAME election that was evaluated, so nothing
  // commercial can change when it lands. The only visible transition is the
  // pending flag clearing.
  const src = codeOnly(await read(DRAFT));
  const save = src.slice(src.indexOf("const save ="), src.indexOf("const propose ="));
  assert.match(save, /setState\(\{ status: "clean" \}\)/);
  assert.doesNotMatch(save, /onAuthoritative/, "a save must not re-render commercial state");
});

test("state 3 · a failed save keeps the result and says it is not stored", async () => {
  const src = codeOnly(await read(DRAFT));
  const save = src.slice(src.indexOf("const save ="), src.indexOf("const propose ="));
  assert.match(save, /setState\(\{ status: "unsaved", message: res\.error\.message \}\)/);
  // The evaluated projection is NOT withdrawn. It answered a real question, and
  // discarding it would punish the operator for an infrastructure failure.
  assert.doesNotMatch(save, /setAuthoritative\(null\)/);
});

test("a read-back mismatch is unsaved, not clean", async () => {
  // The write returned and the database does not hold what was asked for.
  // Reporting clean there would be the surface trusting its own request over
  // the read-back that exists to check it.
  const src = codeOnly(await read(DRAFT));
  assert.match(src, /if \(!res\.data\.matchesRequested\)/);
  const after = src.slice(src.indexOf("matchesRequested"));
  assert.match(after.slice(0, 400), /status: "unsaved"/);
});

test("a stale save cannot clear a newer pending write", async () => {
  // A fast save landing behind a slow one would otherwise report the quote
  // clean while the later election is still unwritten.
  const src = codeOnly(await read(DRAFT));
  assert.match(src, /const seq = \+\+inFlight\.current/);
  assert.match(src, /if \(seq !== inFlight\.current\) return false/);
});

test("the gates flush a FACT, not a delay", async () => {
  // "Wait for the debounce to settle" waits on a clock, and a write that failed
  // while the clock ran still elapses. The gate needs to know the set is
  // stored, which only a read-back can tell it.
  const draft = codeOnly(await read(DRAFT));
  const flush = draft.slice(draft.indexOf("const flush ="));
  assert.match(flush.slice(0, 500), /clearTimeout\(timer\.current\)/);
  assert.match(flush.slice(0, 500), /return save\(set\)/);

  const persist = codeOnly(await read(PERSIST));
  assert.match(persist, /matchesRequested: norm\(after\) === norm\(requested\)/);
  // The confirmation is a read of the database, not a restatement of the input.
  const readBack = persist.slice(persist.indexOf("const after = await db"));
  assert.match(readBack.slice(0, 400), /\.from\(quoteChargeRecovery\)/);
});

test("Finalize flushes first and refuses if the set is not durable", async () => {
  const src = codeOnly(await read(FINALIZE));
  const click = src.slice(src.indexOf("startTransition(async () => {"));
  const flushAt = click.indexOf("flushElections()");
  const sendAt = click.indexOf("await sendQuote(fd)");
  assert.ok(flushAt > 0 && sendAt > 0);
  assert.ok(flushAt < sendAt, "the flush must precede the send");
  assert.match(click, /if \(!durable\)/);
  assert.match(click, /Nothing was sent/);
});

test("the surface refuses while an election is unsaved", async () => {
  const rail = codeOnly(await read(RAIL));
  assert.match(rail, /draftState\.status === "unsaved" \|\| hasUnbillable \|\| blocked/);
  assert.match(rail, /"Elections not saved"/);
  // And says which of the two states it is in, rather than one vague message.
  assert.match(rail, /Saving your recovery elections/);
});

test("an unchanged charge is not rewritten, so a flush of a clean set is free", async () => {
  // Both gates flush unconditionally, so a no-op flush must cost nothing —
  // otherwise every Finalize would write audit rows for elections nobody
  // changed.
  const src = codeOnly(await read(PERSIST));
  assert.match(src, /if \(priorByKey\.get\(chargeKey\) === mode\) continue/);
});

test("a charge dropped from the proposal is cleared, not left behind", async () => {
  // The set is the unit of truth. A charge reverted to inherited treatment
  // leaves the proposal, and leaving its row behind would persist an election
  // the operator had abandoned.
  const src = codeOnly(await read(PERSIST));
  assert.match(src, /const orphans = prior\.filter/);
  assert.match(src, /action: "charge_recovery_cleared"/);
});

// ═══════════════════════════════════════════════════════════════════════
// POLICY GOVERNS THE CHANGE, NOT THE STORED STATE
// ═══════════════════════════════════════════════════════════════════════
//
// Found on production the first time evaluate-first met a real quote. 4781e4bb
// carries a grandfathered `rd_formulation: separate` that #416 now refuses. The
// proposal is a SET, so clicking TOOLING re-submitted that stored election too,
// and the whole proposal was refused — with a reason naming a charge the
// operator had not touched. Every click on that quote was refused, including
// the one that would have fixed it.
//
// A stored election is a FACT, not an act being performed now. Existing invalid
// states are not ignored: they are flagged on the pre-flight and refused by the
// send gate, which is where a state belongs.

test("only elections that CHANGE are tested against policy", async () => {
  const evaluate = codeOnly(await read("src/app/actions/commercial-recovery-evaluate.ts"));
  assert.match(evaluate, /if \(ctx\.stored\.get\(e\.chargeKey\) === e\.mode\) continue;/);

  const persist = codeOnly(await read(PERSIST));
  // Same skip, so a save cannot refuse what an evaluation allowed.
  assert.match(persist, /if \(priorByKey\.get\(chargeKey\) === mode\) continue;/);
  const loop = persist.slice(persist.indexOf("for (const { chargeKey, mode } of requested)"));
  assert.match(loop.slice(0, 400), /assertElectionAllowed\(chargeKey, mode, ctx\)/);
});

test("both paths diff against the SAME stored set", async () => {
  // Two loaders would be two answers to "did this change", and the first
  // divergence would evaluate an election cleanly and refuse it at save time.
  const ctx = codeOnly(await read("src/lib/commercial-recovery/election-context.ts"));
  assert.match(ctx, /stored: Map<string, string>/);
  assert.match(ctx, /\.from\(quoteChargeRecovery\)/);
});

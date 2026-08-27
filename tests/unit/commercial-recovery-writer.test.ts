import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
// The writer moved when the election became evaluate-first: `setChargeRecovery`
// persisted one charge and then re-resolved, making the operator wait on a
// database round trip to see their own click. `persistChargeRecoverySet` stores
// an exact set BEHIND an evaluation that already happened.
//
// Every invariant below is unchanged — draft-lock, scoped clearing, the policy
// refusal, transition-named audit. They are properties of writing an election,
// not of that particular function, which is why they are re-pointed rather than
// retired.
const ACTION = "src/app/actions/commercial-recovery-persist.ts";
const FREEZE_LIST = "docs/pattern-52-freeze-list.md";

// ═══════════════════════════════════════════════════════════════════════
// PATTERN 52 — the guard, asserted rather than conventional.
//
// The freeze list is a convention, and a convention does not fail when a
// writer skips it. These are what fail.
// ═══════════════════════════════════════════════════════════════════════

test("the election writer is draft-locked and finds the §0.5 grep", async () => {
  const src = codeOnly(await read(ACTION));
  // The governing guard: an election is a quote-authoring decision, so a sent
  // revision must not have its economics moved underneath it.
  assert.match(src, /await quoteByIdDraft\(quoteId\)/);
  // And the named Pattern 52 symbol, so the protocol's grep finds this file.
  assert.match(src, /assertNotFrozen\(quote\)/);
});

test("the freeze list names this table and its writer", async () => {
  const doc = await read(FREEZE_LIST);
  assert.match(doc, /quote_charge_recovery/);
  assert.match(doc, /persistChargeRecoverySet/);
  // A freeze-list entry that does not say which guard holds it is a note, not
  // an enforcement record.
  assert.match(doc, /quoteByIdDraft/);
});

// ═══════════════════════════════════════════════════════════════════════
// WHAT THE WRITER MAY NOT TOUCH.
//
// An election overrides PROJECTION only. The moment it writes the underlying
// value, clearing it stops restoring the legacy behaviour and the preserved
// mixed-allocation quotes become unrecoverable.
// ═══════════════════════════════════════════════════════════════════════

test("the writer never writes allocate_service_fees_to_cost", async () => {
  const src = codeOnly(await read(ACTION));
  // It READS the value (to refuse an incoherent absorb) and must never SET it.
  assert.doesNotMatch(
    src,
    /\.update\(\s*assemblyProductionInputs/,
    "the election writer mutates the legacy allocation value",
  );
  assert.doesNotMatch(
    src,
    /allocateServiceFeesToCost:\s*(true|false)/,
    "the election writer assigns the legacy allocation value",
  );
  assert.doesNotMatch(
    src,
    /\.insert\((?!\s*quoteChargeRecovery|\s*auditLog)/,
    "the election writer inserts into a table other than its own",
  );
});

test("clearing is scoped to the charges being cleared, not the whole quote", async () => {
  // A quote-wide delete would clear every other charge's election as a side
  // effect of clearing one. The set-writer removes exactly the stored rows the
  // proposal no longer names.
  const src = codeOnly(await read(ACTION));
  // `tx.delete` since the set became atomic — the whole write, including this
  // clear, rides one transaction so a group action cannot half-apply.
  const del = src.slice(src.indexOf("tx.delete("));
  assert.ok(del.length > 0, "no delete path — clearing an election is a real operation");
  // Scoped by INSTANCE since OD-032 recovery grain — the primary key, and a
  // strictly finer scope than the charge key it replaced.
  assert.match(
    del.slice(0, 600),
    /inArray\(\s*\n?\s*quoteChargeRecovery\.chargeInstanceId/,
    "the clear path is not scoped to the charges being cleared",
  );
  // And NOT by type, which would take a same-type sibling with it — the
  // collapse this grain exists to remove, reappearing at the delete.
  assert.doesNotMatch(
    del.slice(0, 600),
    /inArray\(\s*\n?\s*quoteChargeRecovery\.chargeKey/,
    "clearing by charge key would clear a sibling that was not named",
  );
  assert.match(del.slice(0, 400), /eq\(quoteChargeRecovery\.quoteId, quoteId\)/);
});

test("both election paths ask the SAME policy, from one module", async () => {
  // The refusal used to live inside the writer. With evaluate-first there are
  // two paths — the evaluator the operator's click reaches, and the writer the
  // save reaches — and two copies of the policy would be two authorities. The
  // first divergence would evaluate an election cleanly and then refuse it at
  // save time, or worse, the reverse.
  //
  // It cannot be shared by exporting from either action file: a `"use server"`
  // module may only export async server actions, so exporting a loader would
  // publish it as an endpoint.
  const writer = codeOnly(await read(ACTION));
  const evaluator = codeOnly(await read("src/app/actions/commercial-recovery-evaluate.ts"));
  for (const src of [writer, evaluator]) {
    assert.match(src, /assertElectionAllowed\(/);
    assert.match(src, /loadElectionContext\(quoteId\)/);
    assert.doesNotMatch(src, /refusalFor\(/, "policy must not be restated in an action");
  }
});

test("a mode refused for ANY owner state is refused for the quote", async () => {
  // Offering a mode one owner cannot carry would be offering a mis-price, so
  // the refusal is evaluated across every distinct allocation state and the
  // Direct Service contribution.
  const policy = codeOnly(await read("src/lib/commercial-recovery/election-context.ts"));
  assert.match(policy, /for \(const perAssemblyAllocate of ctx\.allocationStates\)/);
  assert.match(policy, /hasDirectServiceContribution: ctx\.directServiceKeys\.has\(chargeKey\)/);
  // An empty quote still has a state to test against; an empty list would skip
  // the loop and accept everything.
  assert.match(policy, /allocationStates\.length \? allocationStates : \[false\]/);
  // A $0 column is not a contribution.
  assert.match(policy, /Math\.abs\(Number\(raw\)\) > 0/);
});

test("the audit action names the transition, not the mechanism", async () => {
  const src = codeOnly(await read(ACTION));
  assert.match(src, /"charge_recovery_elected"/);
  assert.match(src, /"charge_recovery_cleared"/);
  // Storage detail in the diff, not in the name — the name has to stay true
  // if the storage moves.
  assert.doesNotMatch(src, /action:.*quote_charge_recovery_row/);
  // from -> to on every row, so the timeline reads as transitions rather than
  // as end states. The set-writer names the prior explicitly because it holds
  // several charges at once and cannot rely on one `from` in scope.
  // `before` is prior state read at the grain the charge is elected at —
  // by instance for a component charge, by type for a legacy column.
  assert.match(src, /mode: \{ from: before, to: mode \}/);
  assert.match(src, /const priorOf = /);
  assert.match(src, /mode: \{ from: o\.mode, to: null \}/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE SNAPSHOT MIRROR.
//
// The live table stays editable on the next draft revision. Without the
// mirror, a sent revision would inherit whatever the LATEST revision elected,
// and the frozen document would drift from the elections it was built under
// with nothing reporting it.
// ═══════════════════════════════════════════════════════════════════════

test("the send transaction mirrors elections into the snapshot", async () => {
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  // The INSERT, not the import — `indexOf` on the bare name finds the import
  // block, and a test that passes on an import is asserting nothing.
  const at = src.indexOf("tx.insert(quoteSnapshotChargeRecovery)");
  assert.ok(
    at > 0,
    "elections are not mirrored inside the send transaction (a `tx`-less " +
      "write is a snapshot that can exist without its elections)",
  );

  // Keyed to THIS snapshot and read from THIS quote.
  assert.match(src.slice(at - 600, at + 400), /eq\(quoteChargeRecovery\.quoteId, quoteId\)/);
  assert.match(src.slice(at, at + 400), /snapshotId: snapshot\.id/);
});

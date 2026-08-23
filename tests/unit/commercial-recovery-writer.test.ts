import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const ACTION = "src/app/actions/commercial-recovery.ts";
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
  assert.match(doc, /setChargeRecovery/);
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

test("clearing is scoped to one charge, not the whole quote", async () => {
  const src = codeOnly(await read(ACTION));
  // A quote-wide delete would clear every other charge's election as a side
  // effect of clearing one — silent, and invisible until a total moved.
  const del = src.slice(src.indexOf(".delete(quoteChargeRecovery)"));
  assert.ok(del.length > 0, "no delete path — clearing an election is a real operation");
  assert.match(
    del.slice(0, 400),
    /eq\(quoteChargeRecovery\.chargeKey, chargeKey\)/,
    "the clear path is not scoped to the charge being cleared",
  );
});

test("refusal at the action boundary asks the same function resolution asks", async () => {
  const src = codeOnly(await read(ACTION));
  // Not a re-implementation, and not a trust of the surface: the surface
  // refuses too, but the surface is not the boundary.
  assert.match(src, /refusalFor\(chargeKey, mode, \{/);
  assert.doesNotMatch(
    src,
    /available\.includes\(/,
    "the action re-derives availability instead of asking the policy layer",
  );
});

test("a mode refused for ANY assembly is refused for the quote", async () => {
  const src = codeOnly(await read(ACTION));
  // The election is stored per QUOTE; the state it can conflict with is per
  // ASSEMBLY, and three real quotes carry both values at once. Accepting a
  // mode that is incoherent for one assembly would mis-price that assembly
  // while the election looked settled.
  assert.match(src, /for \(const allocate of await allocationStatesInQuote\(quoteId\)\)/);
  // No production rows at all must judge against the projection's `?? true`
  // default rather than reading as unconstrained.
  assert.match(src, /seen\.size === 0 \? \[true\]/);
});

test("the audit action names the transition, not the mechanism", async () => {
  const src = codeOnly(await read(ACTION));
  assert.match(src, /"charge_recovery_elected"/);
  assert.match(src, /"charge_recovery_cleared"/);
  // Storage detail in the diff, not in the name — the name has to stay true
  // if the storage moves.
  assert.doesNotMatch(src, /action:.*quote_charge_recovery_row/);
  assert.match(src, /mode: \{ from, to: mode \}/);
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

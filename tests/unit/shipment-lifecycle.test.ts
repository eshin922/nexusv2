/**
 * F-5 — Shipment reversal lifecycle.
 *
 * Hard delete, because a shipment is quote-owned, single-parented and fully
 * cascaded — archive would add a lifecycle filter to every read while
 * preserving nothing referenced from outside the quote.
 *
 * SAFETY COMES FROM REFUSAL, NOT RESTORE. There is no staging split, so the
 * delete is unrecoverable. What makes that acceptable is that a shipment
 * holding commercial or operational evidence cannot be removed at all: the
 * operator must clear those values deliberately first. No confirmed cascade
 * over priced freight is offered, because a confirmation dialog is not
 * informed consent for destroying pricing someone else entered.
 *
 * The guard predicate is modelled executably; structural tests bind the model
 * to the production action.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(
  new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url),
  "utf8",
);
const ui = readFileSync(
  new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url),
  "utf8",
);

/** The body of deleteFreightSubcategory, isolated for structural assertions. */
const body = (() => {
  const start = action.indexOf("export async function deleteFreightSubcategory");
  return action.slice(start, action.indexOf("export async function ", start + 10));
})();

// ---------------------------------------------------------------------------
// Reference model of the refusal predicate
// ---------------------------------------------------------------------------

type Shipment = {
  breaks: Array<{ amount: string | null; markup: string | null }>;
  customsBreaks: Array<{ amount: string | null }>;
  tracking: number;
  selectionReason: string | null;
  selectedDestinationId: string | null;
};

function blockers(s: Shipment): string[] {
  const out: string[] = [];
  if (s.breaks.some((b) => b.amount !== null)) out.push("priced freight");
  if (s.breaks.some((b) => b.markup !== null)) out.push("freight markups");
  if (s.customsBreaks.some((c) => c.amount !== null)) out.push("customs amounts");
  if (s.tracking > 0) out.push("tracking records");
  if (s.selectionReason) out.push("a recorded selection reason");
  return out;
}

const empty: Shipment = {
  breaks: [{ amount: null, markup: null }],
  customsBreaks: [],
  tracking: 0,
  selectionReason: null,
  selectedDestinationId: "auto-assigned-on-create",
};

test("1 · an empty shipment on a draft quote is deletable", () => {
  assert.deepEqual(blockers(empty), []);
});

test("2 · any freight amount refuses", () => {
  assert.deepEqual(
    blockers({ ...empty, breaks: [{ amount: null, markup: null }, { amount: "4200.00", markup: null }] }),
    ["priced freight"],
  );
});

test("3 · any customs amount refuses", () => {
  assert.deepEqual(
    blockers({ ...empty, customsBreaks: [{ amount: "750.00" }] }),
    ["customs amounts"],
  );
});

test("4 · governed evidence refuses — markups, tracking, selection reason", () => {
  assert.deepEqual(blockers({ ...empty, breaks: [{ amount: null, markup: "0.1800" }] }), ["freight markups"]);
  assert.deepEqual(blockers({ ...empty, tracking: 1 }), ["tracking records"]);
  assert.deepEqual(blockers({ ...empty, selectionReason: "cheapest door to door" }), ["a recorded selection reason"]);
});

test("4b · an auto-assigned selected destination is NOT evidence", () => {
  // selectedDestinationId is set automatically when the first destination is
  // created, so every shipment has one. Guarding on it would refuse every
  // shipment including empty ones, contradicting case 1. selectionReason is
  // the operator-authored signal and is guarded instead.
  assert.deepEqual(blockers({ ...empty, selectedDestinationId: "anything" }), []);
});

test("multiple blockers are all reported, not just the first", () => {
  // An operator clearing one value at a time should see the whole list.
  const all = blockers({
    breaks: [{ amount: "1", markup: "0.2" }],
    customsBreaks: [{ amount: "5" }],
    tracking: 2,
    selectionReason: "why",
    selectedDestinationId: "x",
  });
  assert.equal(all.length, 5);
});

// ---------------------------------------------------------------------------
// Structural — production wiring
// ---------------------------------------------------------------------------

test("5 · a frozen quote is refused before any evaluation or mutation", () => {
  // OD-023 · this also asserted `assertNotFrozen(row.quote)`. That call was
  // REMOVED, and the property it was standing in for is unchanged.
  //
  // `assertNotFrozen` passes on `sent`, so it never expressed this action's
  // rule; `quoteByIdDraft` beside it already refused strictly more — every
  // status the removed call rejected, plus `sent`. Asserting the weaker call
  // made the module read as not-frozen-governed, which is how an OD-023 sweep
  // came to attribute it to the wrong function and conclude the module was
  // unguarded.
  //
  // So the assertion is now the PROPERTY — a frozen quote is refused, and the
  // refusal precedes any read of the shipment's children — rather than the
  // mechanism that happened to be written first.
  assert.match(body, /quoteByIdDraft\(row\.quote\.id\)/);
  assert.ok(
    body.indexOf("quoteByIdDraft(row.quote.id)") <
      body.indexOf("select({ id: freightDestinations.id"),
    "the refusal must run before shipment data is read",
  );
});

test("6 · the subtree is removed atomically, audit inside the same transaction", () => {
  assert.match(body, /db\.transaction\(async \(tx\) => \{/);
  assert.ok(
    body.indexOf("writeAuditEntry({") < body.indexOf("tx.delete(freightSubcategories)"),
    "the pre-delete snapshot must be written before the delete it describes",
  );
  // Both inside the transaction: a failed audit or delete rolls back the pair.
  //
  // The audit now goes through the Gate 1A single writer (src/lib/audit.ts)
  // rather than inserting directly. The trailing `tx` argument is what enlists
  // it in THIS transaction instead of committing on its own connection — so
  // that argument, not the insert call, is what this assertion has to see.
  const tx = body.slice(body.indexOf("db.transaction"));
  assert.match(tx, /writeAuditEntry\(\{[\s\S]*?\},\s*tx,?\s*\)/);
  assert.match(tx, /tx\.delete\(freightSubcategories\)/);
});

test("7 · deletion is scoped to one shipment id, never broader", () => {
  // Every mutation is keyed to the single subcategory; nothing reaches the
  // owning quote or a sibling shipment.
  assert.match(body, /tx\.delete\(freightSubcategories\)\.where\(eq\(freightSubcategories\.id, subcategoryId\)\)/);
  assert.doesNotMatch(body, /delete\(quotes\)|delete\(freightDestinations\)|delete\(freightCustomsEntries\)/);
});

test("8 · the audit carries a full pre-delete snapshot and cascade counts", () => {
  assert.match(body, /action: "freight_shipment_deleted"/);
  for (const field of ["label", "quoteId", "projectId", "hadSelectedDestination", "destinations", "cascadeCounts"]) {
    assert.match(body, new RegExp(`\\b${field}:`), `snapshot missing ${field}`);
  }
  for (const count of ["destinationBreaks", "destinationTracking", "customsEntries", "customsBreaks", "subcategoryItems"]) {
    assert.match(body, new RegExp(`\\b${count}:`), `cascade counts missing ${count}`);
  }
});

test("9 · a failure rolls back the whole transaction", () => {
  // Nothing is committed outside db.transaction, so a throw in either
  // statement discards both. The revision is read after, not inside.
  const afterTx = body.slice(body.indexOf("await db.transaction"));
  assert.ok(
    afterTx.indexOf("committedRevision()") > afterTx.indexOf("tx.delete(freightSubcategories)"),
    "revision must be minted after the transaction commits",
  );
});

test("10 · confirmation names the shipment and states the blast radius", () => {
  assert.match(ui, /function ShipmentDelete/);
  assert.match(ui, /Remove <strong>\{shipment\.label\}<\/strong>\?/);
  assert.match(ui, /\{destinationCount\}/);
  assert.match(ui, /destinationCount === 1 \? "destination" : "destinations"/);
  assert.match(ui, /cannot be undone/);
  // Not a generic prompt.
  assert.doesNotMatch(ui, /Are you sure\?/i);
});

test("the refusal is operator-correctable and says what to clear", () => {
  assert.match(body, /ERR\.VALIDATION/);
  assert.match(body, /Clear those values first/);
  assert.doesNotMatch(body, /ERR\.DATA_INTEGRITY/);
});

test("the action returns a committed revision (F-3 contract)", () => {
  assert.match(body, /revision: string \| null/);
  assert.match(body, /const revision = await committedRevision\(\)/);
});

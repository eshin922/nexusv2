import { test } from "node:test";
import assert from "node:assert/strict";
import { ERR, runAction } from "../../src/lib/action-result.ts";
import {
  UnresolvedQuoteCostsError,
  type UnresolvedQuoteCost,
} from "../../src/lib/quote-cost-completeness-contract.ts";

/**
 * The send-time cost guard is authoritative and unchanged. What is repaired is
 * how its refusal LEAVES the action: `UnresolvedQuoteCostsError` extends plain
 * Error, so `runAction` — which translates only ActionGuardError — rethrew it,
 * and Next rendered a server-side application error. The operator got a 500
 * where they should have got a work list.
 */

const ROW: UnresolvedQuoteCost = {
  source: "packaging",
  quoteLeafId: "11111111-1111-1111-1111-111111111111",
  assemblyLeafId: null,
  tierId: "22222222-2222-2222-2222-222222222222",
  tierLabel: "T2",
  lineGroupId: "33333333-3333-3333-3333-333333333333",
  leafSku: "SPJ-001",
  leafName: "Juice Cleanse Carton",
  description: "Freight / T2: enter Freight and Freight Markup.",
};

test("an unresolved-cost refusal returns a structured result, not a thrown error", async () => {
  const result = await runAction(async () => {
    throw new UnresolvedQuoteCostsError([ROW]);
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, ERR.UNRESOLVED_COSTS);
});

test("the refusal carries the structured payload, so nothing parses the message", async () => {
  const result = await runAction(async () => {
    throw new UnresolvedQuoteCostsError([ROW]);
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const details = result.error.details as UnresolvedQuoteCost[];
  assert.ok(Array.isArray(details));
  assert.equal(details.length, 1);
  // The fields the operator list is built from.
  assert.equal(details[0].leafName, "Juice Cleanse Carton");
  assert.equal(details[0].tierLabel, "T2");
  assert.equal(details[0].description, ROW.description);
});

test("the operator-facing message is short and free of internal identifiers", async () => {
  const result = await runAction(async () => {
    throw new UnresolvedQuoteCostsError([ROW]);
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message, "Resolve costs before sending.");
  // The raw exception message concatenates every attachment/line/tier UUID.
  // Surfacing it would put internal identity in front of the operator.
  for (const id of [ROW.quoteLeafId!, ROW.tierId, ROW.lineGroupId]) {
    assert.ok(
      !result.error.message.includes(id),
      `operator message leaked ${id}`,
    );
  }
});

test("runAction still rethrows genuinely unexpected errors", async () => {
  // The repair must not turn runAction into a catch-all. A real bug has to stay
  // loud — converting it to a tidy result is how a fault becomes invisible.
  await assert.rejects(
    () => runAction(async () => {
      throw new Error("a genuine bug");
    }),
    /a genuine bug/,
  );
});

test("a resolved quote is unaffected — the refusal only fires when it should", async () => {
  const result = await runAction(async () => "sent");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data, "sent");
});

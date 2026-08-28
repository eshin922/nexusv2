import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";
import { summariseUnbillablePlacements } from "../../src/lib/commercial-recovery/unbillable-placements.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The operator must see it before they act.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The send gate refused correctly and the surface stayed green. On 4781e4bb —
 * the one quote in the estate carrying an unbillable Direct Service recovery
 * state — the pre-flight checklist showed three ticks and an enabled Finalize.
 * Clicking reached an unrelated Costs refusal first, so the operator was told
 * about freight markup and learned nothing about the $1,727.60 of recovery the
 * document does not bill.
 *
 * A boundary that refuses is not the same as a surface that is truthful.
 */

test("the surface reads the SAME detection the gate refuses on", async () => {
  // Not a second implementation. Two detections would be free to disagree about
  // whether the quote may go out, and the operator would be reading one while
  // the boundary enforced the other.
  const resolver = codeOnly(await read("src/lib/customer-view-resolver.ts"));
  assert.match(resolver, /findUnbillablePlacements\(\{/);
  assert.match(resolver, /unbillableRecovery,/);

  // The surface consumes the result; it does not re-derive it.
  //
  // `ownerKind` is the discriminator the detection turns on, so its absence
  // here is what proves the rail is not deciding for itself. Not asserted over
  // `separate_line`: the rail carries a placement-to-label map that predates
  // this and is display, not detection — a check that flagged it would be
  // forbidding the wrong thing and would fail on correct code.
  const rail = codeOnly(await read("src/components/quote/customer-view-rail.tsx"));
  assert.doesNotMatch(rail, /ownerKind/, "the rail must not re-implement detection");
  assert.doesNotMatch(
    rail,
    /findUnbillablePlacements/,
    "and must not run it a second time — it receives the resolved result",
  );
  assert.match(rail, /summariseUnbillablePlacements\(unbillableRecovery\)/);
});

test("the resolver declares it before the return that reads it", async () => {
  // This file has twice shipped a read above its declaration, and the second one
  // took down every quote page. tsc cannot see it (the read sits in a callback)
  // and the unit suite cannot (it never loads this file), so it is asserted here.
  const src = codeOnly(await read("src/lib/customer-view-resolver.ts"));
  const declaredAt = src.indexOf("const unbillableRecovery =");
  const returnedAt = src.indexOf("    unbillableRecovery,");
  assert.ok(declaredAt > 0, "it must be declared");
  assert.ok(returnedAt > 0, "and returned");
  assert.ok(declaredAt < returnedAt, "declaration must precede the read");
});

test("Finalize is disabled while any unbillable placement exists", async () => {
  const rail = codeOnly(await read("src/components/quote/customer-view-rail.tsx"));
  // `hasUnpricedRecovery` joined the set when an elected-but-unpriced charge
  // was found reaching a customer document as $0.00. The assertion keeps the
  // whole expression pinned rather than just its own term, so a future
  // condition cannot quietly replace this one.
  assert.match(
    rail,
    /disabled=\{\s*!isDraft \|\|\s*draftState\.status === "unsaved" \|\|\s*hasUnbillable \|\|\s*hasUnpricedRecovery \|\|\s*blocked\s*\}/,
  );
  assert.match(rail, /Resolve recovery placement/);
});

test("the summary names the charge, the owner, every tier and its amount", () => {
  const lines = summariseUnbillablePlacements([
    {
      chargeKey: "rd_formulation",
      label: "R&D",
      ownerLabel: "SVC-FORMULATION",
      tierId: "t1",
      tierLabel: "Tier 1",
      unbilledRevenue: 1727.6,
    },
    {
      chargeKey: "rd_formulation",
      label: "R&D",
      ownerLabel: "SVC-FORMULATION",
      tierId: "t2",
      tierLabel: "Tier 2",
      unbilledRevenue: 3283,
    },
  ]);
  // ONE line for one charge on one owner. Four near-identical sentences about a
  // single charge read as four separate problems.
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^Unresolved - /);
  assert.match(lines[0]!, /R&D/);
  assert.match(lines[0]!, /SVC-FORMULATION/);
  assert.match(lines[0]!, /Tier 1: \$1,727\.60/);
  assert.match(lines[0]!, /Tier 2: \$3,283\.00/);
  assert.match(lines[0]!, /In unit price/);
});

test("the summary says not governed rather than a dollar zero", () => {
  // BV-013 again, at the surface this time: an operator shown $0.00 would read
  // the unbilled revenue as nothing, which is the opposite of what is known.
  const lines = summariseUnbillablePlacements([
    {
      chargeKey: "rd_formulation",
      label: "R&D",
      ownerLabel: "SVC-FORMULATION",
      tierId: "t1",
      tierLabel: "Tier 1",
      unbilledRevenue: null,
    },
  ]);
  assert.match(lines[0]!, /Tier 1: not governed/);
  assert.doesNotMatch(lines[0]!, /\$0\.00/);
});

test("distinct charges and distinct owners stay distinct", () => {
  // Grouping is by (charge, owner). Collapsing two owners into one line would
  // tell an operator to fix one thing when there are two.
  const base = { tierId: "t1", tierLabel: "Tier 1", unbilledRevenue: 100 };
  const lines = summariseUnbillablePlacements([
    { ...base, chargeKey: "rd_formulation", label: "R&D", ownerLabel: "SVC-A" },
    { ...base, chargeKey: "rd_formulation", label: "R&D", ownerLabel: "SVC-B" },
    { ...base, chargeKey: "other_service", label: "Other service", ownerLabel: "SVC-A" },
  ]);
  assert.equal(lines.length, 3);
});

test("the send gate remains the boundary", async () => {
  // The surface predicting a refusal does not replace the refusal. An election
  // arriving by any other route, or a surface that failed to render, must still
  // meet the gate.
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  assert.match(src, /requireNoUnbillableRecoveryToSend\(\{ quoteId \}\)/);
});

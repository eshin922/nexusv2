/**
 * Track B §4 — the frozen grouping plan as a comparison target.
 *
 * The plan exists for one reason: an administrator grouping the WRONG leaves
 * produces a CORRECT TOTAL. Nothing downstream can catch that, because the
 * total is the thing everyone checks and it reconciles perfectly. The plan is
 * the only statement of what Nexus intended, so these tests are about whether
 * it can be told apart from a plausible wrong answer — not whether it exists.
 *
 * The adversarial cases are therefore built to be maximally confusable:
 * assemblies sharing leaves, assemblies differing only in quantity, and a
 * mis-grouping engineered to reconcile to the cent.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEXUS_PLAN_KEY,
  attachGroupingPlan,
  buildGroupingPlan,
  readGroupingPlan,
  stripGroupingPlan,
  type PlanLineInput,
} from "../../src/lib/netsuite/grouping-plan.ts";

const CUSTOMER = "4321";

function line(over: Partial<PlanLineInput> & Pick<PlanLineInput, "assemblyId" | "sku">): PlanLineInput {
  return {
    assemblySku: `ASY-${over.assemblyId}`,
    assemblyName: `Assembly ${over.assemblyId}`,
    netsuiteItemId: `ns-${over.sku}`,
    quantity: 1000,
    rate: 2,
    ...over,
  } as PlanLineInput;
}

// ── 1 · overlapping / similar assemblies stay distinguishable ──────────────

test("two assemblies sharing a leaf produce different group identities", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE" }),
      line({ assemblyId: "A", sku: "PUMP" }),
      line({ assemblyId: "B", sku: "BOTTLE" }), // shared leaf
      line({ assemblyId: "B", sku: "CAP" }),
    ],
  });

  assert.equal(plan.groups.length, 2);
  const [a, b] = plan.groups;
  assert.notEqual(a.compositionHash, b.compositionHash);
  assert.notEqual(a.externalId, b.externalId);
  // And each names its own assembly, so the shared BOTTLE cannot be
  // attributed to the wrong group by inspection.
  assert.deepEqual(a.members.map((m) => m.sku).sort(), ["BOTTLE", "PUMP"]);
  assert.deepEqual(b.members.map((m) => m.sku).sort(), ["BOTTLE", "CAP"]);
});

test("assemblies differing ONLY by member quantity are distinguishable", () => {
  // "1 bottle + 1 pump" vs "2 bottles + 1 pump" — identical item sets, and a
  // hash keyed on membership alone would collapse them.
  const one = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE", quantity: 1000 }),
      line({ assemblyId: "A", sku: "PUMP", quantity: 1000 }),
    ],
  });
  const two = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE", quantity: 2000 }),
      line({ assemblyId: "A", sku: "PUMP", quantity: 1000 }),
    ],
  });
  assert.notEqual(one.groups[0].compositionHash, two.groups[0].compositionHash);
});

test("identical composition under two base SKUs yields two groups", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty: 1000,
    lines: [
      line({ assemblyId: "A", assemblySku: "ASY-RETAIL", sku: "BOTTLE" }),
      line({ assemblyId: "B", assemblySku: "ASY-TRADE", sku: "BOTTLE" }),
    ],
  });
  assert.notEqual(plan.groups[0].compositionHash, plan.groups[1].compositionHash);
});

test("member order does not affect identity", () => {
  const forward = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "A", sku: "PUMP" })],
  });
  const reverse = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "PUMP" }), line({ assemblyId: "A", sku: "BOTTLE" })],
  });
  assert.equal(forward.groups[0].compositionHash, reverse.groups[0].compositionHash);
});

// ── 2 · membership survives into the frozen snapshot ───────────────────────

test("membership and attribution survive the freeze round-trip", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "A", sku: "PUMP" })],
  });
  const payload = attachGroupingPlan({ entity: { id: CUSTOMER }, item: { items: [] } }, plan);

  // Through JSON, because jsonb storage is a serialization round-trip.
  const stored = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const recovered = readGroupingPlan(stored);

  assert.ok(recovered);
  assert.deepEqual(
    recovered.groups[0].members.map((m) => m.netsuiteItemId).sort(),
    ["ns-BOTTLE", "ns-PUMP"],
  );
  assert.equal(recovered.groups[0].compositionHash, plan.groups[0].compositionHash);
  assert.equal(recovered.lineAttribution.length, 2);
  assert.ok(recovered.lineAttribution.every((l) => l.assemblyId === "A"));
});

// ── 3 · a wrong grouping with the SAME total fails comparison ──────────────

test("mis-grouping that reconciles to the cent still fails plan comparison", () => {
  // Two assemblies, engineered so that swapping one member between them leaves
  // BOTH totals unchanged: PUMP and CAP are each 1000 × $2 = $2000.
  const truth = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "A", sku: "PUMP" }),
      line({ assemblyId: "B", sku: "JAR" }), line({ assemblyId: "B", sku: "CAP" }),
    ],
  });

  // What the administrator actually built: PUMP and CAP swapped.
  const mistake = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "A", sku: "CAP" }),
      line({ assemblyId: "B", sku: "JAR" }), line({ assemblyId: "B", sku: "PUMP" }),
    ],
  });

  // The totals are IDENTICAL — this is why total-only reconciliation cannot
  // catch it, and why the plan has to exist.
  assert.equal(mistake.groups[0].expectedAmount, truth.groups[0].expectedAmount);
  assert.equal(mistake.groups[1].expectedAmount, truth.groups[1].expectedAmount);
  const sum = (p: typeof truth) => p.groups.reduce((s, g) => s + g.expectedAmount, 0);
  assert.equal(sum(mistake), sum(truth));

  // And the plan catches it anyway, on both identity and membership.
  assert.notEqual(mistake.groups[0].compositionHash, truth.groups[0].compositionHash);
  assert.notEqual(mistake.groups[0].externalId, truth.groups[0].externalId);
  assert.notDeepEqual(
    mistake.groups[0].members.map((m) => m.sku).sort(),
    truth.groups[0].members.map((m) => m.sku).sort(),
  );
});

// ── 4 · applicability shape, both cases ────────────────────────────────────

test("itemized carries attribution but acquires no grouping requirement", () => {
  const plan = buildGroupingPlan({
    detailLevel: "itemized", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "B", sku: "JAR" })],
  });
  assert.equal(plan.applicability, "itemized");
  assert.equal(plan.groupingRequired, false);
  assert.deepEqual(plan.groups, []);
  // Attribution is still present — the itemized walk must prove WHICH lines
  // were preserved ungrouped, which needs to know what they were.
  assert.equal(plan.lineAttribution.length, 2);
});

test("a NULL detail level is itemized, not a grouping requirement", () => {
  // Legacy rows carry NULL. Defaulting the other way would silently impose
  // grouping on quotes whose customers were shown itemized lines.
  const plan = buildGroupingPlan({
    detailLevel: null, customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" })],
  });
  assert.equal(plan.applicability, "itemized");
  assert.equal(plan.groupingRequired, false);
});

test("turnkey_only requires grouping and plans one group per assembly", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE" }), line({ assemblyId: "A", sku: "PUMP" }),
      line({ assemblyId: "B", sku: "JAR" }),
    ],
  });
  assert.equal(plan.applicability, "turnkey_only");
  assert.equal(plan.groupingRequired, true);
  assert.equal(plan.groups.length, 2);
  assert.ok(plan.derivable);
  assert.ok(plan.groups.every((g) => g.externalId?.startsWith("nxs-grp-")));
});

// ── 5 · amount reconciliation is unchanged ─────────────────────────────────

test("group amounts sum to the emitted line total", () => {
  const lines = [
    line({ assemblyId: "A", sku: "BOTTLE", rate: 2.2185, quantity: 50_000 }),
    line({ assemblyId: "A", sku: "PUMP", rate: 0.4191, quantity: 50_000 }),
    line({ assemblyId: "B", sku: "JAR", rate: 2.4193, quantity: 25_000 }),
  ];
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 50_000, lines,
  });

  const emitted = lines.reduce((s, l) => s + l.rate * l.quantity, 0);
  const planned = plan.groups.reduce((s, g) => s + g.expectedAmount, 0);
  assert.ok(Math.abs(emitted - planned) < 0.0001, `${emitted} vs ${planned}`);
});

test("turnkey unit price is a display figure; expectedAmount is the target", () => {
  // A rate that does not divide cleanly by tier qty. Reconciling against
  // turnkeyUnitPrice × qty would drift; the test pins which one is authoritative.
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 30_000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE", rate: 1.0001, quantity: 30_000 })],
  });
  const g = plan.groups[0];
  assert.ok(g.turnkeyUnitPrice !== null);
  assert.ok(Math.abs(g.expectedAmount - 30003) < 0.0001);
});

test("tier quantity of zero yields a null unit price, not a free order", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 0,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" })],
  });
  assert.equal(plan.groups[0].turnkeyUnitPrice, null);
});

// ── constraint 4/5 · the envelope must never reach the provider ────────────

test("the transmitted body is byte-identical to the payload without a plan", () => {
  const raw = { entity: { id: CUSTOMER }, item: { items: [{ item: { id: "1" } }] } };
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" })],
  });

  const frozen = attachGroupingPlan(raw, plan);
  assert.ok(NEXUS_PLAN_KEY in frozen, "the plan must be in the FROZEN payload");

  const transmitted = stripGroupingPlan(frozen);
  assert.ok(!(NEXUS_PLAN_KEY in transmitted));
  assert.equal(JSON.stringify(transmitted), JSON.stringify(raw));
});

test("stripping is safe on a payload that never carried a plan", () => {
  // The durable-replay path calls strip unconditionally; pre-§4 snapshots and
  // itemized payloads must pass through untouched.
  const raw = { entity: { id: CUSTOMER } };
  assert.equal(stripGroupingPlan(raw), raw);
  assert.equal(JSON.stringify(stripGroupingPlan(raw)), JSON.stringify(raw));
});

test("a replayed frozen snapshot still strips before transmission", () => {
  const raw = { entity: { id: CUSTOMER }, item: { items: [] } };
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" })],
  });
  // Simulates `payload = durableAttempt.payloadSnapshot` — a jsonb round-trip.
  const replayed = JSON.parse(JSON.stringify(attachGroupingPlan(raw, plan)));
  assert.equal(JSON.stringify(stripGroupingPlan(replayed)), JSON.stringify(raw));
});

// ── the defect the real-data dry run found ─────────────────────────────────

test("a non-positive member quantity degrades the plan instead of throwing", () => {
  // computeCompositionHash refuses quantity 0, which a zero-qty tier produces.
  // Throwing here would put plan-building in the path of whether a Sales Order
  // pushes at all — a provider-behaviour change §4 is not permitted to make.
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 0,
    lines: [line({ assemblyId: "A", sku: "BOTTLE", quantity: 0 })],
  });

  assert.equal(plan.derivable, false, "the plan must declare itself underivable");
  assert.equal(plan.groups[0].compositionHash, null);
  assert.equal(plan.groups[0].externalId, null);
  assert.match(plan.groups[0].notDerivableReason ?? "", /positive integer/);
  // The group is still RECORDED — visible and unusable beats absent.
  assert.equal(plan.groups[0].members.length, 1);
});

test("one underivable group makes the whole plan underivable", () => {
  // The walk checks a single field before touching NetSuite; a plan that is
  // 90% derivable is still not a comparison target.
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [
      line({ assemblyId: "A", sku: "BOTTLE" }),
      line({ assemblyId: "B", sku: "JAR", quantity: 0 }),
    ],
  });
  assert.equal(plan.derivable, false);
  assert.ok(plan.groups[0].compositionHash, "the healthy group keeps its identity");
  assert.equal(plan.groups[1].compositionHash, null);
});

test("a healthy plan reports itself derivable", () => {
  const plan = buildGroupingPlan({
    detailLevel: "turnkey_only", customerNetsuiteId: CUSTOMER, tierQty: 1000,
    lines: [line({ assemblyId: "A", sku: "BOTTLE" })],
  });
  assert.equal(plan.derivable, true);
});

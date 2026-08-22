import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovalTierState } from "../../src/lib/below-floor-approval-state.ts";
import {
  evaluateProgression,
  type ProgressionTier,
} from "../../src/lib/pricing-progression.ts";

// ═══════════════════════════════════════════════════════════════════════
// PROGRESSION TO THE QUOTE SURFACE
//
// The defect: progression was derived from the classifier's compliance mode
// alone, and the classifier never sees approval. So an approved below-floor
// quote stayed blocked — not because the read was stale, but because there was
// no read. And a quote above floor but below target had no progression
// affordance at all, because `preview_pdf` is filtered out of the action list
// in every mode and the banner suppresses its own href in `suggestion_led`.
//
// Every test below states a rule from the governing behaviour, and each is
// written so it can fail: the ones that describe today's bugs failed before the
// module existed, and the ones that describe preserved behaviour would fail if
// the new predicate over-reached.
// ═══════════════════════════════════════════════════════════════════════

const T = (
  tierId: string,
  blendedStatus: ProgressionTier["blendedStatus"],
): ProgressionTier => ({ tierId, label: `Tier ${tierId}`, blendedStatus });

const approved: ApprovalTierState = {
  kind: "approved",
  requestId: "req-1",
  authorizationId: "auth-1",
  decidedAt: new Date("2026-08-22T00:00:00Z"),
};

// ── above floor ───────────────────────────────────────────────────────────

test("above floor and compliance clear → progresses, no approval needed", () => {
  const v = evaluateProgression({
    tiers: [T("a", "GOOD"), T("b", "GOOD")],
    approvalByTier: {},
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, true);
  assert.deepEqual(v.allowed && v.authorizedTiers, []);
});

test("below TARGET is not a floor breach — it progresses", () => {
  // The rule the old surface broke hardest. `suggestion_led` produced no
  // Continue affordance anywhere, so a soft warning behaved like a hard block.
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_TARGET"), T("b", "GOOD")],
    approvalByTier: {},
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, true);
});

// ── below floor ───────────────────────────────────────────────────────────

test("below floor with no approval → blocked, naming the tier", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR"), T("b", "GOOD")],
    approvalByTier: {},
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, false);
  assert.equal(!v.allowed && v.code, "BELOW_FLOOR_UNAUTHORIZED");
  assert.deepEqual(!v.allowed && v.tiers.map((t) => t.tierId), ["a"]);
});

test("below floor with a valid approval → progresses, and says which tier", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: { a: approved },
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, true);
  // Carried, not silent: an operator continuing below floor should see that
  // they are doing so.
  assert.deepEqual(v.allowed && v.authorizedTiers.map((t) => t.tierId), ["a"]);
});

test("one approved tier does not carry an unapproved sibling", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR"), T("b", "BELOW_FLOOR")],
    approvalByTier: { a: approved },
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, false);
  assert.deepEqual(!v.allowed && v.tiers.map((t) => t.tierId), ["b"]);
});

test("no non-approved approval state unblocks", () => {
  // Wrong tier, wrong version and a moved fingerprint all arrive here as some
  // kind OTHER than `approved` — `projectApprovalTierState` scopes on all
  // three before it will report approval. Asserting every non-approved kind
  // means this holds however the projection routes them.
  const kinds: ApprovalTierState[] = [
    { kind: "none" },
    { kind: "pending", requestId: "r", requestedAt: new Date(), delivered: true },
    { kind: "rejected", requestId: "r", reason: "too thin", decidedAt: new Date() },
    { kind: "superseded", requestId: "r" },
  ];
  for (const k of kinds) {
    const v = evaluateProgression({
      tiers: [T("a", "BELOW_FLOOR")],
      approvalByTier: { a: k },
      unknownCellCount: 0,
    });
    assert.equal(v.allowed, false, `${k.kind} must not unblock`);
    assert.equal(!v.allowed && v.tiers[0].approval, k.kind);
  }
});

test("an approval recorded against a DIFFERENT tier does not unblock this one", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: { b: approved },
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, false);
});

// ── the lift path, proven structurally ────────────────────────────────────

test("a lift that clears the floor progresses WITHOUT reading approval at all", () => {
  // The strong form of the rule. A map that throws on any property access:
  // if the predicate consults approval when nothing is below floor, this test
  // fails with that access rather than passing on a value that happened to be
  // absent.
  const poisoned = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`approval consulted for ${String(prop)} with nothing below floor`);
      },
    },
  ) as Record<string, ApprovalTierState>;

  const v = evaluateProgression({
    tiers: [T("a", "GOOD"), T("b", "BELOW_TARGET")],
    approvalByTier: poisoned,
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, true);
});

test("a stale rejection cannot hold back a quote that is now compliant", () => {
  // The operator lifted above floor after being refused. Nothing about the
  // refusal is relevant any more, and the previous surface had no way to say so.
  const v = evaluateProgression({
    tiers: [T("a", "GOOD")],
    approvalByTier: {
      a: { kind: "rejected", requestId: "r", reason: "no", decidedAt: new Date() },
    },
    unknownCellCount: 0,
  });
  assert.equal(v.allowed, true);
});

// ── unrelated blockers ────────────────────────────────────────────────────

test("data-incomplete is a real blocker", () => {
  // It was computed and discarded before: the classifier set `disabled` on the
  // sendable action, the shell filtered that action out entirely, and the
  // banner never read the flag.
  const v = evaluateProgression({
    tiers: [T("a", "GOOD")],
    approvalByTier: {},
    unknownCellCount: 3,
  });
  assert.equal(v.allowed, false);
  assert.equal(!v.allowed && v.code, "DATA_INCOMPLETE");
});

test("a floor breach outranks incomplete data", () => {
  // Both true. Reporting the raws would send the operator to Costs when what
  // stands between them and sending is a price below the firm's floor.
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: {},
    unknownCellCount: 5,
  });
  assert.equal(!v.allowed && v.code, "BELOW_FLOOR_UNAUTHORIZED");
});

test("an authorized below-floor tier still cannot progress on incomplete data", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: { a: approved },
    unknownCellCount: 2,
  });
  assert.equal(v.allowed, false);
  assert.equal(!v.allowed && v.code, "DATA_INCOMPLETE");
});

test("unpriced tiers are not reported as floor breaches", () => {
  // UNAVAILABLE and COST_WITHOUT_REVENUE are unpriced, not underpriced. Telling
  // an operator to seek an approval would send them after a permission that
  // would not help; the acceptance gate refuses these on their own grounds.
  for (const s of ["UNAVAILABLE", "COST_WITHOUT_REVENUE"] as const) {
    const v = evaluateProgression({
      tiers: [T("a", s)],
      approvalByTier: {},
      unknownCellCount: 1,
    });
    assert.equal(!v.allowed && v.code, "DATA_INCOMPLETE");
  }
});

// ── what it must not claim ────────────────────────────────────────────────

test("progression cannot decide self-approval, and has no way to try", () => {
  // No `actingUserId` parameter. Independence is measured against whoever
  // COMMITS the below-floor outcome, which is unknown while someone is looking
  // at a pricing page — so `allowed: true` means "a valid authorization
  // exists", never "you personally may proceed".
  //
  // Asserted on the argument object rather than on prose: a future parameter
  // would fail this immediately.
  const arg = {
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: { a: approved },
    unknownCellCount: 0,
  };
  assert.deepEqual(Object.keys(arg).sort(), [
    "approvalByTier",
    "tiers",
    "unknownCellCount",
  ]);
  const v = evaluateProgression(arg);
  assert.equal(v.allowed, true);
});

test("the block message states the condition and nothing else", () => {
  const v = evaluateProgression({
    tiers: [T("a", "BELOW_FLOOR")],
    approvalByTier: {},
    unknownCellCount: 0,
  });
  const m = !v.allowed ? v.message : "";
  assert.doesNotMatch(m, /admin/i);
  // The verdict states the CONDITION. What to do about it is the two paths'
  // job, and duplicating it here is the repetition R13 removes.
  assert.doesNotMatch(m, /approver/i);
  assert.doesNotMatch(m, /lift it|request approval/i);
  assert.match(m, /below the firm's margin floor/);
  // INVERTED 2026-08-22. This required the message to say "other than you" —
  // an independence rule the business then removed. The assertion now runs the
  // other way, because copy describing a control the system does not enforce
  // is the defect this file is meant to catch.
  assert.doesNotMatch(m, /other than you/i);
  assert.doesNotMatch(m, /yourself|you raised|you priced/i);
});

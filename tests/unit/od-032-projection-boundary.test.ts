/**
 * OD-032 — the read projection and the commit projection are different questions.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * There was one projection, written for the send transaction, where an
 * unplaced charge must be refused because freezing it records a margin
 * decision nobody made.
 *
 * `resolveCustomerView` called it on EVERY page load. A component charge is
 * authored `unplaced` by design, so from #480 onward any quote carrying one
 * returned 500 on the Quote surface — the page that HOSTS Commercial Recovery,
 * which is where the charge would have been placed. The unresolved state
 * killed the page holding the control that resolves it.
 *
 * Measured on production 2026-08-27, not inferred: two quotes carrying
 * component charges returned 500, a quote carrying none returned 200, and
 * removing the charges flipped both of the first two to 200.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────
 *
 * The lifecycle assertions are the positive half. The half that matters more
 * is the NEGATIVE control: before placement, the commit projection must still
 * refuse. A repair that made the read path work by weakening the freeze would
 * pass every positive assertion here.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  projectFrozenInstructions,
  projectRecoveryInstructionsForRead,
} from "../../src/lib/commercial-recovery/frozen-instruction.ts";
import type { ConstructedRollups } from "../../src/lib/commercial-recovery/construct.ts";

const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// Fixtures — one leaf, one tier, one charge, at each lifecycle state
// ══════════════════════════════════════════════════════════════════════

const LEAF = "leaf-1";
const TIER = "tier-1";

function rollups(charges: unknown[]): ConstructedRollups {
  return {
    // `constructed.charges` — the shape `ownedPlacedCharges` walks. Getting
    // this wrong made every assertion below pass or fail for the wrong reason,
    // which is why the fixture is written against the walker rather than
    // against what the shape looks like it should be.
    skuRollups: [
      { skuId: LEAF, perTier: [{ tierId: TIER, constructed: { charges } }] },
    ],
  } as unknown as ConstructedRollups;
}

/** A component charge at a given lifecycle state. */
function componentCharge(opts: {
  placement: "unplaced" | "separate_line" | "unit_price";
  cost: number;
  recoverableSell: number | null;
}) {
  return {
    chargeKey: "print_plates",
    chargeInstanceId: "inst-1",
    ownerKind: "component",
    ownerRef: LEAF,
    placement: opts.placement,
    source: opts.placement === "unplaced" ? "unplaced" : "election",
    cost: opts.cost,
    recoverableSell: opts.recoverableSell,
    revenueContribution: opts.placement === "separate_line" ? opts.recoverableSell : 0,
    separateInvoiceAmount: opts.placement === "separate_line" ? opts.recoverableSell : 0,
    amortization: null,
  };
}

/** The legacy shape: a production column, placed by inheritance, never unplaced. */
function legacyCharge() {
  return {
    chargeKey: "project_setup",
    ownerKind: "assembly",
    placement: "unit_price",
    source: "legacy",
    cost: 150,
    recoverableSell: 195,
    revenueContribution: 195,
    separateInvoiceAmount: 0,
    amortization: { perUnit: 0.195, tierQuantity: 1000 },
  };
}

const isLeaf = (skuId: string) => skuId === LEAF;

// ══════════════════════════════════════════════════════════════════════
// The lifecycle, step by step
// ══════════════════════════════════════════════════════════════════════

test("1 · a charge with no economics and no election READS without failing", () => {
  // Setup creates it. `componentChargeEconomics` drops a charge with no amount,
  // so at this state the engine produces nothing at all — the read projection
  // has nothing to say and must not object to saying nothing.
  const { instructions, unplaced } = projectRecoveryInstructionsForRead(
    rollups([]),
    isLeaf,
  );
  assert.deepEqual(instructions, []);
  assert.deepEqual(unplaced, []);
});

test("2 · a costed but UNPLACED charge reads, and is NAMED rather than dropped", () => {
  const { instructions, unplaced } = projectRecoveryInstructionsForRead(
    rollups([componentCharge({ placement: "unplaced", cost: 1450, recoverableSell: null })]),
    isLeaf,
  );
  // No instruction: there is nothing to instruct anyone to do.
  assert.deepEqual(instructions, []);
  // But it is reported. A caller that needs to know cannot fail to be told.
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].chargeInstanceId, "inst-1");
  assert.equal(unplaced[0].chargeKey, "print_plates");
  assert.equal(unplaced[0].tierId, TIER);
});

test("3 · NEGATIVE CONTROL · the same state still REFUSES to commit", () => {
  // ── THE ASSERTION THE WHOLE REPAIR RESTS ON ────────────────────────────
  //
  // A repair that made the read path work by weakening the freeze would pass
  // every positive test in this file. This is the one it would fail.
  assert.throws(
    () =>
      projectFrozenInstructions(
        rollups([componentCharge({ placement: "unplaced", cost: 1450, recoverableSell: null })]),
        isLeaf,
      ),
    /Cannot freeze an unplaced charge/,
  );
});

test("4 · once PLACED, the read projection produces the instruction", () => {
  const { instructions, unplaced } = projectRecoveryInstructionsForRead(
    rollups([
      componentCharge({ placement: "separate_line", cost: 1450, recoverableSell: 1885 }),
    ]),
    isLeaf,
  );
  assert.deepEqual(unplaced, []);
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].treatment, "separate_line");
  assert.equal(instructions[0].cost, 1450);
  assert.equal(instructions[0].governedRecovery, 1885);
});

test("5 · and the commit projection now SUCCEEDS, agreeing exactly", () => {
  const placed = rollups([
    componentCharge({ placement: "separate_line", cost: 1450, recoverableSell: 1885 }),
  ]);
  const committed = projectFrozenInstructions(placed, isLeaf);
  const { instructions } = projectRecoveryInstructionsForRead(placed, isLeaf);
  assert.equal(committed.length, 1);
  // ── THE TWO MUST NOT DRIFT ─────────────────────────────────────────────
  //
  // They are one projection asked at two moments, differing ONLY in what they
  // do about a charge nobody has placed. Once everything is placed they must
  // be identical, field for field — otherwise the draft renders one thing and
  // Accounting is billed another.
  assert.deepEqual(committed, instructions);
});

// ══════════════════════════════════════════════════════════════════════
// Legacy control
// ══════════════════════════════════════════════════════════════════════

test("LEGACY CONTROL · a production-column charge is unchanged in both modes", () => {
  // Every live quote today is in this state: charges placed by inheritance,
  // with no election row. The repair must be invisible to them.
  const legacy = rollups([legacyCharge()]);
  const committed = projectFrozenInstructions(legacy, isLeaf);
  const { instructions, unplaced } = projectRecoveryInstructionsForRead(legacy, isLeaf);

  assert.equal(committed.length, 1);
  assert.equal(committed[0].treatmentSource, "legacy");
  assert.equal(committed[0].treatment, "unit_price");
  assert.equal(committed[0].amortizedPerUnit, 0.195);
  // A legacy charge can never BE unplaced — a production column always had a
  // treatment to inherit — so the read mode has nothing to report and returns
  // exactly what commit does.
  assert.deepEqual(unplaced, []);
  assert.deepEqual(instructions, committed);
});

test("LEGACY CONTROL · a mixed quote freezes the legacy half and refuses the whole", () => {
  // The sharp case: a quote carrying BOTH a legacy charge and an unplaced
  // component charge. Read gives the legacy instruction and names the other;
  // commit refuses the lot, because a partial freeze is a record Accounting
  // would act on as if it were complete.
  const mixed = rollups([
    legacyCharge(),
    componentCharge({ placement: "unplaced", cost: 1450, recoverableSell: null }),
  ]);
  const { instructions, unplaced } = projectRecoveryInstructionsForRead(mixed, isLeaf);
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].chargeKey, "project_setup");
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].chargeKey, "print_plates");

  assert.throws(() => projectFrozenInstructions(mixed, isLeaf), /Cannot freeze an unplaced/);
});

// ══════════════════════════════════════════════════════════════════════
// Wiring — the right projection at the right call site
// ══════════════════════════════════════════════════════════════════════

test("the resolver READS and the send path COMMITS", () => {
  // ── WHY THIS IS ASSERTED IN SOURCE ─────────────────────────────────────
  //
  // Both projections return `FrozenRecoveryInstruction[]`, so TYPESCRIPT
  // CANNOT TELL THEM APART. Pointing the freeze at the read list would compile
  // cleanly and silently drop a real cost from the record Accounting bills
  // from — and `tsc` was in fact clean at the moment the send path was still
  // wired to the wrong one during this repair.
  const resolver = codeOnly(read("src/lib/customer-view-resolver.ts"));
  assert.match(resolver, /projectRecoveryInstructionsForRead\(\s*\n?\s*bundle\.data\.costing/);
  assert.match(resolver, /recoveryInstructions: readInstructions\.instructions/);
  assert.match(resolver, /unplacedRecoveryCharges: readInstructions\.unplaced/);
  // The commit projection is present, but only inside the thunk.
  assert.match(
    resolver,
    /freezeRecoveryInstructions: \(\) =>\s*\n?\s*projectFrozenInstructions\(/,
  );

  const send = codeOnly(read("src/app/actions/quotes.ts"));
  assert.match(send, /const frozenInstructions = resolved\.freezeRecoveryInstructions\(\)/);
  assert.match(send, /frozenInstructions\.map\(\(i\) => \(\{/);
  assert.ok(
    !/resolved\.recoveryInstructions/.test(send),
    "the send path must never freeze the draft-rendering list",
  );
});

test("no generic catch was used to make the page load", () => {
  // Suppressing the exception would hide failures nobody has anticipated and
  // leave the read path claiming to have projected instructions it dropped.
  const resolver = codeOnly(read("src/lib/customer-view-resolver.ts"));
  // ── THE FIRST VERSION OF THIS GUARD COULD NOT FAIL ─────────────────────
  //
  // It matched `catch` followed by the call, which only catches one of the two
  // ways to write a try/catch — and the natural way puts the call FIRST:
  // `try { return projectFrozenInstructions(...) } catch { return [] }`.
  // Injecting exactly that left this test green. A guard that cannot express
  // the failure it names reads as coverage while providing none.
  //
  // Matched in both directions now, and falsified in both.
  assert.ok(
    !/catch[\s\S]{0,160}?projectFrozenInstructions/.test(resolver),
    "the fix is a split contract, not a swallowed throw",
  );
  assert.ok(
    !/projectFrozenInstructions[\s\S]{0,160}?catch/.test(resolver),
    "the fix is a split contract, not a swallowed throw",
  );
});

test("one row builder, so the two modes cannot drift field by field", () => {
  const f = codeOnly(read("src/lib/commercial-recovery/frozen-instruction.ts"));
  assert.match(f, /function instructionFor\(/);
  // Both paths go through it.
  assert.match(f, /return instructionFor\(ownerRef, tierId, c, manualAllInSell\)/);
  assert.match(f, /instructions\.push\(instructionFor\(ownerRef, tierId, charge, manualAllInSell\)\)/);
  // And the shape is built exactly once. Counted on a field the manual-all-in
  // repair does NOT branch on — `governedRecovery` and `amortizedPerUnit` now
  // each appear in a conditional, so counting those would be counting the
  // repair rather than the number of builders.
  assert.equal((f.match(/separateInvoiceAmount: c\.separateInvoiceAmount/g) ?? []).length, 1);
  assert.equal((f.match(/function instructionFor\(/g) ?? []).length, 1);
});

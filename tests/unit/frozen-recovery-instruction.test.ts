import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import {
  instructionSentence,
  projectFrozenInstructions,
  type FrozenRecoveryInstruction,
} from "../../src/lib/commercial-recovery/frozen-instruction.ts";
import { constructCommercial } from "../../src/lib/commercial-recovery/construct.ts";
import { chargeEconomicsFor } from "../../src/lib/costing.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const prod = (allocate: boolean) =>
  ({
    quoteSkuId: "leaf", tierId: "t1",
    allocateServiceFeesToCost: allocate,
    setupFeeTotal: 1000,
    toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
    rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
    fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
    actualUnitsProduced: null,
  }) as never;

/** Costing with a leaf construction AND its parent's merge, as the engine emits. */
function costing(allocate: boolean, elections: ChargeElection[] = [], qty = 10_000) {
  const built = constructCommercial(
    chargeEconomicsFor(prod(allocate), 0.4),
    elections,
    allocate,
    qty,
  );
  return {
    skuRollups: [
      { skuId: "leaf", perTier: [{ tierId: "t1", constructed: built }] },
      // The parent carries the MERGE of its children — present in every real
      // bundle, and the reason the projection must not take instructions from
      // both levels.
      { skuId: "asm", perTier: [{ tierId: "t1", constructed: built }] },
    ],
  };
}
const isLeaf = (id: string) => id === "leaf";

// ═══════════════════════════════════════════════════════════════════════
// EVERY PLACED CHARGE, NOT EVERY ELECTED ONE.
//
// A legacy-placed charge has no election row — absence of a row is the model's
// load-bearing state — so an instruction built from elections records nothing
// for the great majority of charges. Every live quote today is in that state,
// so it would freeze nothing at all.
// ═══════════════════════════════════════════════════════════════════════

test("a LEGACY charge is instructed, though it has no election row", () => {
  const rows = projectFrozenInstructions(costing(true, []), isLeaf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].treatmentSource, "legacy");
  assert.equal(rows[0].treatment, "unit_price");
  // Which is the whole point: Accounting can tell "amortized under legacy
  // pricing, do not invoice" from "this charge does not exist".
  assert.match(instructionSentence(rows[0]), /DO NOT INVOICE SEPARATELY/);
});

// ═══════════════════════════════════════════════════════════════════════
// A LEGACY AMORTIZATION HAS NO PER-UNIT FIGURE TO FREEZE.
//
// The measurement that forces this, taken end-to-end on a $1,000 fee at a 1.4
// rate over 1,000 units:
//
//     gpa 0.00   allocated 2400   own line 2400   delta   0
//     gpa 0.20   allocated 2880   own line 2600   delta 280  = 1400 x 0.20
//     gpa 0.50   allocated 3600   own line 2900   delta 700  = 1400 x 0.50
//
// A legacy allocated fee flows into the sell ladder, so the quote-level
// adjustment reaches it and the customer pays 1400 x (1 + gpa) for the charge.
// Freezing the governed $0.14/unit would put a figure an accountant would act
// on beside a charge the customer paid $0.168/unit for. An ELECTED placement is
// added after the ladder and IS fixed — which is the commercial substance of
// electing, not a detail of it.
// ═══════════════════════════════════════════════════════════════════════

test("a legacy amortization freezes NO per-unit basis, and says why", () => {
  const i = projectFrozenInstructions(costing(true, []), isLeaf)[0];
  assert.equal(i.treatment, "unit_price");
  assert.equal(i.amortizedPerUnit, null, "froze a per-unit the ladder moves");
  assert.equal(i.tierQuantity, null);
  // The governed figure is still recorded — it is a real quantity — and the
  // sentence keeps a reader from mistaking it for the realized one.
  assert.equal(i.governedRecovery, 1400);
  assert.equal(i.separateInvoiceAmount, 0);
  assert.match(instructionSentence(i), /not independently governed/);
  assert.match(instructionSentence(i), /DO NOT INVOICE SEPARATELY/);
  // NOT the null-as-missing-data reading.
  assert.doesNotMatch(instructionSentence(i), /undetermined|unknown/);
});

test("an ELECTED amortization of the same charge DOES freeze a basis", () => {
  // The pair, side by side: same charge, same governed recovery, and only one
  // of them has an amortization an accountant can reconcile.
  const legacy = projectFrozenInstructions(costing(true, []), isLeaf)[0];
  const elected = projectFrozenInstructions(
    costing(true, [{ chargeKey: "project_setup", mode: "included" }]),
    isLeaf,
  )[0];

  assert.equal(legacy.treatment, elected.treatment, "both are amortized");
  assert.equal(legacy.governedRecovery, elected.governedRecovery);
  assert.equal(legacy.amortizedPerUnit, null);
  assert.equal(elected.amortizedPerUnit, 0.14);
  assert.notEqual(instructionSentence(legacy), instructionSentence(elected));
});

test("the parent's merged construction is NOT recorded a second time", () => {
  // An assembly rollup carries its children's charges merged. Taking
  // instructions from both levels would double every amortized charge in the
  // record an accountant reads — the worst possible place for a duplicate.
  const rows = projectFrozenInstructions(costing(true, []), isLeaf);
  assert.equal(rows.length, 1, "the charge was recorded at both the leaf and its parent");
  assert.equal(rows[0].ownerRef, "leaf");
});

// ═══════════════════════════════════════════════════════════════════════
// THE THREE QUANTITIES SURVIVE THE FREEZE.
// ═══════════════════════════════════════════════════════════════════════

test("an amortized charge freezes recovery, basis, and a $0 invoice line", () => {
  const rows = projectFrozenInstructions(
    costing(false, [{ chargeKey: "project_setup", mode: "included" }]),
    isLeaf,
  );
  const i = rows[0];
  assert.equal(i.treatment, "unit_price");
  assert.equal(i.treatmentSource, "election");
  assert.equal(i.cost, 1000);
  assert.equal(i.governedRecovery, 1400);
  assert.equal(i.amortizedPerUnit, 0.14);
  assert.equal(i.tierQuantity, 10_000);
  // ZERO, written rather than omitted: it is the instruction.
  assert.equal(i.separateInvoiceAmount, 0);

  assert.equal(
    instructionSentence(i),
    "$1,400.00 recovery amortized at $0.14/unit across 10000 quoted units — separate invoice amount $0.00 — DO NOT INVOICE SEPARATELY.",
  );
});

test("a separately-billed charge freezes the invoice amount and NO basis", () => {
  const rows = projectFrozenInstructions(
    costing(true, [{ chargeKey: "project_setup", mode: "separate" }]),
    isLeaf,
  );
  const i = rows[0];
  assert.equal(i.treatment, "separate_line");
  assert.equal(i.governedRecovery, 1400);
  assert.equal(i.separateInvoiceAmount, 1400);
  // Not a basis of one, and not zero — it was not spread over anything.
  assert.equal(i.amortizedPerUnit, null);
  assert.equal(i.tierQuantity, null);
  assert.match(instructionSentence(i), /INVOICE SEPARATELY/);
  assert.doesNotMatch(instructionSentence(i), /DO NOT/);
});

test("the frozen row distinguishes two treatments that recover the same amount", () => {
  // Same money, different invoice. This is the pair the record exists to keep
  // apart, and it is exactly what revenue-neutrality would have collapsed.
  const inc = projectFrozenInstructions(
    costing(false, [{ chargeKey: "project_setup", mode: "included" }]), isLeaf,
  )[0];
  const sep = projectFrozenInstructions(
    costing(true, [{ chargeKey: "project_setup", mode: "separate" }]), isLeaf,
  )[0];

  assert.equal(inc.governedRecovery, sep.governedRecovery);
  assert.notEqual(inc.separateInvoiceAmount, sep.separateInvoiceAmount);
  assert.notEqual(inc.treatment, sep.treatment);
  assert.notEqual(instructionSentence(inc), instructionSentence(sep));
});

test("an unpriced recovery freezes null, and says so", () => {
  const built = constructCommercial(
    chargeEconomicsFor(prod(false), null), // no governed rate
    [{ chargeKey: "project_setup", mode: "separate" }],
    false,
    10_000,
  );
  const rows = projectFrozenInstructions(
    { skuRollups: [{ skuId: "leaf", perTier: [{ tierId: "t1", constructed: built }] }] },
    isLeaf,
  );
  // NULL, not 0. Zero would say the charge recovers nothing; the truth is that
  // nothing governs what it recovers (BV-013).
  assert.equal(rows[0].governedRecovery, null);
  assert.equal(rows[0].cost, 1000, "cost is known even when the rate is not");
  assert.match(instructionSentence(rows[0]), /unpriced/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE FREEZE IS INSIDE THE SEND TRANSACTION AND PROJECTS, NEVER REBUILDS.
// ═══════════════════════════════════════════════════════════════════════

test("the send transaction writes the instruction, from the resolved projection", async () => {
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  const at = src.indexOf("tx.insert(quoteSnapshotRecoveryInstructions)");
  assert.ok(at > 0, "the send path does not freeze the recovery instruction");

  // ── STILL THE RESOLVER'S OWN CONSTRUCTION, NOW THE COMMIT VIEW OF IT ────
  //
  // The property this test protects is unchanged: the freeze must project the
  // construction the customer document was built from, never a second read.
  // `freezeRecoveryInstructions` is a thunk closing over exactly that
  // construction, so it still holds.
  //
  // What changed is WHICH view. `resolved.recoveryInstructions` is now the
  // READ projection, which omits an unplaced charge so a draft's Quote page
  // can render at all; freezing that list would silently drop a real cost from
  // the record Accounting bills from. Both are `FrozenRecoveryInstruction[]`,
  // so only this assertion distinguishes them.
  assert.match(src.slice(at - 300, at + 400), /frozenInstructions\.map/);
  assert.match(src, /const frozenInstructions = resolved\.freezeRecoveryInstructions\(\)/);
  assert.ok(
    !/resolved\.recoveryInstructions/.test(src),
    "the send path must never freeze the draft-rendering list",
  );
  assert.match(src.slice(at, at + 500), /quoteSnapshotId: snapshot\.id/);
});

test("the projection derives nothing — no rate, no arithmetic on the recovery", async () => {
  const src = codeOnly(await read("src/lib/commercial-recovery/frozen-instruction.ts"));
  for (const forbidden of [/resolveMarkupStrict/, /MARKUP_CATEGORY/, /1 \+ /, /\* \(1/]) {
    assert.doesNotMatch(src, forbidden, `the frozen instruction recomputes ${forbidden}`);
  }
});

test("the $0 invoice amount is WRITTEN, not left null", async () => {
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  const at = src.indexOf("tx.insert(quoteSnapshotRecoveryInstructions)");
  const block = src.slice(at, at + 900);
  // `?? null` on this column would turn the instruction into an absence, and
  // an accountant reading a null cannot tell "bill nothing" from "unknown".
  assert.match(block, /separateInvoiceAmount:[\s\S]{0,120}toFixed\(2\)/);
  assert.doesNotMatch(block, /separateInvoiceAmount: i\.separateInvoiceAmount \?\? null/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE MIGRATION IS ADDITIVE, WHICH IS WHY IT MAY PRECEDE THE CODE.
// ═══════════════════════════════════════════════════════════════════════

test("0101 adds only new types and a new table", async () => {
  const sql = await read("drizzle/0101_frozen_recovery_instruction.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "quote_snapshot_recovery_instructions"/);
  // No tightening of anything existing — the deployment-order rule turns on
  // exactly this distinction.
  assert.doesNotMatch(sql, /ALTER TABLE(?![^;]*ADD COLUMN)/);
  assert.doesNotMatch(sql, /SET NOT NULL/);
  assert.doesNotMatch(sql, /DROP /);
});

const sample: FrozenRecoveryInstruction = {
  chargeKey: "project_setup",
  ownerRef: "leaf",
  ownerKind: "assembly" as const,
  tierId: "t1",
  // NULL, and correctly so: this sample is a LEGACY placed charge, which has
  // no election and therefore no instance. The component case is asserted in
  // `od-032-freeze-integrity.test.ts`.
  chargeInstanceId: null,
  treatment: "absorbed",
  treatmentSource: "election",
  cost: 1000,
  governedRecovery: 0,
  separateInvoiceAmount: 0,
  amortizedPerUnit: null,
  tierQuantity: null,
  // A computed price, so the recovery figures mean what they say. The manual
  // all-in case is asserted in `od-032-override-authority.test.ts`.
  manualAllInSell: false,
};

test("an absorbed instruction states the retained cost and bills nothing", () => {
  // Unreachable today — absorbed is refused — but the frozen shape has to be
  // able to say it, or opening the mode later would need a migration to
  // express a decision the model already has.
  assert.match(instructionSentence(sample), /absorbed by DPS/);
  assert.match(instructionSentence(sample), /DO NOT INVOICE/);
  assert.equal(sample.cost, 1000);
});

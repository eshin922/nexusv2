import assert from "node:assert/strict";
import test from "node:test";

import {
  emitAccountingLines,
  emittedTotalCents,
} from "../../src/lib/netsuite/accounting-line-emitter.ts";
import { checkLinkB } from "../../src/lib/netsuite/reg4.ts";
import { decimalFromCents } from "../../src/lib/netsuite/frozen-cents.ts";
import type { ResolvedAccountingLine } from "../../src/lib/netsuite/projection-readiness.ts";

/**
 * The commercial line SHAPE — a Direct Service and a one-time charge differ.
 *
 * ── WHAT THIS EXISTS TO CATCH ────────────────────────────────────────────
 *
 * SO2717. The emitter hardcoded `quantity: 1` for everything, on the premise
 * that a Direct Service and a separately billed OTC charge were "the same kind
 * of thing". A line the customer accepted as **2,000 units at $2.24** posted to
 * NetSuite as **1 at $4,480**.
 *
 * The disposition (Edward, 2026-08-19): the FROZEN commercial line shape is
 * authoritative.
 *
 *   Direct Service        qty = frozen qty, rate = frozen unit rate
 *   Separately billed OTC qty = 1,          rate = frozen line amount
 *
 * ── WHY REG-4 IS PRESENT BUT NOT THE PROOF ───────────────────────────────
 *
 * REG-4 reconciles totals. `1 × 4480` and `2000 × 2.24` are the same total, so
 * it was EXACT while the shape was wrong — it cannot distinguish these cases
 * even in principle. It is asserted here to show it still holds under both
 * shapes, and it is deliberately never the thing that proves the shape.
 */

const CERT303: ResolvedAccountingLine = {
  sourceLineId: "svc-1",
  kind: "direct_service",
  owningAssemblyId: null,
  displayName: "Testing / Micros",
  destination: "otc_testing",
  netsuiteItemId: "15323",
  netsuiteItemCode: "OTC-0016",
  amountCents: 448_000,
  quantity: 2000,
  unitRate: "2.2400",
};

const SETUP: ResolvedAccountingLine = {
  sourceLineId: "otc-1",
  kind: "otc",
  owningAssemblyId: "asm-1",
  displayName: "Setup",
  destination: "otc_setup",
  netsuiteItemId: "5001",
  netsuiteItemCode: "OTC-SETUP",
  amountCents: 140_00,
  quantity: null,
  unitRate: null,
};

// ── 1 · a unit-priced Direct Service keeps its own shape ─────────────────

test("Direct Service preserves qty x rate = amount, from the frozen row", () => {
  const [e] = emitAccountingLines([CERT303]);

  assert.equal(e.quantity, 2000, "quantity was not carried from the frozen row");
  assert.equal(e.rate, "2.2400", "unit rate was not carried VERBATIM");
  assert.equal(e.amountCents, 448_000);

  // The identity holds. Asserted in integer cents so the check itself cannot
  // introduce the float error the carried values exist to avoid.
  assert.equal(
    Math.round(Number(e.rate) * e.quantity * 100),
    e.amountCents,
    "qty x rate does not reproduce the frozen amount",
  );
});

test("the unit rate keeps four decimals — a cents round trip would lose them", () => {
  // The frozen column is numeric(14,4). 0.1234 has no cent representation, so
  // routing the rate through cents would silently post 0.12.
  const [e] = emitAccountingLines([
    { ...CERT303, quantity: 10_000, unitRate: "0.1234", amountCents: 123_400 },
  ]);
  assert.equal(e.rate, "0.1234");
  assert.notEqual(e.rate, decimalFromCents(1234), "the rate went through cents");
});

// ── 2 · a one-time charge stays 1 x amount ───────────────────────────────

test("one-time OTC remains 1 x amount = amount", () => {
  const [e] = emitAccountingLines([SETUP]);
  assert.equal(e.quantity, 1);
  assert.equal(e.rate, "140.00");
  assert.equal(e.amountCents, 140_00);
  assert.equal(Math.round(Number(e.rate) * e.quantity * 100), e.amountCents);
});

test("an OTC charge does NOT acquire the tier quantity", () => {
  // The inverse error of SO2717, and the one a careless split would introduce:
  // a $140 setup fee posted as 2,000 x $140.
  const [e] = emitAccountingLines([{ ...SETUP, quantity: 2000, unitRate: "0.0700" }]);
  assert.equal(e.quantity, 1, "an OTC charge took a tier quantity");
  assert.equal(e.rate, "140.00", "an OTC charge took a per-unit rate");
  assert.equal(e.amountCents, 140_00, "the charge amount moved");
});

// ── 3 · the two shapes coexist on one order ──────────────────────────────

test("a mixed order carries both shapes without either leaking", () => {
  const [svc, otc] = emitAccountingLines([CERT303, SETUP]);
  assert.equal(svc.quantity, 2000);
  assert.equal(otc.quantity, 1);
  assert.equal(emittedTotalCents([svc, otc]), 448_000 + 140_00);
});

// ── 4 · REG-4 holds under both, and proves nothing about shape ───────────

test("REG-4 link B passes under both shapes — which is why it is not the proof", () => {
  const asReg4 = (e: ReturnType<typeof emitAccountingLines>[number]) => ({
    sourceLineId: e.sourceLineId,
    description: e.description,
    quantity: e.quantity,
    rate: e.rate,
    amount: decimalFromCents(e.amountCents),
  });

  const correct = emitAccountingLines([CERT303, SETUP]).map(asReg4);
  assert.deepEqual(
    checkLinkB(correct, 448_000 + 140_00),
    [],
    "REG-4 refused the CORRECT order",
  );

  // The SO2717 shape: same money, wrong statement. REG-4 accepts it.
  const wrong = [
    { ...correct[0], quantity: 1, rate: "4480.00" },
    correct[1],
  ];
  assert.deepEqual(
    checkLinkB(wrong, 448_000 + 140_00),
    [],
    "REG-4 was expected to ACCEPT the mis-shaped order — if it now refuses, " +
      "this test's premise has changed and the reasoning below needs revisiting",
  );

  // Both pass. So a shape regression is invisible to reconciliation, and the
  // assertions in sections 1-3 are the only thing standing between the frozen
  // statement and a Sales Order that contradicts it.
});

// ── 5 · the refusal, rather than a silent fallback ───────────────────────

test("a Direct Service missing its frozen shape is REFUSED, not defaulted", () => {
  // Falling back to the charge shape is exactly the silent mis-shaping this
  // split ends, and it would look like success.
  assert.throws(
    () => emitAccountingLines([{ ...CERT303, quantity: null }]),
    /missing its frozen quantity or unit rate/,
  );
  assert.throws(
    () => emitAccountingLines([{ ...CERT303, unitRate: null }]),
    /missing its frozen quantity or unit rate/,
  );
});

// ── 6 · what stayed shared ───────────────────────────────────────────────

test("only the SHAPE split — item, code, amount and provenance stay shared", () => {
  const [svc, otc] = emitAccountingLines([
    { ...CERT303, netsuiteItemId: "999", netsuiteItemCode: "X", amountCents: 500 },
    { ...SETUP, netsuiteItemId: "999", netsuiteItemCode: "X", amountCents: 500 },
  ]);
  assert.equal(svc.netsuiteItemId, otc.netsuiteItemId);
  assert.equal(svc.netsuiteItemCode, otc.netsuiteItemCode);
  assert.equal(svc.amountCents, otc.amountCents);
  assert.equal(svc.sourceLineId, "svc-1");
  assert.equal(otc.sourceLineId, "otc-1");
});

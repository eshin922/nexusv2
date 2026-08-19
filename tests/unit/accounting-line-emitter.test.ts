import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  emitAccountingLines,
  emittedTotalCents,
} from "../../src/lib/netsuite/accounting-line-emitter.ts";
import { centsFromFrozen } from "../../src/lib/netsuite/frozen-cents.ts";
import type { ResolvedAccountingLine } from "../../src/lib/netsuite/projection-readiness.ts";

// ═══════════════════════════════════════════════════════════════════════
// The shared quantity-1 emitter.
//
// Most of what matters here is what the emitter CANNOT do, so several of these
// assert an absence. An absence is worth asserting when its presence would be
// silent — a live-costing lookup or a rate × qty recomputation would both
// produce plausible numbers that happened to be wrong.
// ═══════════════════════════════════════════════════════════════════════

const line = (over: Partial<ResolvedAccountingLine> = {}): ResolvedAccountingLine => ({
  sourceLineId: "line-1",
  kind: "otc",
  owningAssemblyId: "asm-1",
  displayName: "Setup",
  destination: "otc_setup",
  netsuiteItemId: "5001",
  netsuiteItemCode: "OTC-SETUP",
  amountCents: 140_00,
  // A one-time charge has no unit rate of its own. A Direct Service test
  // overrides both — see the shaping tests below.
  quantity: null,
  unitRate: null,
  ...over,
});

// ── exact cents ──────────────────────────────────────────────────────────

test("cents are parsed exactly, not through a float", () => {
  // The reason this exists: Number("1234.56") * 100 === 123455.99999999999.
  assert.equal(centsFromFrozen("1234.56"), 123456);
  assert.notEqual(Math.round(Number("1234.56") * 100), 123455.99999999999);

  assert.equal(centsFromFrozen("0.01"), 1);
  assert.equal(centsFromFrozen("0.10"), 10);
  assert.equal(centsFromFrozen("1400.00"), 140000);
  assert.equal(centsFromFrozen("7240.00"), 724000);
  assert.equal(centsFromFrozen("-15.75"), -1575);
  assert.equal(centsFromFrozen(null), 0);
  assert.equal(centsFromFrozen("900"), 90000, "no decimal point still means whole dollars");
});

test("a long run of awkward values sums exactly", () => {
  // Every one of these is a value binary floating point cannot hold. Summed as
  // floats the total drifts; summed as cents it cannot.
  const awkward = ["0.10", "0.20", "0.30", "1.15", "2.675", "19.99", "1234.56"];
  const cents = awkward.map((v) => centsFromFrozen(v));
  assert.deepEqual(cents, [10, 20, 30, 115, 267, 1999, 123456]);
  assert.equal(
    cents.reduce((a, b) => a + b, 0),
    125897,
    "integer arithmetic, exact",
  );
});

// ── the emitted shape ────────────────────────────────────────────────────

test("an OTC charge is 1 x its amount, carried and never recomputed", () => {
  const [emitted] = emitAccountingLines([line({ amountCents: 140_00 })]);
  assert.equal(emitted.quantity, 1);
  assert.equal(emitted.amountCents, 14000);
  assert.equal(
    emitted.rate,
    "140.00",
    "rate equals amount because quantity is 1 — neither derived from the other",
  );
});

test("an Item Group OTC line keeps its owner; a Direct Service is top-level", () => {
  const emitted = emitAccountingLines([
    line({ kind: "otc", owningAssemblyId: "asm-1", displayName: "Setup" }),
    line({
      sourceLineId: "line-2",
      kind: "direct_service",
      owningAssemblyId: null,
      displayName: "Formulation",
      destination: "otc_formulation",
      // A Direct Service now carries its own frozen shape. Without it the
      // emitter refuses rather than silently posting a quantity-1 charge.
      quantity: 1,
      unitRate: "140.0000",
    }),
  ]);
  assert.equal(emitted[0].owningAssemblyId, "asm-1", "OD-006 association");
  assert.equal(emitted[1].owningAssemblyId, null, "BV-012 §5.c top-level");
});

test("the two kinds SHARE resolution and provenance, and split only on shape", () => {
  // This test used to assert the OPPOSITE — that no branch on kind existed —
  // on the premise that a Direct Service and a one-time charge were the same
  // kind of thing. SO2717 is what that premise cost: a service accepted as
  // 2,000 x $2.24 posted as 1 x $4,480.
  //
  // What must still NOT diverge is everything else, so that is what is asserted
  // now: same item, same code, same amount, same provenance.
  const [otc, svc] = emitAccountingLines([
    line({ kind: "otc", amountCents: 500 }),
    line({
      sourceLineId: "b",
      kind: "direct_service",
      owningAssemblyId: null,
      amountCents: 500,
      quantity: 100,
      unitRate: "0.0500",
    }),
  ]);
  assert.equal(otc.netsuiteItemId, svc.netsuiteItemId);
  assert.equal(otc.netsuiteItemCode, svc.netsuiteItemCode);
  assert.equal(otc.amountCents, svc.amountCents, "the money does not depend on the shape");

  // …and the shape DOES differ, which is the point.
  assert.equal(otc.quantity, 1);
  assert.equal(svc.quantity, 100);
});

test("emitted order follows frozen position, so it reads like the document", () => {
  const emitted = emitAccountingLines([
    line({ sourceLineId: "a", displayName: "Setup" }),
    line({ sourceLineId: "b", displayName: "Tooling" }),
    line({ sourceLineId: "c", displayName: "R&D" }),
  ]);
  assert.deepEqual(emitted.map((e) => e.description), ["Setup", "Tooling", "R&D"]);
});

test("every emitted line traces back to the frozen line it came from", () => {
  const emitted = emitAccountingLines([line({ sourceLineId: "frozen-42" })]);
  assert.equal(emitted[0].sourceLineId, "frozen-42");
});

test("the total is an integer-cent sum — the left side of REG-4 link B", () => {
  const total = emittedTotalCents(
    emitAccountingLines([
      line({ amountCents: 14000 }),
      line({ sourceLineId: "b", amountCents: 70000 }),
      line({ sourceLineId: "c", amountCents: 140000 }),
    ]),
  );
  assert.equal(total, 224000);
  assert.ok(Number.isInteger(total));
});

// ── the absences ─────────────────────────────────────────────────────────

test("the emitter cannot reach live costing, by construction", async () => {
  const src = await readFile("src/lib/netsuite/accounting-line-emitter.ts", "utf8");
  assert.doesNotMatch(src, /getCostingBundle|computeQuoteCosting|@\/db|drizzle/);
  // The guard is an ALLOWLIST, not a count.
  //
  // It used to assert exactly one import, which broke the moment the OTC shape
  // needed `decimalFromCents` — a pure integer-to-decimal formatter that
  // touches nothing. A count is only a proxy for "cannot reach live costing";
  // naming the permitted imports asserts it directly, and the count would have
  // passed equally had that one import been the costing tree itself.
  const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0].trim());
  const ALLOWED = [
    /^import type \{ ResolvedAccountingLine \} from "@\/lib\/netsuite\/projection-readiness";$/,
    /^import \{ decimalFromCents \} from "@\/lib\/netsuite\/frozen-cents";$/,
  ];
  for (const imp of imports) {
    assert.ok(
      ALLOWED.some((re) => re.test(imp)),
      `emitter acquired an import outside the allowlist: ${imp}`,
    );
  }
  assert.equal(imports.length, ALLOWED.length, imports.join(" | "));
});

test("the emitter names no item type — that belongs to the resolved record", async () => {
  const src = await readFile("src/lib/netsuite/accounting-line-emitter.ts", "utf8");
  assert.doesNotMatch(src, /"inventory"|"non_inventory"|itemType/);
});

test("nothing about an emitted line reaches composition_hash", async () => {
  const emitter = await readFile("src/lib/netsuite/accounting-line-emitter.ts", "utf8");
  // Asserted on the CALL, not the word. The emitter comment explains why an
  // OTC line does not participate, so a grep for "composition" matches the
  // documentation of the property and fails on correct code — a filter that
  // cannot distinguish a mention from a use measures nothing.
  assert.doesNotMatch(emitter, /computeCompositionHash|from "[^"]*composition-hash"/);
  // And the hash's own inputs remain the physical member set: a customer, a
  // base SKU, and members. An OTC charge is none of those.
  const hash = await readFile("src/lib/netsuite/composition-hash.ts", "utf8");
  assert.match(hash, /customerNetsuiteId: string;[\s\S]{0,120}baseSku: string;[\s\S]{0,120}members:/);
});

test("readiness returns the resolved lines, so emission cannot re-resolve", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // One pass produces both the verdict and the lines. Two passes would be two
  // answers to "which item does this line post to" (Pattern 58) — and would
  // let readiness certify a line the emitter then sends somewhere else.
  assert.match(src, /lines: ResolvedAccountingLine\[\];/);
  assert.match(src, /lines: resolved,/);
  assert.equal(
    (src.match(/const resolved: ResolvedAccountingLine\[\] = \[\];/g) ?? []).length,
    1,
    "exactly one resolution pass",
  );
});

test("the emitter performs NO arithmetic on an amount — it carries them", async () => {
  const src = await readFile("src/lib/netsuite/accounting-line-emitter.ts", "utf8");

  // Value equality alone cannot prove this, and I checked: replacing the
  // carried amount with `Math.round((cents / 100) * qty * 100)` passed every
  // other test in this file, because the fixture values round-trip cleanly
  // through a float. A recomputation only diverges on values that do not, so a
  // test that asserts equality on tidy numbers is blind to exactly the change
  // it is meant to catch.
  //
  // What IS provable is that no arithmetic happens at all. Comments are
  // stripped first — they are full of asterisks, and a filter that trips on its
  // own documentation measures nothing.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Import lines too: a module specifier contains slashes, and a path is
    // not arithmetic.
    .replace(/^import .*$/gm, "");

  for (const forbidden of ["Math.", "Number(", "parseFloat", "toFixed", "*", "/"]) {
    assert.ok(
      !code.includes(forbidden),
      `emitter must not contain "${forbidden}" — amounts are carried, not computed`,
    );
  }
  // Summing IS allowed, and only in the total helper.
  assert.match(code, /reduce\(\(sum, l\) => sum \+ l\.amountCents, 0\)/);
});

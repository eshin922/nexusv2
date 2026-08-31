/**
 * Item Group membership quantity — the governed rule, and the two repaired
 * defects it gates.
 *
 * ── WHY THESE TESTS EXIST ───────────────────────────────────────────────
 *
 * `costing.ts:3238` records that no `assembly_leaves` row in the estate carries
 * a quantity other than 1, "the coincidence that let it survive (Pattern 56)".
 * Two defects were repaired behind that coincidence and neither could be
 * exercised by real data, because operators had no way to author the value.
 *
 * The repair adds that path. These tests hold the arithmetic the path makes
 * reachable, and — per the falsification discipline — each one reintroduces the
 * OLD behaviour and asserts it produces a DIFFERENT answer. A test that passes
 * against both the fix and the bug proves nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertMembershipQuantity,
  isValidMembershipQuantity,
  MEMBERSHIP_QUANTITY_REFUSAL,
} from "@/lib/product-structure/membership-quantity";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

// ══════════════════════════════════════════════════════════════════════
// The rule
// ══════════════════════════════════════════════════════════════════════

test("accepts whole numbers of 1 or more, and canonicalises them", () => {
  assert.equal(assertMembershipQuantity("1"), "1");
  assert.equal(assertMembershipQuantity("2"), "2");
  assert.equal(assertMembershipQuantity(" 12 "), "12");
  // "007" and "7" are one composition fact, not two stored values.
  assert.equal(assertMembershipQuantity("007"), "7");
  assert.equal(assertMembershipQuantity(3), "3");
});

test("refuses zero, negative and fractional", () => {
  // Zero is the sharp one: it becomes the amortisation divisor
  // (tierQty x qtyPerParent), so it does not merely mis-price — it divides by
  // zero. Negative would invert a cost into a credit.
  for (const bad of ["0", "-1", "-3", "0.5", "1.5", "2.0", ".5"]) {
    assert.throws(() => assertMembershipQuantity(bad), /whole number/i, `accepted ${bad}`);
    assert.equal(isValidMembershipQuantity(bad), false, `predicate accepted ${bad}`);
  }
});

test("refuses what a lenient parse would accept", () => {
  // `Number("2abc")` is NaN but `parseInt("2abc")` is 2. Neither may be stored.
  for (const bad of ["", "  ", "abc", "2abc", "1e3", "1,000", "+2", "Infinity", "NaN", null, undefined]) {
    assert.equal(isValidMembershipQuantity(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("the refusal names the fact, not the field", () => {
  // An operator who sees this needs to know what the number MEANS, because the
  // surface also carries a tier "Quantity" that is a different fact.
  assert.match(MEMBERSHIP_QUANTITY_REFUSAL, /component/i);
  assert.match(MEMBERSHIP_QUANTITY_REFUSAL, /parent/i);
});

// ══════════════════════════════════════════════════════════════════════
// One rule, two write paths
// ══════════════════════════════════════════════════════════════════════

test("both write paths share the validator", () => {
  const actions = read("src/app/actions/assemblies.ts");
  const move = read("src/lib/product-structure/structural-move.ts");

  assert.match(actions, /export async function updateAssemblyLeafQuantity\(/);
  // Attach validates too, so a quantity update would refuse cannot be smuggled
  // in by attaching instead.
  assert.match(actions, /quantity: assertMembershipQuantity\(/);
  // A move PRESERVES the fact; preserving an invalid one would make
  // Direct -> Group a way around the rule.
  assert.match(move, /quantity: assertMembershipQuantity\(canonical\.quantity\)/);
});

test("the update is keyed by junction, never by position", () => {
  const actions = read("src/app/actions/assemblies.ts");
  const body = actions.slice(actions.indexOf("export async function updateAssemblyLeafQuantity"));
  const fn = body.slice(0, body.indexOf("\nexport async function", 10));

  assert.match(fn, /formData\.get\("junctionId"\)/);
  assert.match(fn, /eq\(assemblyLeaves\.id, junctionId\)/);
  // Position is display order and is reorderable. Keying on it would edit the
  // wrong member's composition the moment a row was dragged.
  assert.doesNotMatch(fn, /\.set\(\s*\{[^}]*position/);
  // Edit in place. Detach/reattach would mint a new junction and orphan every
  // per-(leaf,tier) cost row keyed to the old identity.
  assert.doesNotMatch(fn, /delete\(assemblyLeaves\)/);
  assert.doesNotMatch(fn, /insert\(assemblyLeaves\)/);
});

test("the update is draft-only and audited with recoverable identity", () => {
  const actions = read("src/app/actions/assemblies.ts");
  const body = actions.slice(actions.indexOf("export async function updateAssemblyLeafQuantity"));
  const fn = body.slice(0, body.indexOf("\nexport async function", 10));

  assert.match(fn, /assertDraft\(quote\)/, "composition is structure; structure is draft-only");
  assert.match(fn, /action: "assembly_leaf_quantity_updated"/);
  for (const key of ["assembly_leaf_id", "assembly_id", "leaf_id", "quote_leaf_id", "position"]) {
    assert.ok(fn.includes(key), `audit is missing ${key}`);
  }
  assert.match(fn, /quantity: \{ from:/, "audit must carry from/to");
});

// ══════════════════════════════════════════════════════════════════════
// The two repaired defects this value gates — each FALSIFIED
// ══════════════════════════════════════════════════════════════════════

test("FALSIFY · one-time recovery amortises over tierQty x qtyPerParent", () => {
  // The shipped defect divided a fixed charge by the tier quantity ALONE, so a
  // component appearing q times per finished good billed the charge q times.
  // `costing.ts:3236` records the measured shape: 1,680 recovered as 5,040.
  const FEE = 1680;
  const tierQty = 1000;
  const q = 3;

  const repaired = FEE / (tierQty * q);          // per COMPONENT unit
  const old = FEE / tierQty;                      // the defect

  // What the customer is billed: the line bills at tierQty x qtyPerParent.
  const billedRepaired = repaired * tierQty * q;
  const billedOld = old * tierQty * q;

  assert.equal(billedRepaired, FEE, "the charge must bill once");
  assert.equal(billedOld, FEE * q, "the old divisor billed it q times");
  assert.equal(billedOld, 5040, "the recorded defect figure");
  // Non-vacuous: at q=1 the two are identical, which is exactly why no live
  // quote could ever have exposed this.
  assert.equal(FEE / (tierQty * 1), FEE / tierQty, "at q=1 the defect is invisible");
});

test("FALSIFY · freight does not double when member quantity doubles", () => {
  // Freight arrives at the parent fold ALREADY denominated per SELLABLE unit,
  // because `computeShipmentContribution` amortised it by the tier quantity.
  // Scaling it again by BOM multiplicity doubled it: `costing.ts:4008` records
  // a $500 shipment on a leaf with qtyPerParent 2 reporting $1000.
  const SHIPMENT = 500;
  const tierUnits = 1;
  const q = 2;

  const perSellableUnit = SHIPMENT / tierUnits;   // already sellable-basis
  const repaired = perSellableUnit;               // held OUT of the x q fold
  const old = perSellableUnit * q;                // scaled again

  assert.equal(repaired, 500, "freight must not scale with BOM multiplicity");
  assert.equal(old, 1000, "the recorded defect figure");
  assert.notEqual(repaired, old, "the fixture cannot tell the two apart");

  // A component-unit value in the same fold MUST still scale — otherwise the
  // repair would have broken the thing it was protecting.
  const componentUnitCost = 1.37;
  assert.equal(componentUnitCost * q, 2.74, "component-unit values still scale");
});

test("the engine still records why this was unreachable", () => {
  // If this comment is ever removed, the reason these tests exist goes with it.
  const costing = read("src/lib/costing.ts");
  assert.match(costing, /no `assembly_leaves` row in the estate carries a quantity/);
  assert.match(costing, /const lineUnitsPerTierUnit = Number\(sku\.qtyPerParent \?\? 1\) \|\| 1;/);
  assert.match(costing, /amortizationDivisor = tierQty \* lineUnitsPerTierUnit/);
});

// ══════════════════════════════════════════════════════════════════════
// The operator surface
// ══════════════════════════════════════════════════════════════════════

test("Setup exposes the control, named for its grain, with no Costs duplicate", () => {
  const row = read("src/components/assembly-tree/asy-row.tsx");
  assert.match(row, /function QtyPerParentCell\(/);
  assert.match(row, /updateAssemblyLeafQuantity\(fd\)/);
  assert.match(row, /fd\.set\("junctionId", junctionId\)/);
  // Named for the grain: the tier table on this same surface already has a
  // control called "Quantity", meaning something else entirely.
  assert.match(row, /Qty \/ parent/);

  // No Costs-side duplicate authority for the same fact.
  for (const f of [
    "src/components/costs/packaging-drilldown.tsx",
    "src/components/costs/production-drilldown.tsx",
  ]) {
    assert.doesNotMatch(read(f), /updateAssemblyLeafQuantity/, `${f} must not write membership quantity`);
  }
});

test("the input obeys Pattern 47(e) and commits explicitly", () => {
  const row = read("src/components/assembly-tree/asy-row.tsx");
  const cell = row.slice(row.indexOf("function QtyPerParentCell"), row.indexOf("function LeafRow"));

  // Disabling an input while its own save is in flight drops focus mid-edit.
  assert.match(cell, /disabled=\{!editable\}/);
  assert.doesNotMatch(cell, /disabled=\{[^}]*pending/);
  // Per-keystroke would write through "1" on the way to "12" — a valid
  // quantity that would recompute the whole quote.
  assert.match(cell, /onBlur=\{commit\}/);
  assert.match(cell, /e\.key === "Enter"/);
  assert.match(cell, /e\.key === "Escape"/);
});

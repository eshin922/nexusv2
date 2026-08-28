/**
 * OD-032 A — the authoring affordance reaches BOTH component shapes.
 *
 * ── WHAT THIS FILE CAN AND CANNOT ESTABLISH ──────────────────────────────
 *
 * Ownership semantics are facts about stored columns, so they are proven by
 * `npm run gate1b:od-032-direct-authoring`, which writes through the real
 * writer, reads back through the real reader, and verifies its own cleanup.
 *
 * What lives HERE is the part that must hold on every CI run without a
 * database: that both row components carry the affordance, that a Direct
 * Service does not, and that the sheet's target type cannot express Item Group
 * identity at all. The defect being guarded against was purely structural — an
 * affordance wired to one of two row components — and structure is what source
 * assertions are good for.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const BODY = "src/components/assembly-tree/assembly-tree-body.tsx";
const DIRECT = "src/components/assembly-tree/direct-product-row.tsx";
const MEMBER = "src/components/assembly-tree/leaf-context-menu.tsx";
const CREATE = "src/lib/component-charges/create.ts";
const PROOF = "scripts/gate-1b/od-032-direct-product-authoring.ts";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments are prose, not behaviour. Matching one as a use has misled before. */
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// Both shapes, one act
// ══════════════════════════════════════════════════════════════════════

test("BOTH component rows carry the authoring affordance", () => {
  // The defect: `onAddCharges` was passed to `AsyRow` and nowhere else, so it
  // reached the grouped member's menu only. A Direct Product is a component
  // that causes charges exactly as a member does — Item Group membership was
  // never the qualifying condition.
  const body = codeOnly(read(BODY));
  assert.match(body, /<AsyRow[\s\S]{0,2000}?onAddCharges=\{setChargeSheetLeaf\}/);
  assert.match(
    body,
    /<DirectProductRow[\s\S]{0,2000}?onAddCharges=\{[\s\S]{0,200}?setChargeSheetLeaf\(product\)/,
  );
});

test("both menus offer the same act under the same label", () => {
  // Not a near-synonym. Two labels for one act would read as two capabilities,
  // and an operator would reasonably wonder which one they wanted.
  for (const file of [DIRECT, MEMBER]) {
    assert.match(read(file), /Add one-time charges/, `${file} must offer the act`);
  }
});

test("both refuse on a frozen quote, and say why", () => {
  // Pattern 52: charges are freeze-list state. The refusal has to be legible
  // at the control, per Pattern 47(f) — a greyed item with no explanation is
  // not acceptable operator behaviour.
  for (const file of [DIRECT, MEMBER]) {
    const t = read(file);
    assert.match(
      t,
      /This quote is no longer a draft; charges are frozen\./,
      `${file} must name the reason it is disabled`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════
// A Direct Service is not a packaging component
// ══════════════════════════════════════════════════════════════════════

test("a Direct SERVICE gets no affordance, and the test is not vacuous", () => {
  // ── THE DISTINCTION IS REAL, NOT DEFENSIVE ─────────────────────────────
  //
  // `DirectProductRow` renders every top-level row, and since Stage 2 that
  // includes Direct Services. A component charge is caused by a PACKAGING
  // component; a Direct Service is already its own priced customer line, which
  // is why the recovery layer carries `ownerKind: "direct_service"` as a
  // separate kind from `component`.
  const body = codeOnly(read(BODY));
  assert.match(body, /product\.commercialKind === "product"/);
  assert.match(body, /:\s*undefined/);

  // NON-VACUITY: `commercialKind` must be a real discriminator the loader
  // populates, not a field this branch invented. If it stopped being emitted,
  // the branch above would silently deny the affordance to every row.
  const tree = read("src/lib/assembly-tree.ts");
  assert.match(tree, /commercialKind: "product" \| "service"/);
  assert.match(tree, /commercialKind: leaf\.commercialKind/);
});

test("service-ness is read from the governed field, never the SKU prefix", () => {
  const body = codeOnly(read(BODY));
  assert.ok(
    !/SVC-/.test(body),
    "sniffing the SKU prefix is the string-matching `commercialKind` exists to end",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The sheet's target cannot express Item Group identity
// ══════════════════════════════════════════════════════════════════════

test("the sheet target carries NO assembly identity — structurally", () => {
  // ── WHY A TYPE AND NOT A CONVENTION ────────────────────────────────────
  //
  // "Neither path synthesizes Item Group ownership" is provable at runtime and
  // is proven there. But the stronger version is that no code path COULD: the
  // target type is narrowed to the four fields the sheet needs, so
  // `junctionId`, `assemblyId` and every other group identity are out of scope
  // of the state entirely. A grouped member and a Direct Product reach the
  // sheet as the same four facts about a component.
  const body = codeOnly(read(BODY));
  assert.match(
    body,
    /type ChargeSheetTarget = Pick<\s*AssemblyLeafNode,\s*"quoteLeafId" \| "sku" \| "name" \| "productType"\s*>/,
  );
  assert.match(body, /useState<ChargeSheetTarget \| null>/);

  const target = body.slice(body.indexOf("type ChargeSheetTarget"));
  const decl = target.slice(0, target.indexOf(">;") + 2);
  for (const forbidden of ["junctionId", "assemblyId", "assembly"]) {
    assert.ok(
      !decl.includes(forbidden),
      `the sheet target must not carry ${forbidden}`,
    );
  }
});

test("there is exactly ONE writer, reached by both paths", () => {
  // No second authoring mechanism, which was the explicit constraint. Both
  // menu items set the same state, which opens the same sheet, which calls the
  // same action, which calls the same core.
  const body = codeOnly(read(BODY));
  assert.equal((body.match(/<AddComponentChargesSheet/g) ?? []).length, 1);

  const create = codeOnly(read(CREATE));
  // The owner goes to the instance as the leaf id it already is — no branch on
  // how the component is arranged in the tree.
  assert.match(create, /ownerRef: quoteLeafId/);
  assert.ok(
    !/assembly/i.test(create),
    "the writer must not consult assembly membership at all",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The runtime proof exists and refuses to be vacuous
// ══════════════════════════════════════════════════════════════════════

test("the ownership proof asserts its own non-vacuity and cleans up", () => {
  const proof = read(PROOF);
  // It must REFUSE rather than pass when it cannot find one grouped and one
  // standalone subject — otherwise it would report a green comparison between
  // two members of the same shape.
  assert.match(proof, /NON-VACUOUS · the subjects really are one grouped and one standalone/);
  assert.match(proof, /if \(!nonVacuous\) refuse\(/);
  // And it verifies its cleanup rather than merely attempting it. A cleanup
  // that can silently fail already left residue on the shared database once.
  assert.match(proof, /RESIDUE · everything this proof created is gone, and that is VERIFIED/);
  assert.match(proof, /leftInstances\.length === 0 && leftTiers\.length === 0/);
});

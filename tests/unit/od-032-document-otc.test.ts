/**
 * OD-032 — component-owned charges reach the customer document.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * The document's OTC construction is shaped around three things a component
 * charge does not have, and each excluded it independently:
 *
 *   it iterates ASSEMBLIES WITH PRODUCTION ROWS   a component charge is owned
 *                                                 by a `quote_leaf` and has no
 *                                                 production row; a Direct
 *                                                 Product has no parent
 *                                                 assembly and is skipped
 *   it iterates OTC_FEES, a fixed COLUMN list     a component charge has no
 *                                                 column
 *   it matches `.find(c => c.chargeKey === k)`    two same-type instances would
 *                                                 collapse to the first
 *
 * Measured on production 2026-08-28: with both charges elected `separate`, the
 * engine reported $10,800 of governed recovery and the document's tier totals
 * were BYTE-IDENTICAL to a quote carrying no charges at all.
 *
 * ── WHAT IS ASSERTED WHERE ──────────────────────────────────────────────
 *
 * The INVARIANT — that placement moves value without changing what the
 * customer owes — is a property of engine, placement, projection and totals
 * together, and is proven against the database by
 * `npm run gate1b:od-032-document-invariant`. A unit fixture asserting the
 * projection alone would have passed throughout the period the document was
 * wrong, because the projection was locally correct about the lines it knew
 * about.
 *
 * What lives HERE is the structure: that the new path is instance-shaped, that
 * identity is carried rather than derived, and that one grammar names charges
 * on both surfaces.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { chooseQualifier } from "../../src/lib/commercial-recovery/qualifier.ts";

const PROJ = "src/lib/commercial-projection.ts";
const RESOLVER = "src/lib/customer-view-resolver.ts";
const WORKSPACE = "src/lib/commercial-recovery/workspace-view.ts";
const TYPES = "src/types/quote.ts";
const GATE = "scripts/gate-1b/od-032-document-invariant.ts";

// NORMALISED AT THE READ. These files are CRLF on a Windows checkout, and a
// pattern anchored on a bare newline silently fails to match one — the
// assertion then reports a defect that is really a line ending. Stripping the
// carriage returns once here beats every pattern having to remember, and the
// character is named by code rather than escaped for the same reason
// `codeOnly` below does it: an escape inside a regex literal inside a
// generated patch is one indirection too many, and it has bitten twice.
const read = (p: string) =>
  readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

/** The component-charge emission, isolated from the legacy loop above it. */
function componentBlock(): string {
  const s = codeOnly(read(PROJ));
  const start = s.indexOf("const componentByInstance");
  const end = s.indexOf("const tierTotals");
  assert.ok(start > 0 && end > start, "the component projection must exist");
  return s.slice(start, end);
}

// ══════════════════════════════════════════════════════════════════════
// The new path is instance-shaped
// ══════════════════════════════════════════════════════════════════════

test("emission is driven by INSTANCE, not by column, assembly or type", () => {
  const block = componentBlock();
  assert.match(block, /for \(const \[chargeInstanceId, entry\] of componentByInstance\)/);
  // None of the three legacy shapes may appear in it — each was an independent
  // exclusion, so using any one would reintroduce a way to lose a charge.
  for (const legacy of ["prodByAssemblyTier", "OTC_FEES", "OTC_FIELD_TO_CHARGE"]) {
    assert.ok(!block.includes(legacy), `the component path must not use ${legacy}`);
  }
  assert.ok(
    !/\.find\(\s*\(c\) => c\.chargeKey/.test(block),
    "matching by charge type is what collapsed two instances into one",
  );
});

test("the line key is the INSTANCE", () => {
  // `otc:${assembly}:${column}` cannot express two charges of one type on one
  // component. This can, and it is the identity the elections and the frozen
  // instructions already use.
  assert.match(componentBlock(), /key: `otc:instance:\$\{chargeInstanceId\}`/);
});

test("an INCLUDED charge emits no line — its value is already in the unit price", () => {
  // A line here as well would bill the customer twice for one charge.
  const block = componentBlock();
  assert.match(block, /if \(!at \|\| !at\.separate\) \{/);
  assert.match(block, /at\.separate = c\.placement === "separate_line"|separate: c\.placement === "separate_line"/);
});

test("BV-013 · an ungoverned recovery is not billed at cost", () => {
  const block = componentBlock();
  assert.match(block, /if \(at\.revenue === null\)/);
  assert.match(block, /state: "quote_on_request"/);
});

test("tiers are kept apart", () => {
  const block = componentBlock();
  // One cell per quoted tier, looked up by tier id — never a fold.
  assert.match(block, /for \(const t of tiers\)/);
  assert.match(block, /entry\.byTier\.get\(t\.tierId\)/);
  assert.ok(!/reduce\(/.test(block), "no accumulation across tiers");
});

// ══════════════════════════════════════════════════════════════════════
// Identity is carried, never derived
// ══════════════════════════════════════════════════════════════════════

test("the line carries `chargeInstanceId` as a field", () => {
  assert.match(read(PROJ), /chargeInstanceId\?: string \| null;/);
  assert.match(componentBlock(), /\n\s+chargeInstanceId,\n/);
});

test("it reaches the document's fee rows without being parsed out of anything", () => {
  const resolver = codeOnly(read(RESOLVER));
  assert.match(resolver, /chargeInstanceId: l\.chargeInstanceId \?\? null/);
  assert.match(read(TYPES), /chargeInstanceId\?: string \| null;/);
  // The four ways an identity gets invented. `id` is a DISPLAY key and has
  // already been two different shapes; parsing it would be reconstructing
  // identity from presentation.
  assert.ok(
    !/chargeInstanceId:[^\n]*\b(split|slice|replace|match|indexOf)\b/.test(resolver),
    "identity must be threaded, never parsed out of a key",
  );
});

test("the display name is not the identity", () => {
  // Two instances of a type can share a customer-facing name; only the id
  // distinguishes them. Asserted because the line's `displayName` is the
  // obvious thing for a downstream reader to key on.
  const block = componentBlock();
  const nameAt = block.indexOf("displayName:");
  const idAt = block.indexOf("chargeInstanceId,");
  assert.ok(idAt > 0 && nameAt > 0 && idAt < nameAt, "identity is set before the label");
});

// ══════════════════════════════════════════════════════════════════════
// One grammar for naming charges, not two
// ══════════════════════════════════════════════════════════════════════

test("both surfaces call the SAME qualifier", () => {
  // ── WHY THIS MATTERS MORE THAN IT LOOKS ────────────────────────────────
  //
  // A second implementation would be a second grammar, free to disagree with
  // the first the moment either changed — and the two would then disagree
  // about the same charge on the same quote, one screen apart.
  for (const f of [PROJ, WORKSPACE]) {
    assert.match(
      codeOnly(read(f)),
      /chooseQualifier\(/,
      `${f} must use the shared grammar`,
    );
  }
  // And no surface may keep a private copy of the rule.
  for (const f of [PROJ, WORKSPACE]) {
    assert.ok(
      !/labelUnique|ownerUnique|pairUnique/.test(codeOnly(read(f))),
      `${f} must not reimplement the choice`,
    );
  }
});

test("the shared grammar behaves, on the document's own hard case", () => {
  // Two charges of one type on ONE component, one labelled and one not — the
  // production shape. Exercised directly rather than only through a surface.
  const sibs = [
    { instanceId: "a", ownLabel: null, ownerName: "Genexa - Box" },
    { instanceId: "b", ownLabel: "Back panel", ownerName: "Genexa - Box" },
  ];
  assert.equal(chooseQualifier(sibs, "a"), null);
  assert.equal(chooseQualifier(sibs, "b"), "Back panel");
  // And a lone charge is never qualified.
  assert.equal(chooseQualifier([sibs[0]], "a"), null);
});

// ══════════════════════════════════════════════════════════════════════
// The legacy path is untouched
// ══════════════════════════════════════════════════════════════════════

test("column-shaped OTC keeps its own construction", () => {
  const s = codeOnly(read(PROJ));
  // Still there, still column-driven, still keyed the way it was — the new
  // path is additive and this is what proves it.
  assert.match(s, /for \(const \[assemblyId, byTier\] of prodByAssemblyTier\)/);
  assert.match(s, /key: `otc:\$\{assemblyId\}:\$\{fee\.field\}`/);
});

// ══════════════════════════════════════════════════════════════════════
// The gate that carries the invariant
// ══════════════════════════════════════════════════════════════════════

test("the invariant gate asserts TWO CONTRACTS, not one rule with exceptions", () => {
  // ── WHY AN EXCLUSION WAS NOT ENOUGH ────────────────────────────────────
  //
  // A manual sell override IS the final all-in customer unit price
  // (disposition 2026-08-28), so on such a tier `included total === separate
  // total` is not merely inapplicable — it is FALSE BY INSTRUCTION, because
  // the operator has stated a different total. Excluding those tiers left a
  // gap in the evidence; asserting their own contract is evidence.
  const gate = read(GATE);
  assert.match(gate, /TWO PRICING AUTHORITIES, TWO CONTRACTS/);
  assert.match(gate, /FALSE BY INSTRUCTION/);

  // The manual all-in contract, asserted point by point.
  for (const claim of [
    "quotes the operator's number EXACTLY",
    "the engine declines to say what is embedded",
    "an included charge emits NO separate line",
    "the freeze keeps identity, treatment and COST",
    "the freeze asserts NO recovery precision",
    "the condition is RECORDED, not inferred",
  ]) {
    assert.ok(gate.includes(claim), `the override contract must assert: ${claim}`);
  }

  // And a computed tier must be UNTOUCHED by the narrowing — conditional on
  // pricing authority, not applied everywhere.
  assert.match(gate, /CONTROL · on COMPUTED tiers the freeze still states the recovery/);

  // It asks the right id space: the override table keys on the JUNCTION id.
  assert.match(gate, /join assembly_leaves al on al\.id = o\.assembly_leaf_id/);
});

test("the freeze declines precision ONLY where the price is a manual all-in", () => {
  const f = read("src/lib/commercial-recovery/frozen-instruction.ts");
  // Narrowed to the amortized-into-unit-price case. A separately billed charge
  // is its own amount and is unaffected by what the unit price does; an
  // absorbed one recovers nothing BY DECISION, which is a fact, not an unknown.
  assert.match(f, /const unmeasurable = manualAllInSell && c\.placement === "unit_price"/);
  assert.match(f, /governedRecovery: unmeasurable \? null : c\.recoverableSell/);
  assert.match(f, /amortizedPerUnit: unmeasurable \? null : \(c\.amortization\?\.perUnit \?\? null\)/);
  // Identity, treatment and cost SURVIVE — the treatment is still what the
  // operator elected, and silently rewriting it to `absorbed` would record a
  // margin decision nobody made.
  assert.match(f, /treatment: c\.placement as Exclude<ChargePlacement, "unplaced">/);
  assert.match(f, /cost: c\.cost,/);
  // NOT inferred from the ask. An ask is what the operator WANTED to recover.
  assert.match(f, /NOT INFERRED FROM THE ASK/);
});

test("the two NULLs are told apart in the record itself", () => {
  // `governed_recovery IS NULL` means two different things, and an accountant
  // acting on one would act differently on the other. Stored, not inferred.
  const schema = read("src/db/schema.ts");
  assert.match(schema, /manualAllInSell: boolean\("manual_all_in_sell"\)\.notNull\(\)\.default\(false\)/);
  const migration = read("drizzle/0112_od_032_manual_all_in_sell_provenance.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "manual_all_in_sell"/);
  // ADDITIVE — safe before the code that reads it, per the deployment-order
  // rule. No tightening, no drop.
  assert.doesNotMatch(migration, /SET NOT NULL|DROP |ALTER COLUMN/);
});

test("the surface says it, visibly, and does not call it absorbed", () => {
  const card = read("src/components/quote/card-commercial-recovery.tsx");
  assert.match(
    card,
    /included in your manual all-in price — embedded recovery cannot be measured separately/,
  );
  // In the row's own policy line, not behind a hover.
  assert.ok(
    !/title=\{[^}]*manual all-in/.test(card),
    "the condition must not be hover-only",
  );
  // `absorbed` is a governed treatment of its own; the word here would describe
  // one decision with another one's name.
  const at = card.indexOf("manual all-in price");
  assert.ok(!/absorb/i.test(card.slice(at - 200, at + 300)), "an override does not absorb a charge");
});

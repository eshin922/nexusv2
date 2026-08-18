/**
 * Allocation authoring must not depend on a persisted row existing.
 *
 * ── THE DEFECT, IN TWO LAYERS ─────────────────────────────────────────────
 *
 * Observed on `ZZ-VALIDATION-drag-drop`: the quote has one Item Group, and the
 * quote-wide allocation control read "→ no assemblies on this quote" and was
 * disabled. The quote had 1 assembly and 0 `assembly_production_inputs` rows.
 *
 * **READ.** `policyByAssembly` was populated only where a row existed, so an
 * unpersisted quote produced an EMPTY map — and `aggregateAllocation` reads
 * empty as `none`, which the control renders as "no assemblies" and disables.
 * A quote's structure comes from its Item Groups; a policy row is optional
 * persisted state and cannot decide whether an Item Group exists.
 *
 * **WRITE.** `updateAssemblyProductionPolicy` returned a no-op when no row
 * existed — echoing the caller's own requested values back with `ok: true`,
 * writing nothing, logging no audit. The UI had every reason to believe it had
 * saved. Its comment said "the UI re-fires the action when the user touches
 * the cell", making allocation authoring depend on first entering a production
 * COST: a dependency the operator has no way to discover.
 *
 * Both layers had to move together. Fixing the read alone would have enabled a
 * control whose every click silently did nothing — trading a visible wrong
 * state for an invisible one.
 *
 * ── THE DEFAULT ───────────────────────────────────────────────────────────
 *
 * Not a judgement call. Three places already answered it and agree: the schema
 * defaults, the no-op's own comment, and the per-cell INSERT branch's fallback
 * when an assembly has no sibling row. `DEFAULT_ASSEMBLY_POLICY` states it
 * once so the READ shows the value the WRITE will persist — otherwise the
 * control reports one thing and saves another.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  aggregateAllocation,
  DEFAULT_ASSEMBLY_POLICY,
} from "../../src/lib/production-policy.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** Comments stripped — this suite explains the defect by naming the old code. */
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const DRILL = "components/costs/production-drilldown.tsx";
const ACTION = "app/actions/assembly-production-inputs.ts";

// ── the governed default ──────────────────────────────────────────────────

test("the default is allocate ON, raws OFF", () => {
  assert.equal(DEFAULT_ASSEMBLY_POLICY.allocateServiceFeesToCost, true);
  assert.equal(DEFAULT_ASSEMBLY_POLICY.customerShipsRaws, false);
});

test("an unpersisted Item Group reads as the default, not as absent", () => {
  // The aggregate over one unpersisted assembly must be a real state.
  assert.equal(aggregateAllocation([DEFAULT_ASSEMBLY_POLICY]), "on");
  assert.notEqual(aggregateAllocation([DEFAULT_ASSEMBLY_POLICY]), "none");
});

test("`none` still means zero Item Groups, and only that", () => {
  assert.equal(aggregateAllocation([]), "none");
});

test("a persisted divergence still reads mixed against an unpersisted sibling", () => {
  // The case the read fix must not flatten: one assembly saved OFF, another
  // never touched. That is genuinely mixed, and reporting it as uniform would
  // be the misrepresentation the aggregate exists to prevent.
  assert.equal(
    aggregateAllocation([
      { allocateServiceFeesToCost: false },
      DEFAULT_ASSEMBLY_POLICY,
    ]),
    "mixed",
  );
});

// ── READ ──────────────────────────────────────────────────────────────────

test("every Item Group contributes to the aggregate, persisted or not", async () => {
  const src = await code(DRILL);
  assert.match(
    src,
    /for \(const asm of assemblies\)[\s\S]{0,260}?policyBySku\.get\(asm\.id\) \?\? \{ \.\.\.DEFAULT_ASSEMBLY_POLICY/,
  );
  // The conditional insert is what produced the empty map.
  assert.doesNotMatch(src, /const p = policyBySku\.get\(asm\.id\);\s*if \(p\)/);
});

// ── WRITE ─────────────────────────────────────────────────────────────────

test("a first policy write CREATES the rows the policy lives on", async () => {
  // The column lives on (assembly, tier) rows, so a per-assembly policy means
  // one row per tier. Costs stay null — this creates the place the policy
  // lives, not any economics.
  const src = await code(ACTION);
  const branch = src.slice(src.indexOf("if (beforeRows.length === 0) {"));
  const until = branch.slice(0, branch.indexOf("const before = beforeRows[0];"));
  assert.match(until, /\.select\(\{ id: quoteTiers\.id \}\)/);
  assert.match(until, /db\.insert\(assemblyProductionInputs\)\.values\(/);
  assert.match(until, /quoteTierRows\.map\(\(t\) => \(\{/);
  assert.match(until, /tierId: t\.id/);
  // No cost field is written by a policy change.
  for (const cost of [/fillingBlendingCost/, /setupFeeTotal/, /bulkRawCost/]) {
    assert.doesNotMatch(until, cost, `policy write touched a cost field: ${cost}`);
  }
});

test("the write is audited and revalidates — the no-op did neither", async () => {
  const src = await code(ACTION);
  const branch = src.slice(src.indexOf("if (beforeRows.length === 0) {"));
  const until = branch.slice(0, branch.indexOf("const before = beforeRows[0];"));
  assert.match(until, /action: "assembly_production_policy_updated"/);
  assert.match(until, /from: DEFAULT_ASSEMBLY_POLICY\.allocateServiceFeesToCost/);
  assert.match(until, /revalidateQuoteTree\(quote\.projectId, quote\.id\)/);
});

test("no tiers refuses loudly rather than silently succeeding", async () => {
  // The specific failure being replaced was a success report over a write that
  // never happened. The remaining unwritable case must not repeat it.
  const src = await code(ACTION);
  const branch = src.slice(src.indexOf("if (beforeRows.length === 0) {"));
  const until = branch.slice(0, branch.indexOf("const before = beforeRows[0];"));
  assert.match(until, /quoteTierRows\.length === 0/);
  assert.match(until, /throw new ActionGuardError\(\s*ERR\.VALIDATION/);
});

test("the silent no-op is gone", async () => {
  const src = await code(ACTION);
  const branch = src.slice(src.indexOf("if (beforeRows.length === 0) {"));
  const until = branch.slice(0, branch.indexOf("const before = beforeRows[0];"));
  // It returned the caller's own values with ok:true and no db call at all.
  assert.ok(
    /db\.insert|ActionGuardError/.test(until),
    "the empty-row branch performs no write and no refusal",
  );
});

// ── what must not have changed ────────────────────────────────────────────

test("the raws fan-out still carries each assembly's OWN allocation", async () => {
  // The anti-flatten guard. Untouched by this repair, asserted because the
  // repair edits the same policy path.
  const src = await code(DRILL);
  assert.match(
    src,
    /policyByAssembly\.get\(asm\.id\)\?\.allocateServiceFeesToCost/,
  );
});

test("the existing-row path is untouched", async () => {
  // Field-scoped diff, single UPDATE across the assembly's tier rows.
  const src = await code(ACTION);
  assert.match(src, /\.update\(assemblyProductionInputs\)/);
  assert.match(
    src,
    /\.where\(eq\(assemblyProductionInputs\.assemblyId, assemblyId\)\)/,
  );
});

test("the per-cell INSERT branch still inherits from siblings", async () => {
  // Slice 11 matrix Fix 1a. A policy write now creates rows for every tier at
  // once, so that inheritance matters less — but removing it would let a later
  // per-cell insert resurrect a conflicting policy.
  const src = await code(ACTION);
  assert.match(src, /const siblingRows = await db/);
  assert.match(src, /const inheritedPolicy =/);
});

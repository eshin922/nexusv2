/**
 * The quote-level allocation control is a bulk writer over a per-assembly value.
 *
 * ── WHY THIS NEEDS ITS OWN TESTS ──────────────────────────────────────────
 *
 * `allocate_service_fees_to_cost` is per-assembly. A quote-level control over it
 * existed before, broadcast to every assembly, and was removed on 2026-08-11
 * because it made A=ON / B=OFF unreachable for operators while the schema, the
 * costing adapter and the customer-view resolver all modelled it.
 *
 * It is back by explicit operator disposition — paired with Customer ships raws
 * at the section head — so the two properties that made the old one a DEFECT
 * rather than an affordance have to be asserted, not assumed:
 *
 *   1. The aggregate is read honestly. The old control displayed the FIRST
 *      LEAF's value as though it were the quote's. A divergent quote must read
 *      `mixed` and must never render as a uniform value.
 *   2. Flattening is opt-in and reversible. The per-assembly control stays on
 *      the assembly it governs, so divergence is re-expressible immediately.
 *
 * And the anti-flatten guard on the SIBLING control must survive: toggling
 * Customer ships raws rewrites the whole policy row per assembly, so it has to
 * carry each assembly's own allocation value or it silently flattens the very
 * divergence this control exists to make settable.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  aggregateAllocation,
  describeAllocation,
  resolveBulkAllocation,
} from "../../src/lib/production-policy.ts";

const on = { allocateServiceFeesToCost: true };
const off = { allocateServiceFeesToCost: false };

// ── the aggregate ─────────────────────────────────────────────────────────

test("a uniform quote reads as that value", () => {
  assert.equal(aggregateAllocation([on, on, on]), "on");
  assert.equal(aggregateAllocation([off, off]), "off");
});

test("a single divergent product makes the whole quote mixed", () => {
  // The defect this replaces: five ON and one OFF displayed as ON, because the
  // control read one leaf's row. One dissenter is enough.
  assert.equal(aggregateAllocation([on, on, on, on, on, off]), "mixed");
  assert.equal(aggregateAllocation([off, off, off, off, off, on]), "mixed");
});

test("mixed is never reachable from a single product", () => {
  assert.equal(aggregateAllocation([on]), "on");
  assert.equal(aggregateAllocation([off]), "off");
});

test("no assemblies reads as none, not as the schema default", () => {
  // Answering `on` would put a live-looking control over nothing to govern.
  assert.equal(aggregateAllocation([]), "none");
  assert.notEqual(aggregateAllocation([]), "on");
});

// ── what a click resolves to ──────────────────────────────────────────────

test("a uniform state inverts", () => {
  assert.equal(resolveBulkAllocation("on"), false);
  assert.equal(resolveBulkAllocation("off"), true);
});

test("mixed resolves UP rather than toggling", () => {
  // There is no prior uniform state to invert. ON is the schema default and the
  // treatment the section header describes, so it is the less surprising of the
  // two — but the point of asserting it is that it is a DECISION, and a future
  // change to it should have to come here and say so.
  assert.equal(resolveBulkAllocation("mixed"), true);
});

test("none resolves to nothing at all", () => {
  // Not `false`. A bulk write with no targets should be unreachable, not a
  // no-op that looks like it did something.
  assert.equal(resolveBulkAllocation("none"), null);
});

test("every aggregate state has wording, and mixed does not borrow either side's", () => {
  const words = new Set(
    (["on", "off", "mixed", "none"] as const).map(describeAllocation),
  );
  assert.equal(words.size, 4, "two states share a description");
  assert.notEqual(describeAllocation("mixed"), describeAllocation("on"));
  assert.notEqual(describeAllocation("mixed"), describeAllocation("off"));
});

// ── the wiring ────────────────────────────────────────────────────────────

const DRILLDOWN = fileURLToPath(
  new URL("../../src/components/costs/production-drilldown.tsx", import.meta.url),
);

/** Source with comments stripped — this file explains the defect it prevents. */
async function code(): Promise<string> {
  const raw = await readFile(DRILLDOWN, "utf8");
  return raw
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** One function body, sliced from its declaration to the next top-level one. */
function fn(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  assert.notEqual(i, -1, `${name} not found`);
  const rest = src.slice(i);
  const end = rest.indexOf("\nfunction ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the quote-level control reads the aggregate, never one product's row", async () => {
  const body = fn(await code(), "SectionToggles");
  assert.match(body, /allocation === "mixed"/, "mixed is not rendered distinctly");

  // Scoped to the RENDER. `policy` is the first leaf's persisted row, and
  // displaying its allocation as the quote's is the defect that got the old
  // control removed. The write path may still fall back to it when an assembly
  // has no persisted row of its own — that is a default for a value being
  // created, not a claim about the quote, and narrowing to the render is what
  // tells the two apart. An instrument that cannot is worse than none: it
  // fails on correct code and gets relaxed until it fails on nothing.
  const render = body.slice(body.indexOf("\n  return ("));
  assert.notEqual(render, "", "the render could not be located");
  assert.doesNotMatch(
    render,
    /policy\.allocateServiceFeesToCost/,
    "the section control displays one product's allocation as the quote's",
  );
});

test("the raws fan-out still carries each assembly's OWN allocation", async () => {
  // The anti-flatten guard on the sibling control. `updateAssemblyProductionPolicy`
  // rewrites the whole row, so a raws toggle that sent the section's allocation
  // would flatten A=ON / B=OFF as a side effect of an unrelated decision.
  const body = fn(await code(), "SectionToggles");
  assert.match(
    body,
    /policyByAssembly\.get\(asm\.id\)\?\.allocateServiceFeesToCost/,
    "the raws fan-out no longer preserves per-assembly allocation",
  );
});

test("the bulk allocation write carries each assembly's OWN raws and notes", async () => {
  // Mirror image of the above, one field over.
  const body = fn(await code(), "SectionToggles");
  const bulk = body.slice(body.indexOf("function bulkSetAllocation"));
  assert.match(bulk, /own\?\.customerShipsRaws/);
  assert.match(bulk, /own\?\.notes/);
});

test("the two controls hold separate pending state", async () => {
  // Pattern 47(f): a control may be disabled only by the action IT initiates.
  // One shared transition would make an in-flight raws write disable allocation
  // with nothing on screen explaining it.
  const body = fn(await code(), "SectionToggles");
  assert.match(body, /const \[rawsPending, startRaws\] = useTransition\(\)/);
  assert.match(body, /const \[allocPending, startAlloc\] = useTransition\(\)/);
  assert.doesNotMatch(
    body,
    /disabled=\{disabled \|\| rawsPending \|\| noAssemblies\}/,
    "the allocation control is gated by the raws transition",
  );
});

test("the disabled state says why", async () => {
  // Pattern 47(f): a greyed control with no explanation is not acceptable
  // operator behaviour. `none` is the only state that disables this control.
  const body = fn(await code(), "SectionToggles");
  assert.match(body, /noAssemblies[\s\S]{0,120}?No assemblies on this quote/);
});

test("there is exactly ONE control bearing this label", async () => {
  // The per-assembly control was removed on 2026-08-17: two controls with the
  // same label, one quote-level and one per-product, read as a duplicate rather
  // than as two scopes. Operator disposition.
  //
  // What this costs is recorded rather than hidden: creating divergence is no
  // longer reachable from the UI. The column stays per-assembly, the section
  // control still writes it per assembly, and existing divergence still reads
  // `mixed` — so `mixed` is a state the operator can leave but not enter.
  const src = await code();
  assert.doesNotMatch(src, /AssemblyAllocationToggle/);
  const labels = src.match(/Allocate service fees to unit cost/g) ?? [];
  assert.equal(labels.length, 1, `${labels.length} controls carry the label`);
});

test("divergent data is still written per assembly, not collapsed", async () => {
  // The reach went; the SCOPE did not. Each assembly still gets its own write,
  // so a pre-existing divergent value is preserved by an unrelated raws toggle
  // and is still visible as `mixed`. If this ever became a single write, the
  // per-assembly column would be dead and the aggregate meaningless.
  const body = fn(await code(), "SectionToggles");
  const bulk = body.slice(body.indexOf("function bulkSetAllocation"));
  assert.match(bulk, /for \(const asm of assemblies\)/);
  assert.match(bulk, /fd\.set\("quoteSkuId", asm\.id\)/);
});

test("the section header states the aggregate, not the first leaf's row", async () => {
  const src = await code();
  assert.match(src, /Service fees: <strong>\{describeAllocation\(allocation\)\}/);
  assert.doesNotMatch(
    src,
    /sectionPolicy\.allocateServiceFeesToCost/,
    "the header claims a quote-wide fact from one product's row",
  );
});

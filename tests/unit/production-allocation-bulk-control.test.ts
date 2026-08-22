/**
 * `Allocate service fees to unit cost` — quote-wide authority, per-assembly storage.
 *
 * ── THE DISPOSITION ───────────────────────────────────────────────────────
 *
 * Business disposition, 2026-08-17: for V1 this is QUOTE-WIDE operator
 * authority. The operator sets it once from the Production section header and
 * it applies across all assemblies. V1 does not need operators to create new
 * divergence, so there is no per-assembly authoring affordance and these tests
 * hold that there is exactly one control bearing the label.
 *
 * ── WHAT THE DISPOSITION DID NOT SETTLE ───────────────────────────────────
 *
 * Storage stays per-assembly. `assembly_production_inputs.allocate_service_fees
 * _to_cost` is keyed by `assembly_id` and divergent rows produce genuinely
 * different money per assembly — proven at the math layer in
 * `assembly-allocation-policy-scope.test.ts`, which is kept for exactly that
 * reason. Normalising the persistence is deferred to the bounded Production/OTC
 * workstream and nothing here presumes its outcome.
 *
 * So two properties have to hold even though authoring is uniform, and they are
 * what most of this file is about:
 *
 *   1. Existing divergence is not MISREPRESENTED. A divergent quote reads
 *      `mixed`, never a uniform value taken from one product's row. Displaying
 *      ON while one assembly is OFF would state something false about money.
 *   2. Existing divergence is not DESTROYED by an unrelated write. Toggling
 *      Customer ships raws rewrites the whole policy row per assembly, so it
 *      has to carry each assembly's own allocation value — and the allocation
 *      write has to carry each assembly's own raws and notes.
 *
 * Flattening via the allocation control itself is not a violation of (2): under
 * quote-wide authority that IS the operator setting the quote's policy, and the
 * control says `mixed` before the click rather than after it.
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
  // Property 1. Five ON and one OFF must not display as ON — that is a false
  // statement about money, since the sixth assembly really does cost
  // differently. One dissenter is enough.
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
  // change to it should have to come here and say so. This is also the only
  // exit from `mixed` under V1 authority.
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

// ── the controls are gone; the READING is not ────────────────────────────
//
// Six tests stood here guarding the two Production toggles: aggregate display,
// the raws fan-out's anti-flatten carry, per-control pending state, the
// disabled explanation, and label uniqueness. Every one of them asserted a
// control that no longer exists.
//
// They are replaced by the contract that actually matters now — the surface no
// longer WRITES either field, and still READS allocation to place one-time
// fees. Deleting them outright would have left the removal with no contract at
// all, which is how a control quietly comes back.

test("the Production surface writes neither policy field", async () => {
  const src = await code();
  // The acceptance condition for retiring `customer_ships_raws`: no active path
  // writes it. Asserted on the surface that used to be its only writer.
  assert.doesNotMatch(src, /customerShipsRaws/, "the retired raws flag is back");
  assert.doesNotMatch(
    src,
    /fd\.set\("allocateServiceFeesToCost"/,
    "the Production surface writes allocation again",
  );
  assert.doesNotMatch(src, /function bulkSetAllocation/);
  assert.doesNotMatch(src, /function flipToggle/);
});

test("neither control's label appears on the Production surface", async () => {
  const src = await code();
  for (const label of [
    "Customer ships raws",
    "Allocate service fees to unit cost",
  ]) {
    const hits = (src.match(new RegExp(label, "g")) ?? []).filter(Boolean);
    // Comments may explain WHY a control was removed; a rendered label may not
    // reappear. Counted against JSX text rather than the whole file.
    const rendered = (src.match(new RegExp(`<div className="lab">${label}`, "g")) ?? []).length;
    assert.equal(rendered, 0, `${label} is rendered again (${hits.length} textual mentions)`);
  }
});

test("allocation is still READ to place one-time fees", async () => {
  // "Remove the control, keep the behaviour." The value still decides whether a
  // one-time fee allocates into unit cost or invoices separately, and that
  // reading must survive the control's removal.
  const src = await code();
  assert.match(src, /line\.kind === "one_time_fee" && policy\.allocateServiceFeesToCost/);
  assert.match(src, /line\.kind === "one_time_fee" && !policy\.allocateServiceFeesToCost/);
});

test("storage stays per assembly — the invariant outlived its control", async () => {
  // Was asserted against `bulkSetAllocation`'s per-assembly loop. That handler
  // went with its control, but THE INVARIANT DID NOT: allocation is still
  // stored per assembly, so a pre-existing divergent value survives and still
  // reads `mixed`. Collapsing to one row would make the column dead and the
  // aggregate a lie — a Production/OTC decision, not a tidy-up.
  //
  // Re-anchored on the action, which is where the write actually lives now.
  const action = await readFile(
    fileURLToPath(new URL("../../src/app/actions/assembly-production-inputs.ts", import.meta.url)),
    "utf8",
  );
  assert.match(action, /eq\(assemblyProductionInputs\.assemblyId, assemblyId\)/);
  assert.doesNotMatch(
    action,
    /customerShipsRaws/,
    "the action still writes the retired raws flag",
  );
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

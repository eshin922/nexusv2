/**
 * The specification schema governs the operator control.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `spec-panel` chose its control by FIELD KEY alone — keys containing
 * `additional` / `description` / `packout` got a textarea, everything else a
 * hard-coded `<input type="text">`. `field.type` was never read.
 *
 * `tp_units_per_case` is declared `"type": "number"` and is the only typed
 * numeric field in any live schema. It rendered as a generic text box, and
 * nothing failed: a schema author could mark a field `number` and silently get
 * text. The field's NAME was governing the control the SCHEMA is supposed to.
 *
 * ── WHY A COINCIDENCE IS NOT A PASS ─────────────────────────────────────
 *
 * `tp_description` rendered as a textarea under the old code too — because its
 * key contains "description", not because the schema says `"type": "textarea"`.
 * Right control, wrong reason, and it holds only until a schema names a
 * long-form field something else. So the cases below deliberately separate the
 * two: a textarea whose key contains NO heuristic word, and a text field whose
 * key DOES contain one. Under the old renderer the first rendered text and the
 * second rendered a textarea — both backwards.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { resolveFieldControl } from "../../src/lib/spec-field-control.ts";
import type { LeafSpecField } from "../../src/lib/leaf-spec-loader.ts";

const f = (x: Partial<LeafSpecField> & { key: string }) =>
  ({ label: "L", ...x }) as LeafSpecField;

// ══════════════════════════════════════════════════════════════════════
// The schema wins
// ══════════════════════════════════════════════════════════════════════

test("number renders a number input — the live TP case", () => {
  // The whole reason this repair exists. `tp_units_per_case` carries no
  // heuristic word, so the old code fell through to `type="text"`.
  assert.equal(resolveFieldControl(f({ key: "tp_units_per_case", type: "number" })), "number");
});

test("textarea renders a textarea BECAUSE the schema says so", () => {
  // `tp_description` happens to satisfy the heuristic as well. This asserts the
  // schema path, and the next test removes the coincidence entirely.
  assert.equal(resolveFieldControl(f({ key: "tp_description", type: "textarea" })), "textarea");
});

test("an explicit textarea whose key has NO heuristic word still renders textarea", () => {
  // Under the key heuristic this was a text input. Nothing about the name
  // suggests long-form; only the schema does.
  assert.equal(resolveFieldControl(f({ key: "tp_flute", type: "textarea" })), "textarea");
});

test("an explicit text field whose key DOES contain a heuristic word stays text", () => {
  // The inverse, and the sharper half: schema beats heuristic in BOTH
  // directions. The old code rendered this a textarea on the strength of its
  // name alone.
  assert.equal(resolveFieldControl(f({ key: "pp_description", type: "text" })), "text");
});

// ══════════════════════════════════════════════════════════════════════
// Untyped fields are untouched
// ══════════════════════════════════════════════════════════════════════

test("untyped PP/SP fields keep their existing rendering exactly", () => {
  // Every live PP and SP field is untyped, so the heuristic still decides all
  // of them. This repair must not move a single one.
  for (const key of ["pp_description", "pp_additional_details", "pp_packout_details", "sp_description", "sp_additional_details", "sp_packout_details"]) {
    assert.equal(resolveFieldControl(f({ key })), "textarea", key);
  }
  for (const key of ["pp_component_type", "pp_quantities", "pp_size", "pp_material", "pp_deco", "pp_factory_1", "pp_factory_2", "sp_material", "sp_size", "sp_color", "sp_coating", "sp_finishing", "sp_quantities", "sp_factory_1", "sp_factory_2"]) {
    assert.equal(resolveFieldControl(f({ key })), "text", key);
  }
});

test("select is named rather than silently absorbed", () => {
  // Declared in the type union, used by no live schema. It gets a text input
  // deliberately and visibly — not by falling through a default that would
  // hide the gap.
  const src = readFileSync("src/lib/spec-field-control.ts", "utf8");
  assert.match(src, /field\.type === "select"/);
  assert.equal(
    resolveFieldControl({ key: "x", label: "L", type: "select", options: ["a"] }),
    "text",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The renderer consumes the decision rather than re-deriving it
// ══════════════════════════════════════════════════════════════════════

test("the cell renders from resolveFieldControl and hard-codes no input type", () => {
  // A second copy of the precedence inside the component is how the two drift.
  const src = readFileSync("src/components/spec-entry/spec-panel.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /const control = resolveFieldControl\(field\)/);
  assert.match(src, /type=\{control\}/);
  assert.doesNotMatch(src, /type="text"/, "the input type is hard-coded again");
  // The heuristic must exist in exactly ONE place — the resolver — so the two
  // cannot drift into disagreeing about the same field.
  assert.equal((src.match(/includes\("description"\)/g) ?? []).length, 0, 'the component re-derives the heuristic');
  const resolver = readFileSync('src/lib/spec-field-control.ts', 'utf8');
  assert.equal((resolver.match(/includes\("description"\)/g) ?? []).length, 1);
});

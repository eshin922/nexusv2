import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ============================================================================
// Freight shipment membership — create-time SKU selection
// ============================================================================
//
// Business rule: a shipment records WHICH of a product's components travel in
// it. Membership is descriptive only — it never divides the cost (Design
// Authority `1a.jsx`: "Assignment says WHICH SKUs the freight is for. It does
// not divide the cost.").
//
// Before this correction the create action wrote every eligible component
// unconditionally, so every shipment implicitly contained every SKU and split
// shipments could not be modelled at creation. The data model
// (`freight_subcategory_items`) and the edit-time selector already existed;
// only the create seam was missing.

const action = await readFile(
  new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url),
  "utf8",
);
const drilldown = await readFile(
  new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url),
  "utf8",
);
const costing = await readFile(
  new URL("../../src/app/actions/costing.ts", import.meta.url),
  "utf8",
);
const adapter = await readFile(
  new URL("../../src/lib/costing-adapter.ts", import.meta.url),
  "utf8",
);

function actionBody(name: string): string {
  const start = action.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = action.indexOf("\nexport async function ", start + 1);
  return action.slice(start, next === -1 ? action.length : next);
}

test("create writes exactly the selected membership, not every component", () => {
  const body = actionBody("createFreightSubcategory");
  assert.match(
    body,
    /fd\.getAll\("assemblyLeafId"\)/,
    "create must read the operator's selection",
  );
  assert.match(
    body,
    /const memberIds = membershipProvided \? requested : \[\.\.\.eligible\]/,
    "selection wins when provided; all-eligible only as the legacy fallback",
  );
});

test("all components are selected by default, and that is shown explicitly", () => {
  assert.match(
    drilldown,
    /defaultSelected \?\? components\.map\(\(item\) => item\.id\)/,
    "picker falls back to every eligible component when no default is supplied",
  );
  // First shipment for a product defaults to everything; later shipments
  // default to whatever is still unassigned, falling back to everything once
  // coverage is complete so an overlapping shipment does not open empty.
  assert.match(
    drilldown,
    /modalShipments\.length === 0 \|\| modalCoverage\.unassigned\.length === 0\s*\?\s*modalComponents\s*:\s*modalCoverage\.unassigned/,
    "default must follow coverage state",
  );
  // "All selected" must be visible rather than implied — the previous
  // treatment rendered read-only chips, so membership was invisible.
  assert.match(drilldown, /all \{components\.length\} SKUs/);
  assert.match(
    drilldown,
    /aria-pressed=\{selected\.includes\(item\.id\)\}/,
    "each chip must expose its selected state",
  );
});

test("deselecting is possible and posts only the remaining members", () => {
  assert.match(drilldown, /onClick=\{\(\) => toggle\(item\.id\)\}/);
  assert.match(
    drilldown,
    /rows\.includes\(id\) \? rows\.filter\(\(row\) => row !== id\) : \[\.\.\.rows, id\]/,
    "toggle must remove as well as add",
  );
  assert.match(
    drilldown,
    /\{selected\.map\(\(id\) => \(\s*<input key=\{id\} type="hidden" name="assemblyLeafId" value=\{id\} \/>/,
    "only selected ids may be submitted",
  );
});

test("a no-SKU submission is rejected clearly, not silently widened", () => {
  const body = actionBody("createFreightSubcategory");
  // Without the marker an empty selection is indistinguishable from an absent
  // field, so deselecting everything would silently select everything.
  assert.match(body, /membershipProvided/);
  assert.match(
    body,
    /if \(membershipProvided && requested\.length === 0\)/,
    "empty selection must be detected rather than defaulted",
  );
  assert.match(body, /Select at least one component for this shipment\./);
  assert.match(drilldown, /name="membershipProvided" value="1"/);
});

test("membership stays scoped to its own commercial product", () => {
  const body = actionBody("createFreightSubcategory");
  assert.match(
    body,
    /memberIds\.some\(\(memberId\) => !eligible\.has\(memberId\)\)/,
    "create must reject ids outside the product, matching the edit path",
  );
  assert.match(body, /Shipment membership must belong to its commercial product/);
});

test("editing membership after creation still works", () => {
  const body = actionBody("updateFreightSubcategory");
  assert.match(body, /fd\.getAll\("assemblyLeafId"\)/);
  assert.match(body, /delete\(freightSubcategoryItems\)/);
  assert.match(body, /insert\(freightSubcategoryItems\)/);
  // Audit records the full before/after set, so a membership change is
  // reconstructible rather than inferred.
  assert.match(body, /membership: \{ from: beforeMembers\.map\(\(row\) => row\.id\), to: memberIds \}/);
  // The edit-time checkbox fieldset must survive this change.
  assert.match(drilldown, /fr-shipment-contents/);
  assert.match(drilldown, /Edit shipment contents/);
});

test("shipment coverage is surfaced on the Freight page", () => {
  // The operator must be able to see which components are still unassigned
  // without opening each shipment in turn.
  assert.match(drilldown, /function shipmentCoverage\(/);
  assert.match(drilldown, /fr-coverage/);
  assert.match(drilldown, /not yet\s*\n?\s*in any shipment/);
  assert.match(drilldown, /All \{productComponents\.length\} components are in a shipment\./);
  // Component chips carry their own assigned/unassigned state.
  assert.match(drilldown, /Not yet in any shipment/);
});

test("coverage treats overlap as legitimate, not as double-counting", () => {
  // A component may travel in more than one shipment (part ocean, part air),
  // so coverage is "nothing left over" rather than "assignments == count".
  assert.match(
    drilldown,
    /complete: productComponents\.length > 0 && unassigned\.length === 0/,
    "completeness must be defined by the remainder, not by a sum",
  );
});

test("markup states one operator contract: whole percent", () => {
  // The round-trip was already correct and consistent — the action divides by
  // 100 (`Number(raw) / 100`) and the UI multiplies by 100 — but nothing told
  // the operator, and step="0.01" actively implied decimal input. This is a
  // labelling fix; storage stays numeric(5,4) and no action changed.
  const markupInputs = drilldown.match(/type="number"[^>]*whole percent[^>]*>/g) ?? [];
  assert.ok(markupInputs.length >= 2, "freight and customs markup must both declare the contract");
  for (const input of markupInputs) {
    assert.match(input, /step="1"/, "whole-percent fields must step by 1, not 0.01");
    assert.match(input, /placeholder="\d+"/, "a worked example must be shown");
    assert.match(input, /aria-label="[^"]*whole percent/);
  }
});

test("edit forms label every field and report what is unrecorded", () => {
  for (const form of ["ShipmentEdit", "DestinationEdit"]) {
    const start = drilldown.indexOf(`function ${form}(`);
    assert.ok(start >= 0, `${form} not found`);
    const body = drilldown.slice(start, start + 4200);
    // Position must never be the only cue for what a control holds.
    assert.match(body, /className="fr-editform"/, `${form} must use the labelled grid`);
    // Every visible control must be labelled either explicitly (id + <label
    // htmlFor>) or implicitly (wrapped in a <label>). Checkboxes here use the
    // wrapped form, which is valid association; hidden inputs carry no
    // operator meaning.
    assert.ok(
      !/<input(?![^>]*type="hidden")(?![^>]*type="checkbox")(?![^>]*id=)/.test(body),
      `${form} must not render an unlabelled input`,
    );
    // Required vs optional distinguishable, and completion stated rather
    // than inferred from which boxes look empty.
    assert.match(body, /className="req"/, `${form} must mark required fields`);
    assert.match(body, /className="opt"/, `${form} must mark optional fields`);
    assert.match(body, /Not recorded yet:/, `${form} must name what is missing`);
    assert.match(body, /None of these block pricing\./, `${form} must say whether it blocks`);
  }
});

test("write-to-render timing is instrumented end to end", () => {
  // The measured span the fix will target. Client marks bracket the action
  // and the refresh; the server mark isolates revalidation cost.
  for (const mark of ["submit", "action start", "action complete", "refresh start", "browser update"]) {
    assert.ok(drilldown.includes(`since("${mark}")`), `missing client mark: ${mark}`);
  }
  assert.match(drilldown, /requestAnimationFrame\(\(\) => since\("browser update"\)\)/,
    "the final mark must fire after paint, not after the promise resolves");
});

test("freight totals are unaffected by membership — it is descriptive only", () => {
  // Nothing in the costing path may read membership. If this ever fails, a
  // membership edit has become capable of moving a price, which contradicts
  // the Design Authority and would make assignment commercially load-bearing.
  for (const [name, source] of [
    ["costing.ts", costing],
    ["costing-adapter.ts", adapter],
  ] as const) {
    assert.ok(
      !/freightSubcategoryItems|freight_subcategory_items/.test(source),
      `${name} must not consume shipment membership`,
    );
  }
});

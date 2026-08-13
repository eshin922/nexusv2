// OD-001 V1 — the unsupported Pass-through/Bundled operator choice is removed.
//
// Freight has ONE governed customer presentation in V1: bundled into the unit
// price. The customer-view resolver never read `freight_subcategories.treatment`
// (`freightLines` is hardcoded `[]`), so selecting Pass-through changed nothing
// a customer saw. The surface was asking an operator a question and discarding
// the answer.
//
// V1 disposition: remove the choice rather than build a pass-through
// presentation workflow to justify it. Pass-through capability is POST-V1, not
// declined.
//
// What must NOT change: freight arithmetic, freight markup, duty/tariff
// arithmetic, quoted sell, Cost Stack attribution, and the customer
// presentation certified by §2c. And persisted values must survive — this
// removes an affordance, it does not migrate data.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const freightUi = read("../../src/components/costs/freight-drilldown.tsx");
const resolver = read("../../src/lib/customer-view-resolver.ts");
const freightAction = read("../../src/app/actions/freight.ts");
const costing = read("../../src/lib/costing.ts");

test("1 · no operator-selectable pass-through remains on the surface", () => {
  // The two controls were a <select> in Create Shipment and one in shipment
  // edit. Neither may offer the option again.
  assert.doesNotMatch(freightUi, /<option value="pass_through">/);
  assert.doesNotMatch(freightUi, /name="treatment"[^>]*>\s*<option/);
});

test("2 · new shipments record the behaviour V1 actually performs", () => {
  assert.match(
    freightUi,
    /<input type="hidden" name="treatment" value="bundled"\/>/,
    "Create Shipment records bundled"
  );
});

test("3 · editing a shipment cannot rewrite its persisted treatment", () => {
  // The edit form echoes the shipment's OWN value. A legacy `pass_through` row
  // keeps `pass_through` through any number of unrelated edits. Sending a
  // literal "bundled" here would have been a silent data migration.
  assert.match(
    freightUi,
    /<input type="hidden" name="treatment" value=\{shipment\.treatment\}\/>/,
    "edit echoes the persisted value"
  );
  assert.doesNotMatch(
    freightUi,
    /name="treatment" value="bundled"\/>[\s\S]*se-treatment/,
    "the edit path must not hardcode bundled"
  );
});

test("4 · the action still accepts both values — no schema or contract change", () => {
  // Persisted pass_through rows must remain writable and readable. Narrowing
  // the action would turn an affordance removal into a data constraint.
  assert.match(freightAction, /"bundled" \| "pass_through"/);
  assert.match(freightAction, /pass_through/);
});

test("5 · treatment reaches neither the customer view nor the math", () => {
  // The reason removal cannot change output: nothing downstream consumes it.
  // If this ever fails, the affordance removal has become a behaviour change
  // and the disposition needs revisiting.
  // The resolver never mentions it at all.
  assert.doesNotMatch(resolver, /treatment/);

  // costing.ts DOES mention it — but only as a type literal on the freight
  // input shapes and as `treatment: leg.treatment`, carried through to the
  // per-leg breakdown. Nothing BRANCHES on it: the landed/container
  // accumulators are computed independently, above that line. Carried is
  // fine; consumed would mean this affordance removal changed economics.
  assert.doesNotMatch(
    costing,
    /(if|\?|===|!==|switch)[^\n]*"pass_through"/,
    "no arithmetic may branch on treatment"
  );
  assert.match(costing, /treatment: leg\.treatment/, "carried, not consumed");
});

test("6 · freight economics untouched", () => {
  // Arithmetic, markup and duty/tariff all still present and unreferenced by
  // this change. Asserted positively so a deletion elsewhere shows up here.
  for (const token of [
    "freightContainerMarkupSumPerUnit",
    "dutyPerUnit",
    "tariffPerUnit",
  ]) {
    assert.ok(costing.includes(token), `${token} still governs freight math`);
  }
});

test("7 · the §2c-certified customer presentation is unchanged", () => {
  // freightLines stays empty and freight copy stays evidence-gated (422cc7e).
  assert.match(resolver, /const freightLines: \[\] = \[\]/);
  const doc = read("../../src/components/pdf/customer-pdf-document.tsx");
  assert.match(doc, /const hasSeparateFreight = freightLines\.length > 0/);
  assert.doesNotMatch(doc, /freightAtCost=\{hasCharges\}/);
});

test("8 · FALSIFICATION — the surface previously offered the choice", () => {
  // Reconstructs what shipped: a required select with both options, on two
  // surfaces. If either returned, test 1 fails; this states what "returned"
  // would look like so the intent is legible rather than implied.
  const priorMarkup =
    '<select name="treatment"><option value="bundled">Bundled · amortised across units</option><option value="pass_through">Pass-through</option></select>';
  assert.match(priorMarkup, /pass_through/, "the prior control offered it");
  assert.doesNotMatch(
    freightUi,
    /pass_through<\/option>|>Pass-through</,
    "the current surface does not"
  );
});

/**
 * Where a component-owned one-time charge posts — the accounting authority.
 *
 * ── THE GAP ─────────────────────────────────────────────────────────────
 *
 * Component charge economics were governed all the way through Send — costed,
 * elected, priced by charge type, frozen as instructions — and then stopped.
 * Every one was refused with `component_destination_ungoverned`, correctly:
 * the economics were governed and the accounting identity was not. O3 was the
 * first order to reach it.
 *
 * ── TWO LAYERS, AND WHY ─────────────────────────────────────────────────
 *
 * Four types name exactly one BV-011 destination, so they are a direct map.
 *
 * `tooling` is not. It is authored as "Tooling & dies" — "cutting die, mould or
 * collar" — and BV-011 governs a die and a mould as DIFFERENT destinations. One
 * map entry books every die as a mould. That is the shape §4.2 already records
 * for the legacy `Tooling / artwork` column, non-elective for the same reason.
 *
 * So a Tooling instance carries its own classification, recorded by an operator
 * and never inferred — not from owner, SKU, component type, label or amount. A
 * bottle's tooling is USUALLY a mould, and "usually" is not an authority: the
 * one case where it is wrong posts to the wrong account with nothing saying so.
 *
 * ── BOTH ARMS ARE FALSIFIED HERE ────────────────────────────────────────
 *
 * `cutting_die` gets full authority coverage now even though O3 exercises only
 * `mould_collar` end to end. An arm that no test and no order reaches is an arm
 * nobody has checked.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  COMPONENT_CHARGE_DESTINATION,
  TOOLING_CLASSIFICATIONS,
  TOOLING_CLASSIFICATION_DESTINATION,
  componentChargeDestination,
} from "../../src/lib/netsuite/component-charge-destination.ts";
import {
  BV011_DESTINATIONS,
  bv011ItemType,
} from "../../src/lib/netsuite/bv011-destinations.ts";
import { COMPONENT_CHARGE_KEYS } from "../../src/lib/commercial-recovery/registry.ts";

const code = (p: string) =>
  readFileSync(p, "utf8")
    .split(String.fromCharCode(13))
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ══════════════════════════════════════════════════════════════════════
// The direct map
// ══════════════════════════════════════════════════════════════════════

test("four charge types resolve directly, and to the governed destination", () => {
  for (const [key, dest] of [
    ["print_plates", "otc_print_plates"],
    ["artwork_plate", "otc_artwork"],
    ["samples", "otc_samples"],
    ["other_service", "otc_other_service"],
  ] as const) {
    assert.deepEqual(componentChargeDestination({ chargeKey: key }), {
      kind: "resolved",
      destination: dest,
    });
  }
});

test("tooling is ABSENT from the direct map — deliberately", () => {
  // Its absence is the design. A tooling entry here would be the defect.
  assert.ok(!("tooling" in COMPONENT_CHARGE_DESTINATION));
});

test("every direct destination exists in the BV-011 catalogue", () => {
  // A destination the catalogue does not hold is a string, not an authority.
  const known = new Set(BV011_DESTINATIONS.map((d) => d.key));
  for (const dest of Object.values(COMPONENT_CHARGE_DESTINATION)) {
    assert.ok(dest && known.has(dest), `${dest} is not a BV-011 destination`);
  }
});

test("the map covers every component charge key except tooling", () => {
  // Derived from the registry, so a NEW component charge type fails this rather
  // than silently arriving with no destination and no test.
  const mapped = new Set(Object.keys(COMPONENT_CHARGE_DESTINATION));
  const unmapped = COMPONENT_CHARGE_KEYS.filter((k) => !mapped.has(k));
  assert.deepEqual(
    unmapped,
    ["tooling"],
    "a component charge type has no destination and no classification path",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Tooling — both arms
// ══════════════════════════════════════════════════════════════════════

test("mould_collar resolves to otc_mould, NOT otc_tooling", () => {
  assert.deepEqual(componentChargeDestination({ chargeKey: "tooling", toolingClassification: "mould_collar" }), {
    kind: "resolved",
    destination: "otc_mould",
  });
});

test("cutting_die resolves to otc_dies", () => {
  // Falsified now, though O3 exercises only the mould arm end to end. An arm no
  // test and no order reaches is an arm nobody has checked.
  assert.deepEqual(componentChargeDestination({ chargeKey: "tooling", toolingClassification: "cutting_die" }), {
    kind: "resolved",
    destination: "otc_dies",
  });
});

test("the two arms are DIFFERENT destinations — the whole reason to classify", () => {
  assert.notEqual(
    TOOLING_CLASSIFICATION_DESTINATION.mould_collar,
    TOOLING_CLASSIFICATION_DESTINATION.cutting_die,
  );
});

test("an unclassified Tooling charge asks for the classification, and resolves nothing", () => {
  for (const c of [undefined, null]) {
    assert.deepEqual(componentChargeDestination({ chargeKey: "tooling", toolingClassification: c }), {
      kind: "needs_classification",
      chargeKey: "tooling",
    });
  }
});

test("NOTHING falls back to otc_tooling", () => {
  // `otc_tooling` is a real destination with a real item (OTC-0005), so a
  // fallback would post cutting dies to it silently — the exact error the
  // classification exists to prevent, reintroduced as a convenience.
  //
  // It is also CONTESTED: BV-011 §1.b records it Inventory while OTC-0005 is
  // NonInvtPart in the sandbox (confirmed 2026-09-06). A new governed path must
  // not be built on that.
  const src = code("src/lib/netsuite/component-charge-destination.ts");
  assert.doesNotMatch(src, /otc_tooling/);
  for (const c of [undefined, null, "", "mould", "MOULD_COLLAR", "die"] as unknown[]) {
    const r = componentChargeDestination({
      chargeKey: "tooling",
      toolingClassification: c as never,
    });
    assert.notEqual(r.kind, "resolved", `"${String(c)}" must not resolve`);
  }
});

test("an unknown charge type is ungoverned, and is NOT the same state", () => {
  // Three outcomes, not two. "An operator can state this" and "nothing governs
  // this" send a person to different places; collapsing them makes a fixable
  // refusal read as a dead end.
  const r = componentChargeDestination({ chargeKey: "some_future_charge" });
  assert.deepEqual(r, { kind: "ungoverned", chargeKey: "some_future_charge" });
});

// ══════════════════════════════════════════════════════════════════════
// otc_mould, the new destination
// ══════════════════════════════════════════════════════════════════════

test("otc_mould is catalogued as non-inventory, checked not assumed", () => {
  // OTC-0006 is NonInvtPart in the sandbox, as are all 65 active OTC-coded
  // items. Recording it "inventory" would repeat the `otc_tooling` conflict on
  // a brand-new key.
  assert.equal(bv011ItemType("otc_mould"), "non_inventory");
  const entry = BV011_DESTINATIONS.find((d) => d.key === "otc_mould");
  assert.ok(entry, "otc_mould must be in the catalogue");
  assert.equal(entry.label, "OTC - Mould / Collar");
});

test("otc_tooling is left exactly as it was", () => {
  // The Inventory-vs-NonInvtPart conflict is a separate accounting finding and
  // this change does not touch it — neither the entry nor its mapping.
  const entry = BV011_DESTINATIONS.find((d) => d.key === "otc_tooling");
  assert.ok(entry);
  assert.equal(entry.itemType, "inventory", "the recorded conflict is preserved, not quietly fixed");
});

// ══════════════════════════════════════════════════════════════════════
// Independence from recovery treatment
// ══════════════════════════════════════════════════════════════════════

test("the destination authority knows nothing about recovery treatment", () => {
  // Two authorities. `included` / `separate` decides whether a separate line
  // EXISTS; this decides what identity it uses when it does. A destination must
  // never be assigned to make an Included charge emit.
  const src = code("src/lib/netsuite/component-charge-destination.ts");
  for (const shape of [/included/, /separate/, /placement/, /treatment/i]) {
    assert.doesNotMatch(src, shape, "the destination map reads a recovery decision");
  }
});

test("classification is never inferred from anything about the component", () => {
  // The one guarantee that cannot be re-derived later: no owner, SKU, component
  // type, label or amount may reach this decision. The signature is the proof —
  // there is nothing to infer FROM.
  const src = code("src/lib/netsuite/component-charge-destination.ts");
  for (const shape of [/sku/i, /ownerRef/, /quoteLeafId/, /amount/, /label/, /productName/]) {
    assert.doesNotMatch(src, shape, "an inference input reached the destination authority");
  }
});

// ══════════════════════════════════════════════════════════════════════
// The closed set
// ══════════════════════════════════════════════════════════════════════

test("exactly two classifications, each with a destination", () => {
  assert.deepEqual([...TOOLING_CLASSIFICATIONS], ["mould_collar", "cutting_die"]);
  for (const c of TOOLING_CLASSIFICATIONS) {
    assert.ok(TOOLING_CLASSIFICATION_DESTINATION[c], `${c} has no destination`);
  }
  assert.equal(Object.keys(TOOLING_CLASSIFICATION_DESTINATION).length, TOOLING_CLASSIFICATIONS.length);
});

test("the DB enum and the code agree", () => {
  // Two lists of the same closed set. They drift silently otherwise, and the
  // column would accept a value nothing can resolve.
  const schema = code("src/db/schema.ts");
  const block = schema.slice(schema.indexOf('pgEnum("tooling_classification"'));
  for (const c of TOOLING_CLASSIFICATIONS) {
    assert.match(block.slice(0, 200), new RegExp(`"${c}"`), `${c} missing from the DB enum`);
  }
});

test("the column is scoped to tooling by CHECK, not by convention", () => {
  // A classification on a Print plates instance would be a fact about nothing,
  // and would read as authority to whoever found it next.
  const sql = readFileSync("drizzle/0120_tooling_accounting_classification.sql", "utf8");
  assert.match(sql, /CHECK \("tooling_classification" IS NULL OR "charge_key" = 'tooling'\)/);
  // Nullable, and no backfill: deriving a classification would be inventing the
  // fact the column exists to record.
  assert.doesNotMatch(sql, /SET NOT NULL/);
  assert.doesNotMatch(sql, /UPDATE /i);
});

// Product Type -> Spec Schema. Step 3 falsifications.
//
// Product Type is HubSpot's authority and is what the operator sees. Spec
// Schema is internal behaviour derived from it. These pin the mapping and the
// three states that must never collapse into each other:
//
//   schema      — specifications apply, here is the field set
//   no_schema   — classified, and specifications legitimately do not apply
//   null        — NO TYPE SET: authoritative classification is missing
//
// The second and third looking alike is the defect this architecture removes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSpecSchema,
  specSchemaMappingIsExhaustive,
  mappedProductTypeValues,
} from "../../src/lib/product-structure/spec-schema-mapping.ts";

/** The production vocabulary as fetched 2026-08-14, after Tertiary was added. */
const VOCABULARY = [
  "Cards, Booklets", "Design", "Filling and Packout Services", "Formulation",
  "Freight", "Labels", "Third Party Logistics", "One Time Charges", "Primary",
  "R&D / Testing", "Raw ingredients", "Secondary",
  "Soft Goods and Accessories", "Finished Goods", "Turnkey",
  "Tertiary Packaging",
];

const schema = (v: string) => {
  const r = resolveSpecSchema(v);
  assert.equal(r?.kind, "schema", `${v} did not resolve to a schema`);
  return (r as { schemaId: string }).schemaId;
};

// ------------------------------------------------ 1-4 · schemas that apply
test("1 · Primary -> Primary Spec Schema", () => {
  assert.equal(schema("Primary"), "primary");
});

test("2 · Secondary -> Secondary Spec Schema", () => {
  assert.equal(schema("Secondary"), "secondary");
});

test("3 · Tertiary Packaging -> Tertiary Spec Schema, via both governed controls", () => {
  // Corrugated Shipper (COR-0001 / 2008073042) and Lemme - Corrugated Mailer
  // (21897636395) both carry this exact authoritative internal value after the
  // production pull. Resolution is on the VALUE, so both controls resolve
  // identically by construction.
  assert.equal(schema("Tertiary Packaging"), "tertiary");
});

test("4 · Labels and Cards, Booklets -> Secondary Spec Schema", () => {
  assert.equal(schema("Labels"), "secondary");
  assert.equal(schema("Cards, Booklets"), "secondary");
});

// ---------------------------------------------------- 5-6 · the three states
test("5 · service and commercial types -> explicit NO_SCHEMA", () => {
  for (const v of [
    "Filling and Packout Services", "One Time Charges", "Freight", "Design",
    "R&D / Testing", "Third Party Logistics", "Turnkey", "Formulation",
    "Soft Goods and Accessories", "Raw ingredients", "Finished Goods",
  ]) {
    assert.equal(resolveSpecSchema(v)?.kind, "no_schema", v);
  }
});

test("6 · missing Product Type is NOT no_schema — it is NO TYPE SET", () => {
  // The distinction the whole architecture rests on: "classified, and specs do
  // not apply" is a finished answer; "no classification" is missing authority.
  for (const absent of [null, undefined, ""]) {
    assert.equal(resolveSpecSchema(absent), null, String(absent));
  }
  assert.notEqual(resolveSpecSchema("Freight"), null);
});

// -------------------------------------------------------- keying and rigour
test("the mapping is keyed by INTERNAL VALUE, never by label", () => {
  // The three divergent pairs are among the largest categories. A label-keyed
  // map would resolve nothing for roughly half the catalogue, silently.
  assert.equal(schema("Primary"), "primary");
  assert.equal(resolveSpecSchema("Primary Packaging")?.kind, "unmapped");
  assert.equal(schema("Secondary"), "secondary");
  assert.equal(resolveSpecSchema("Secondary Packaging")?.kind, "unmapped");
  assert.equal(resolveSpecSchema("Third Party Logistics")?.kind, "no_schema");
  assert.equal(resolveSpecSchema("Logistics")?.kind, "unmapped");
});

test("an unknown authoritative value does NOT silently become no_schema", () => {
  const r = resolveSpecSchema("Some Future Category");
  assert.equal(r?.kind, "unmapped");
  assert.notEqual(r?.kind, "no_schema");
  // Sandbox residue behaves the same way rather than being special-cased.
  assert.equal(resolveSpecSchema("Preliminary")?.kind, "unmapped");
});

test("the mapping is exhaustive over the production vocabulary", () => {
  // The fail-loud, positioned in CI rather than at render time: adding an
  // option in HubSpot breaks the build, where a human sees it, instead of
  // resolving to no_schema on an operator's screen.
  assert.deepEqual(specSchemaMappingIsExhaustive(VOCABULARY), {
    exhaustive: true,
  });
  assert.deepEqual(
    specSchemaMappingIsExhaustive([...VOCABULARY, "Brand New Option"]),
    { exhaustive: false, missing: ["Brand New Option"] },
  );
});

test("the mapping disposes every vocabulary value and nothing else", () => {
  const mapped = [...mappedProductTypeValues()].sort();
  assert.deepEqual(mapped, [...VOCABULARY].sort());
});

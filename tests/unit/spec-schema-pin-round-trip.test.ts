// A pinned spec schema must survive storage unchanged.
//
// ── THE DEFECT THIS PINS ──────────────────────────────────────────────────
//
// `encodePinnedSchema` ended in a bare `return "unmapped"`. It was total over
// the three resolution kinds that existed when it was written, and its comment
// said so — which is precisely why adding a fourth broke it SILENTLY.
// `schema_pending` encoded as `unmapped`, so a quote pinned "a schema is owed
// for this category" and reloaded "nobody has dispositioned this category".
//
// Both are unmapped-ish states that render an empty spec form, so nothing
// looked wrong. The distinction died at the moment it was persisted, which is
// the one moment it was supposed to be preserved.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decodePinnedSchema,
  encodePinnedSchema,
  resolveSpecSchema,
  type SpecSchemaResolution,
} from "../../src/lib/product-structure/spec-schema-mapping.ts";

/** Every resolution the mapping can produce, including the null case. */
const ALL: (SpecSchemaResolution | null)[] = [
  null,
  { kind: "schema", schemaId: "primary" },
  { kind: "schema", schemaId: "secondary" },
  { kind: "schema", schemaId: "tertiary" },
  { kind: "no_schema" },
  { kind: "schema_pending", value: "Raw ingredients" },
  { kind: "unmapped", value: "Some New HubSpot Category" },
];

test("every resolution round-trips through the pin unchanged", () => {
  for (const resolution of ALL) {
    const pin = encodePinnedSchema(resolution);
    const derivedFrom =
      resolution && "value" in resolution ? resolution.value : null;
    const back = decodePinnedSchema(pin, derivedFrom);
    assert.deepEqual(
      back,
      resolution,
      `${JSON.stringify(resolution)} -> "${pin}" -> ${JSON.stringify(back)}`,
    );
  }
});

test("schema_pending does not collapse into unmapped", () => {
  // The exact coercion that shipped. Stated as its own case so a regression
  // names itself rather than appearing as one row of a loop.
  const pending = encodePinnedSchema({
    kind: "schema_pending",
    value: "Raw ingredients",
  });
  assert.equal(pending, "schema_pending");
  assert.notEqual(pending, "unmapped");

  const back = decodePinnedSchema(pending, "Raw ingredients");
  assert.equal(back?.kind, "schema_pending");
  assert.equal(back?.kind === "schema_pending" ? back.value : null, "Raw ingredients");
});

test("the two unmapped-ish states stay distinguishable after storage", () => {
  // They render similarly, which is why collapsing them was invisible. What
  // separates them is whether anyone has decided — and that is exactly what a
  // reader of a stored quote needs.
  const pendingPin = encodePinnedSchema({ kind: "schema_pending", value: "X" });
  const unmappedPin = encodePinnedSchema({ kind: "unmapped", value: "X" });
  assert.notEqual(pendingPin, unmappedPin);
  assert.notEqual(
    decodePinnedSchema(pendingPin, "X")?.kind,
    decodePinnedSchema(unmappedPin, "X")?.kind,
  );
});

test("a real classification round-trips end to end", () => {
  // Through the resolver rather than a hand-built literal, so the test binds
  // to the mapping and not to my idea of it.
  const resolved = resolveSpecSchema("Raw ingredients");
  assert.equal(resolved?.kind, "schema_pending");
  const back = decodePinnedSchema(
    encodePinnedSchema(resolved),
    "Raw ingredients",
  );
  assert.deepEqual(back, resolved);
});

test("the encoder has no fall-through left", () => {
  // The defect was structural, not a missed case: a bare `return` at the foot
  // absorbed anything unrecognised. An exhaustive switch with a `never`
  // binding makes a fifth kind a COMPILE error instead of a silent relabel.
  const src = readFileSync(
    new URL("../../src/lib/product-structure/spec-schema-mapping.ts", import.meta.url),
    "utf8",
  );
  const body = src.slice(
    src.indexOf("export function encodePinnedSchema"),
    src.indexOf("export function decodePinnedSchema"),
  );
  assert.match(body, /const unhandled: never = resolution;/);
  assert.doesNotMatch(body, /\n  return "unmapped";\n\}/);
});

test("the storage constraint admits the value the encoder can now produce", () => {
  // An encoder that can emit a value the CHECK refuses is a write that fails
  // at the database — the distinction would die at the storage boundary
  // instead of in the encoder, which is no better.
  const migration = readFileSync(
    new URL("../../drizzle/0122_spec_schema_pending_pin.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'schema_pending'/);
  for (const kept of ["primary", "secondary", "tertiary", "no_schema", "unmapped", "no_type"]) {
    assert.match(migration, new RegExp(`'${kept}'`), `${kept} must remain allowed`);
  }
});

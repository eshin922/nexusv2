/**
 * The identity boundary between the Freight surface and the Freight action.
 *
 * The falsification is the historical defect itself. Between the OD-017
 * re-key (2026-08-12) and 2026-08-31 the Costs page emitted
 * `assembly_leaves.id` where `createFreightSubcategory` validates
 * `quote_leaves.id`. Both are UUIDs, both typechecked, and every operator
 * attempt to record a shipment was refused for nineteen days — invisibly,
 * because the only freight in the database had been inserted by fixture
 * scripts that bypassed the action entirely.
 *
 * So these tests do not merely assert that the builder returns something
 * plausible. They assert the two id spaces are told apart:
 *
 *     assembly_leaves.id          -> must NOT appear   (the defect)
 *     assembly_leaves.quote_leaf_id -> must appear     (the repair)
 *
 * A future producer that substitutes another UUID-shaped identity fails here
 * rather than in production.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freightSelectableComponents,
  type DirectProductRow,
  type GroupedMemberRow,
} from "../../src/lib/freight-selectable-components.ts";

// Deliberately distinct id spaces. Every junction id starts `aaaa`, every
// canonical id starts `bbbb`, so a substitution is legible in a failure
// message rather than being two indistinguishable UUIDs.
const JUNCTION_BOTTLE = "aaaa1111-0000-4000-8000-000000000001";
const CANONICAL_BOTTLE = "bbbb1111-0000-4000-8000-000000000001";
const JUNCTION_LABEL = "aaaa2222-0000-4000-8000-000000000002";
const CANONICAL_LABEL = "bbbb2222-0000-4000-8000-000000000002";
const ASSEMBLY = "cccc0000-0000-4000-8000-00000000000a";
const CANONICAL_DIRECT = "bbbb3333-0000-4000-8000-000000000003";

const grouped: GroupedMemberRow[] = [
  {
    assembly_leaves: {
      id: JUNCTION_BOTTLE,
      assemblyId: ASSEMBLY,
      quoteLeafId: CANONICAL_BOTTLE,
    },
    leaves: { name: "30ml Bottle", sku: "PP-BOTTLE-30" },
  },
  {
    assembly_leaves: {
      id: JUNCTION_LABEL,
      assemblyId: ASSEMBLY,
      quoteLeafId: CANONICAL_LABEL,
    },
    leaves: { name: "Label Set", sku: "SP-LABEL" },
  },
];

const direct: DirectProductRow[] = [
  {
    quote_leaves: { id: CANONICAL_DIRECT },
    leaves: { name: "Shipper Carton", sku: "TP-SHIPPER" },
  },
];

test("grouped members carry the CANONICAL quote_leaf_id", () => {
  const components = freightSelectableComponents(grouped, []);
  assert.deepEqual(
    components.map((c) => c.quoteLeafId),
    [CANONICAL_BOTTLE, CANONICAL_LABEL],
  );
});

test("the junction id appears NOWHERE in the emitted model", () => {
  // The historical defect, stated as an absence. Scanning every value rather
  // than only `quoteLeafId` means a future field cannot smuggle it through.
  const serialised = JSON.stringify(freightSelectableComponents(grouped, direct));
  assert.equal(
    serialised.includes(JUNCTION_BOTTLE),
    false,
    "assembly_leaves.id leaked into the selectable-component model — this is the 2026-08-12 defect",
  );
  assert.equal(serialised.includes(JUNCTION_LABEL), false);
});

test("substituting the junction id is detectable — the control can fail", () => {
  // A control that cannot express the failure it excludes proves nothing.
  // This is the defective producer, written out, so the assertion above is
  // shown to discriminate rather than to pass vacuously.
  const defective = grouped.map((row) => ({
    quoteLeafId: row.assembly_leaves.id, // <- what shipped
    assemblyId: row.assembly_leaves.assemblyId,
    label: row.leaves.name,
    sku: row.leaves.sku,
  }));
  assert.equal(JSON.stringify(defective).includes(JUNCTION_BOTTLE), true);
  assert.notDeepEqual(
    defective.map((c) => c.quoteLeafId),
    freightSelectableComponents(grouped, []).map((c) => c.quoteLeafId),
  );
});

test("Direct Products are in the same collection, keyed on quote_leaves.id", () => {
  const components = freightSelectableComponents(grouped, direct);
  assert.equal(components.length, 3);
  const shipper = components.find((c) => c.sku === "TP-SHIPPER");
  assert.ok(shipper, "a Direct Product must be selectable, not merely code-reachable");
  assert.equal(shipper.quoteLeafId, CANONICAL_DIRECT);
  assert.equal(
    shipper.assemblyId,
    null,
    "null is how a Direct Product's shipments are keyed; the surface groups by this",
  );
});

test("grouped members keep their assembly, so the surface can group them", () => {
  const components = freightSelectableComponents(grouped, direct);
  assert.deepEqual(
    components.map((c) => c.assemblyId),
    [ASSEMBLY, ASSEMBLY, null],
  );
});

test("an empty quote yields an empty collection, not a fabricated row", () => {
  assert.deepEqual(freightSelectableComponents([], []), []);
});

test("membership comparison is canonical-to-canonical", () => {
  // What Edit Contents does: a persisted membership row carries
  // `quote_leaf_id`, and the checkbox must match on that. Comparing against
  // the junction id was always false, so every real member rendered
  // unchecked.
  const components = freightSelectableComponents(grouped, direct);
  const persisted = [{ quoteLeafId: CANONICAL_LABEL }];
  const checked = components.filter((item) =>
    persisted.some((row) => row.quoteLeafId === item.quoteLeafId),
  );
  assert.deepEqual(checked.map((c) => c.sku), ["SP-LABEL"]);
});

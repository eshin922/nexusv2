/**
 * Stage 3 A · Production ownership XOR.
 *
 * The database enforces the ownership boundary itself — those seven
 * falsifications were run against the real schema inside a rolled-back
 * transaction and are recorded in the PR. What is asserted HERE is the half a
 * constraint cannot express: that the application cannot even ASK for a
 * forbidden write, and that the Direct Service surface is gated on identity
 * rather than on data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DIRECT_SERVICE_IDENTITIES,
  DIRECT_SERVICE_PRODUCTION_INPUT,
  DIRECT_SERVICE_PRODUCTION_LABEL,
  DIRECT_SERVICE_FORBIDDEN_PRODUCTION_COLUMNS,
} from "../../src/lib/product-structure/direct-service.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
async function code(rel: string): Promise<string> {
  const src = await readFile(ROOT + rel, "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const raw = (rel: string) => readFile(ROOT + rel, "utf8");

// ── A.7 · exactly one input per identity ──────────────────────────────────

test("every identity maps to exactly one input, and they are all distinct", () => {
  for (const id of DIRECT_SERVICE_IDENTITIES) {
    assert.ok(DIRECT_SERVICE_PRODUCTION_INPUT[id], `${id} has no production input`);
    assert.ok(DIRECT_SERVICE_PRODUCTION_LABEL[id], `${id} has no label`);
  }
  const columns = DIRECT_SERVICE_IDENTITIES.map(
    (id) => DIRECT_SERVICE_PRODUCTION_INPUT[id],
  );
  // Distinctness is the load-bearing part. Two identities sharing a column
  // would be indistinguishable in the data, and BV-011 maps them to DIFFERENT
  // accounting destinations — the totals would reconcile and the attribution
  // would be wrong.
  assert.equal(new Set(columns).size, columns.length, "two identities share a column");
});

test("the mapping is exactly the dispositioned one", () => {
  assert.deepEqual({ ...DIRECT_SERVICE_PRODUCTION_INPUT }, {
    formulation: "rdTotal",
    filling_blending: "fillingBlendingCost",
    packout_assembly: "cmAssemblyTotal",
    testing_micros: "testingMicrosTotal",
    other_service: "otherServiceTotal",
  });
});

test("no service can reach Bulk Raw, Setup, Tooling or Artwork", () => {
  const reachable = new Set<string>(
    DIRECT_SERVICE_IDENTITIES.map((id) => DIRECT_SERVICE_PRODUCTION_INPUT[id]),
  );
  for (const forbidden of DIRECT_SERVICE_FORBIDDEN_PRODUCTION_COLUMNS) {
    assert.ok(!reachable.has(forbidden), `${forbidden} is reachable from a service`);
  }
});

test("Testing / Micros has its OWN column, not a reuse of Other Service", async () => {
  // The §0.5 catch. Reusing other_service_total would have reconciled exactly
  // and attributed wrongly: BV-011 maps Testing and Other to different
  // accounting destinations, so one column carrying both discards the
  // distinction a Sales Order line needs.
  assert.notEqual(
    DIRECT_SERVICE_PRODUCTION_INPUT.testing_micros,
    DIRECT_SERVICE_PRODUCTION_INPUT.other_service,
  );
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /testingMicrosTotal: numeric\("testing_micros_total"/);
  const mig = await raw("drizzle/0083_testing_micros_production_input.sql");
  assert.match(mig, /ADD COLUMN "testing_micros_total"/);
});

// ── the client cannot name the column ─────────────────────────────────────

test("the writer derives the column from identity — it is never supplied", async () => {
  const action = await code("src/app/actions/direct-service-production.ts");
  assert.match(action, /DIRECT_SERVICE_PRODUCTION_INPUT\[ctx\.serviceIdentity\]/);
  // No `changedField`-style parameter. "A service cannot author Bulk Raw" is
  // not a rule this action enforces; it is a sentence it cannot express.
  assert.doesNotMatch(action, /formData\.get\("changedField"\)/);
  assert.doesNotMatch(action, /formData\.get\("column"\)/);
  assert.doesNotMatch(action, /bulkRawCost/);
});

test("the surface sends a value and no column", async () => {
  const ui = await code("src/components/costs/direct-service-production.tsx");
  assert.match(ui, /fd\.set\("amount", next\)/);
  assert.doesNotMatch(ui, /fd\.set\("column"/);
  assert.doesNotMatch(ui, /fd\.set\("changedField"/);
});

// ── gated on identity, not on data ────────────────────────────────────────

test("the service list is built from classification, not from production rows", async () => {
  // A surface that appeared because a row existed would be #282 undone by the
  // first stray write.
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(page, /eq\(quoteLeaves\.commercialKind, "service"\)/);
  // The leaves come first; amounts are looked up afterwards, so an unpriced
  // service still renders its input.
  const listIdx = page.indexOf("serviceLeafRows");
  const amountIdx = page.indexOf("serviceAmounts");
  assert.ok(listIdx > -1 && listIdx < amountIdx);
});

test("the writer refuses a product leaf with an operator sentence", async () => {
  const action = await code("src/app/actions/direct-service-production.ts");
  assert.match(action, /leaf\.commercialKind !== "service"/);
  assert.match(action, /is a product, not a service/);
  // And refuses a member, even though two other defences already prevent it.
  assert.match(action, /quoteLeaf\.assemblyId !== null/);
});

// ── the surface has no capacity for a second input ────────────────────────

test("the Direct Service surface renders ONE input, structurally", async () => {
  const ui = await code("src/components/costs/direct-service-production.tsx");
  // One label from the map, one cell per tier. No iteration over a column set
  // — a filtered table is a table that currently shows one thing.
  assert.match(ui, /DIRECT_SERVICE_PRODUCTION_LABEL\[svc\.serviceIdentity\]/);
  assert.doesNotMatch(ui, /setupFeeTotal|toolingArtworkTotal|bulkRawCost|rdTotal/);
  assert.doesNotMatch(ui, /PRODUCTION_COLUMNS\.map|columns\.map/);
});

test("the Item Group table never renders a service-owned row", async () => {
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(page, /if \(api\.assemblyId === null\) continue;/);
});

// ── readers survive the relaxation ────────────────────────────────────────

test("the adapter routes each owner branch to the right math leaf", async () => {
  const adapter = await code("src/lib/costing-adapter.ts");
  // A service maps DIRECTLY to its own leaf — no anchor coercion, because
  // there is no per-assembly/per-leaf mismatch to bridge.
  assert.match(adapter, /api\.quoteLeafId/);
  assert.match(adapter, /anchorLeafByAssembly\.get\(api\.assemblyId\)/);
  assert.match(adapter, /assemblyId: string \| null;/);
});

test("the scenario clone covers BOTH owner branches", async () => {
  // `WHERE assembly_id IN (...)` would silently drop every service-owned row,
  // because NULL is never IN a list — the exact defect already documented in
  // that file for the per-leaf cost tables, which committed an incomplete
  // clone with no error to notice.
  const clone = await code("src/app/actions/quotes.ts");
  assert.match(clone, /inArray\(assemblyProductionInputs\.quoteLeafId, sourceDirectLeafIds\)/);
  assert.match(clone, /quoteLeafId: newLeafId/);
});

// ── the database, not only the code ───────────────────────────────────────

test("the migration ships the relaxation and every guard together", async () => {
  // Shipping the relaxation alone would leave a window in which the database
  // accepts Production economics on a folding carton.
  const mig = await raw("drizzle/0082_production_ownership_xor.sql");
  const required: Array<[string, RegExp]> = [
    ["the XOR", /assembly_production_inputs_owner_xor/],
    ["the service-owner FK", /assembly_production_inputs_service_owner_fk/],
    ["the member-is-product FK", /assembly_leaves_member_is_product_fk/],
    ["kind immutability", /leaves_commercial_kind_immutable/],
    ["the kind sync", /quote_leaves_commercial_kind_sync/],
    ["the relaxation", /ALTER COLUMN "assembly_id" DROP NOT NULL/],
  ];
  for (const [what, pattern] of required) {
    assert.match(mig, pattern, `${what} is not in the same migration`);
  }
});

test("owner_commercial_kind is generated, so no writer can set it", async () => {
  const mig = await raw("drizzle/0082_production_ownership_xor.sql");
  assert.match(mig, /"owner_commercial_kind"[\s\S]{0,60}GENERATED ALWAYS AS/);
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /ownerCommercialKind: leafCommercialKind\(/);
  assert.match(schema, /generatedAlwaysAs/);
  // Never appears in an insert anywhere.
  for (const f of [
    "src/app/actions/direct-service-production.ts",
    "src/app/actions/quotes.ts",
    "src/app/actions/assembly-production-inputs.ts",
  ]) {
    assert.doesNotMatch(await code(f), /ownerCommercialKind:/, `${f} writes a generated column`);
  }
});

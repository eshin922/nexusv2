/**
 * Direct Service → NetSuite item mapping (workstream B).
 *
 * Plan: `docs/direct-service-stage-3-implementation-plan.md` §0 and §B.
 *
 * Two things here are worth more than the rest, because both fail SILENTLY:
 *
 *   1. `indeterminate` must never become `gone`. A failed read reports the
 *      same shape as a successful one that found nothing, unless something
 *      keeps them apart — and the wrong answer is a confident one.
 *   2. The §0 block must survive the mapping. It exists because a Direct
 *      Service currently cannot complete BY ACCIDENT, and supplying a mapping
 *      removes that accident.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  FIXED_SERVICE_IDENTITIES,
  isFixedServiceIdentity,
  describeUnusableMapping,
  validateServiceItemMappings,
  type MappingVerdict,
} from "../../src/lib/netsuite/service-item-map-rules.ts";
import { DIRECT_SERVICE_IDENTITIES } from "../../src/lib/product-structure/direct-service.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** A port double. The real one is measured; this one is controlled. */
function port(behaviour: (ids: readonly string[]) => Map<string, MappingVerdict>) {
  return { validateItemInternalIds: async (ids: readonly string[]) => behaviour(ids) };
}

// ── the four, and the one that is deliberately not among them ─────────────

test("exactly the four fixed identities; other_service is excluded", () => {
  assert.deepEqual([...FIXED_SERVICE_IDENTITIES], [
    "formulation",
    "filling_blending",
    "packout_assembly",
    "testing_micros",
  ]);
  assert.equal(isFixedServiceIdentity("other_service"), false);
  // And the four are a strict subset of the governed vocabulary — a fifth
  // identity added to the enum must not silently become firm-mappable.
  for (const id of FIXED_SERVICE_IDENTITIES) {
    assert.ok((DIRECT_SERVICE_IDENTITIES as readonly string[]).includes(id));
  }
});

test("the exclusion is enforced by the SCHEMA, not only by the action", async () => {
  // A convention that only the action layer knows is one INSERT away from
  // being untrue. The CHECK makes a fifth "for symmetry" row unreachable.
  const migration = await readFile(
    fileURLToPath(new URL("../../drizzle/0081_netsuite_service_item_map.sql", import.meta.url)),
    "utf8",
  );
  assert.match(migration, /CHECK \("service_identity" <> 'other_service'\)/);

  const schema = await code("db/schema.ts");
  assert.match(schema, /netsuite_service_item_map_not_other_service/);
});

// ── indeterminate is not absence ──────────────────────────────────────────

test("a failed read yields indeterminate for every id, never gone", async () => {
  // The OD-027 shape. If the port throws or returns nothing for an id, the
  // only honest verdict is "we do not know".
  const verdicts = await validateServiceItemMappings(
    port(() => new Map()),
    [
      { serviceIdentity: "formulation", netsuiteInternalId: "111" },
      { serviceIdentity: "filling_blending", netsuiteInternalId: "222" },
    ],
  );
  for (const id of ["formulation", "filling_blending"] as const) {
    const v = verdicts.get(id);
    assert.equal(v?.state, "indeterminate", `${id} was not indeterminate`);
  }
});

test("gone and indeterminate produce DIFFERENT operator sentences", () => {
  const gone = describeUnusableMapping("formulation", { state: "gone" });
  const unknown = describeUnusableMapping("formulation", {
    state: "indeterminate",
    reason: "socket hang up",
  });
  assert.notEqual(gone, unknown);
  // `gone` asks the admin to act. `indeterminate` must NOT — nothing is known
  // to be wrong, and sending them to re-map would have them change something
  // correct.
  assert.match(gone!, /re-map/i);
  assert.doesNotMatch(unknown!, /re-map/i);
  assert.match(unknown!, /try again/i);
});

test("an unmapped identity is distinguishable from a broken one", () => {
  const unmapped = describeUnusableMapping("testing_micros", undefined);
  assert.match(unmapped!, /no NetSuite item mapping/i);
  assert.notEqual(unmapped, describeUnusableMapping("testing_micros", { state: "gone" }));
});

test("only `usable` returns null — every other state blocks", () => {
  const states: MappingVerdict[] = [
    { state: "gone" },
    { state: "inactive", itemCode: "X" },
    { state: "indeterminate", reason: "r" },
  ];
  assert.equal(describeUnusableMapping("packout_assembly", { state: "usable", itemCode: "X" }), null);
  for (const s of states) {
    assert.ok(describeUnusableMapping("packout_assembly", s), `${s.state} did not block`);
  }
});

test("inactive is reported as inactive, not as missing", async () => {
  // The validation query deliberately does not filter `isinactive`, so
  // deactivation stays distinguishable from deletion — different problems.
  const resolver = await code("lib/netsuite/item-resolver.ts");
  assert.doesNotMatch(
    resolver,
    /WHERE id IN \([^)]*\)[^`]*isinactive='F'/,
    "the id-validation query filters out inactive items",
  );
  assert.match(resolver, /row\.isinactive === "T"/);
});

// ── the boundary ──────────────────────────────────────────────────────────

test("validation goes through the provider port, not a direct import", async () => {
  // OD-023: a boundary one caller can route around is a boundary for the
  // others only. The isolated harness must be able to answer this.
  const map = await code("lib/netsuite/service-item-map-rules.ts");
  assert.doesNotMatch(map, /from "\.\/client"/);
  assert.doesNotMatch(map, /suiteQL/);
  assert.match(map, /netsuite\.validateItemInternalIds\(/);
  // And the rules module imports neither the db nor the NetSuite client, so
  // the distinction below stays reachable from a unit test.
  assert.doesNotMatch(map, /from "@\/db"/);

  const provider = await code("lib/integrations/netsuite-provider.ts");
  assert.match(provider, /validateItemInternalIds\(/);

  // The fake must implement it too — including the failing scenario, or the
  // indeterminate path is untestable in the harness that most needs it.
  const fake = await readFile(
    fileURLToPath(new URL("../harness/providers/fake-netsuite.ts", import.meta.url)),
    "utf8",
  );
  assert.match(fake, /async validateItemInternalIds\(/);
  assert.match(fake, /item-validate-gone/);
});

test("mappings are stored by internal id, and writes never use the code", async () => {
  const migration = await readFile(
    fileURLToPath(new URL("../../drizzle/0081_netsuite_service_item_map.sql", import.meta.url)),
    "utf8",
  );
  assert.match(migration, /"netsuite_internal_id" text NOT NULL/);
  assert.match(migration, /"netsuite_item_code" text NOT NULL/);

  // The validator keys on the internal id. If it ever keyed on the code, a
  // NetSuite rename would silently invalidate every mapping.
  const map = await code("lib/netsuite/service-item-map-rules.ts");
  assert.match(map, /mappings\.map\(\(m\) => m\.netsuiteInternalId\)/);
});

// ── §0 · the block that must survive the mapping ──────────────────────────

test("services are partitioned by classification, never by SKU prefix", async () => {
  const mc = await code("lib/netsuite/mark-complete.ts");
  assert.match(mc, /p\.commercialKind === "service"/);
  // Matching on the SVC- prefix is the failure mode: it would be a string
  // test standing in for a governed classification, and it would misfire on
  // any product an admin happened to name SVC-something.
  assert.doesNotMatch(mc, /SVC-/);
  assert.doesNotMatch(mc, /startsWith\("SVC/);
});

test("a service never enters the SKU-resolution loop", async () => {
  const mc = await code("lib/netsuite/mark-complete.ts");
  // The loop's input is the products-only partition, not the whole
  // directProducts collection.
  assert.match(mc, /\.\.\.directProductsOnly,/);
  assert.doesNotMatch(
    mc,
    /uniqueSkus[\s\S]{0,200}?\.\.\.tree\.directProducts,/,
    "the SKU loop still consumes every top-level row",
  );
});

test("the deliberate projection block exists and is unconditional on mapping", async () => {
  // The whole point of §0: supplying a mapping removes the ACCIDENTAL block,
  // so a deliberate one must remain until projection is certified. If this
  // assertion is ever deleted, it must be by the slice that certifies
  // projection — nothing else has grounds to.
  const mc = await code("lib/netsuite/mark-complete.ts");
  assert.match(
    mc,
    /Direct Service Sales Order projection is not enabled/,
    "the projection block is gone — a mapped service can now push unreviewed",
  );
  // And it is reached AFTER the mapping check, so an operator with a fixable
  // problem is told about that one instead.
  const mappingIdx = mc.indexOf("describeUnusableMapping");
  const blockIdx = mc.indexOf("Direct Service Sales Order projection is not enabled");
  assert.ok(mappingIdx > -1 && blockIdx > mappingIdx, "projection block precedes the mapping check");
});

test("other_service is refused with its own reason, not as a missing mapping", async () => {
  const mc = await code("lib/netsuite/mark-complete.ts");
  // It has no firm mapping BY DESIGN. Reporting it as unmapped would send an
  // admin to Settings to add a row the schema refuses.
  assert.match(mc, /no firm-wide NetSuite item/);
  assert.match(mc, /isFixedServiceIdentity/);
});

// ── the admin surface ─────────────────────────────────────────────────────

test("the Settings page reads stored state only — no NetSuite call on render", async () => {
  // §B.2: the query is cheap, but a render-path network dependency means a
  // NetSuite outage takes out the page as well as the push.
  const page = await code("app/admin/netsuite/page.tsx");
  assert.match(page, /listServiceItemMappings\(\)/);
  assert.doesNotMatch(page, /listServiceItemMappings\(true\)/);

  const action = await code("app/actions/netsuite-service-map.ts");
  assert.match(action, /live = false/);
});

test("both writers are admin-gated", async () => {
  const action = await code("app/actions/netsuite-service-map.ts");
  const gates = action.match(/requireAdminAction\(\)/g) ?? [];
  assert.ok(gates.length >= 3, `only ${gates.length} admin gates`);
});

test("an indeterminate verify updates nothing", async () => {
  // Stamping resolved_at on a failed read converts "we could not check" into
  // "we checked and it was fine" — the exact rewrite the state exists to stop.
  const action = await code("app/actions/netsuite-service-map.ts");
  assert.match(
    action,
    /if \(verdict\.state === "usable"\) \{[\s\S]{0,400}?resolvedAt: new Date\(\)/,
  );
});

test("ambiguity is refused, never first-matched", async () => {
  const action = await code("app/actions/netsuite-service-map.ts");
  assert.match(action, /resolution\.status === "ambiguous"/);
  assert.match(action, /nothing was saved/);
  assert.doesNotMatch(action, /matches\[0\]/);
});

test("the mapping inputs are not disabled while saving", async () => {
  // Pattern 47(e). A disabled input drops focus mid-save.
  const table = await code("app/admin/netsuite/service-item-map-table.tsx");
  assert.doesNotMatch(table, /<input[\s\S]{0,300}?disabled=\{[^}]*[pP]ending/);
  // Pattern 47(f): Verify in flight must not disable the Remap beside it.
  assert.match(table, /savePending/);
  assert.match(table, /verifyPending/);
});

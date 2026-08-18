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
  evaluateDirectServiceGate,
  PROJECTION_NOT_ENABLED,
  requireFixedServiceIdentity,
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

test("the projection block is reachable from mark-complete", async () => {
  // SUPERSEDED as a string search: the message moved into the extracted gate,
  // where "a fully mapped, usable service STILL blocks" now proves it
  // BEHAVIOURALLY rather than by grepping a literal. What remains here is the
  // wiring — that mark-complete actually consults the gate and throws its
  // reason, rather than reaching its own conclusion.
  const mc = await code("lib/netsuite/mark-complete.ts");
  assert.match(mc, /const gate = evaluateDirectServiceGate\(/);
  assert.match(mc, /throw new Error\(gate\.reason\)/);
  const rules = await code("lib/netsuite/service-item-map-rules.ts");
  assert.match(rules, /Direct Service Sales Order projection is not enabled/);
});

test("the gate, not mark-complete, decides how other_service is refused", async () => {
  // Also superseded by behaviour — "other_service on a quote is refused for
  // its OWN reason" exercises the sentence. This only pins that the decision
  // did not get re-implemented at the call site.
  const mc = await code("lib/netsuite/mark-complete.ts");
  assert.doesNotMatch(mc, /no firm-wide NetSuite item/);
  const rules = await code("lib/netsuite/service-item-map-rules.ts");
  assert.match(rules, /no firm-wide NetSuite item/);
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

// ── the section is reachable ──────────────────────────────────────────────

test("nav and index read the SAME section list, so neither can omit a page", async () => {
  // The nav and the index kept separate lists and had already drifted — the
  // nav offered Users and Audit log, the index did not. That drift is what let
  // NetSuite ship reachable from one and invisible in the other: a missing nav
  // entry raises no error and breaks no page, it just produces a section
  // nobody finds.
  const layout = await code("app/admin/layout.tsx");
  const index = await code("app/admin/page.tsx");
  for (const [name, src] of [["layout", layout], ["index", index]] as const) {
    assert.match(src, /ADMIN_SECTIONS/, `${name} does not use the shared list`);
    assert.doesNotMatch(
      src,
      /^const (NAV|SECTIONS)/m,
      `${name} still keeps its own section list`,
    );
  }
});

test("every admin route has a section entry", async () => {
  const { readdir } = await import("node:fs/promises");
  const { ADMIN_SECTIONS } = await import("../../src/app/admin/sections.ts");
  const entries = await readdir(SRC + "app/admin", { withFileTypes: true });
  const routes = entries
    .filter((e) => e.isDirectory())
    .map((e) => `/admin/${e.name}`);
  const listed = new Set(ADMIN_SECTIONS.map((s) => s.href));
  for (const r of routes) {
    assert.ok(listed.has(r), `${r} exists but is not in ADMIN_SECTIONS — unreachable from the nav`);
  }
});

// ── other_service cannot be written, at either layer ──────────────────────

test("other_service is refused by the action layer, with its OWN reason", () => {
  // Two rejections that must stay distinct. An unknown string is not an
  // identity; `other_service` IS one and is simply not firm-mappable.
  // Reporting the second as the first would tell an admin they mistyped.
  assert.throws(
    () => requireFixedServiceIdentity("other_service"),
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      assert.match(msg, /no firm-wide NetSuite item/i);
      assert.match(msg, /per service line/i);
      assert.doesNotMatch(msg, /unknown/i);
      return true;
    },
  );
  assert.throws(() => requireFixedServiceIdentity("nonsense"), /Unknown service identity/);
  assert.throws(() => requireFixedServiceIdentity(undefined), /required/);
  // And the four go through untouched.
  for (const id of FIXED_SERVICE_IDENTITIES) {
    assert.equal(requireFixedServiceIdentity(id), id);
  }
});

test("the guard is reachable from a unit test on purpose", async () => {
  // It used to live in the action module, which imports the database and
  // therefore cannot be loaded by this runner — so the rule could only ever be
  // asserted as a code shape. It is a rule, not an action concern.
  const rules = await code("lib/netsuite/service-item-map-rules.ts");
  assert.match(rules, /export function requireFixedServiceIdentity/);
  const action = await code("app/actions/netsuite-service-map.ts");
  assert.doesNotMatch(action, /function requireFixedServiceIdentity/);
  assert.match(action, /requireFixedServiceIdentity\(/);
});

// ── the completion gate · release-critical ────────────────────────────────
//
// Mapping must not accidentally open projection. These are behavioural, not
// code-shape: driving a real quote to `accepted` would fire the production
// HubSpot deal-stage push, so the decision is proven where it can be.

const NO_MAPPINGS = { mapped: new Set<never>(), verdicts: new Map() };

test("a quote with no services is not gated at all", () => {
  assert.deepEqual(
    evaluateDirectServiceGate({ serviceIdentities: [], ...NO_MAPPINGS }),
    { blocked: false },
  );
});

test("an UNMAPPED service gives the actionable, Settings-facing refusal", () => {
  const g = evaluateDirectServiceGate({
    serviceIdentities: ["filling_blending"],
    ...NO_MAPPINGS,
  });
  assert.equal(g.blocked, true);
  assert.equal(g.blocked && g.kind, "mapping");
  assert.match(g.blocked ? g.reason : "", /Settings/);
  assert.match(g.blocked ? g.reason : "", /Filling \/ Blending/);
  // NOT the projection message — that would send an admin to wait for a
  // feature instead of to Settings.
  assert.doesNotMatch(g.blocked ? g.reason : "", new RegExp(PROJECTION_NOT_ENABLED));
});

test("a STALE mapping is actionable too, and names why", () => {
  for (const [verdict, pattern] of [
    [{ state: "gone" as const }, /no longer exists/],
    [{ state: "inactive" as const, itemCode: "BLD-FILL" }, /inactive/],
  ] as const) {
    const g = evaluateDirectServiceGate({
      serviceIdentities: ["filling_blending"],
      mapped: new Set(["filling_blending" as const]),
      verdicts: new Map([["filling_blending" as const, verdict]]),
    });
    assert.equal(g.blocked && g.kind, "mapping");
    assert.match(g.blocked ? g.reason : "", pattern);
  }
});

test("indeterminate blocks WITHOUT telling anyone to change a correct mapping", () => {
  const g = evaluateDirectServiceGate({
    serviceIdentities: ["filling_blending"],
    mapped: new Set(["filling_blending" as const]),
    verdicts: new Map([
      ["filling_blending" as const, { state: "indeterminate" as const, reason: "socket hang up" }],
    ]),
  });
  assert.equal(g.blocked && g.kind, "mapping");
  assert.match(g.blocked ? g.reason : "", /try again/i);
  assert.doesNotMatch(g.blocked ? g.reason : "", /re-map/i);
});

test("RELEASE-CRITICAL · a fully mapped, usable service STILL blocks", () => {
  // The one that matters. Mapping removes the accidental block; if this ever
  // returns proceed, a service is emitted as a flat Direct-Product-shaped SO
  // line at whatever quantity and rate that path computes, unreviewed.
  const g = evaluateDirectServiceGate({
    serviceIdentities: ["filling_blending"],
    mapped: new Set(["filling_blending" as const]),
    verdicts: new Map([
      ["filling_blending" as const, { state: "usable" as const, itemCode: "BLD-FILL" }],
    ]),
  });
  assert.equal(g.blocked, true);
  assert.equal(g.blocked && g.kind, "projection");
  assert.match(g.blocked ? g.reason : "", new RegExp(PROJECTION_NOT_ENABLED));
  assert.match(g.blocked ? g.reason : "", /Nothing was pushed/);
});

test("EVERY combination of service state blocks — none proceeds", () => {
  // Exhaustive over the verdict space rather than the three cases above, so a
  // new verdict state cannot quietly acquire a proceed path.
  const verdictSpace = [
    undefined,
    { state: "usable" as const, itemCode: "X" },
    { state: "gone" as const },
    { state: "inactive" as const, itemCode: "X" },
    { state: "indeterminate" as const, reason: "r" },
  ];
  for (const id of [...FIXED_SERVICE_IDENTITIES, "other_service" as const]) {
    for (const v of verdictSpace) {
      const g = evaluateDirectServiceGate({
        serviceIdentities: [id],
        mapped: v ? new Set([id as never]) : new Set<never>(),
        verdicts: v ? new Map([[id as never, v]]) : new Map(),
      });
      assert.equal(g.blocked, true, `${id} with ${v?.state ?? "unmapped"} did not block`);
    }
  }
});

test("other_service on a quote is refused for its OWN reason", () => {
  const g = evaluateDirectServiceGate({
    serviceIdentities: ["other_service"],
    ...NO_MAPPINGS,
  });
  assert.equal(g.blocked && g.kind, "mapping");
  assert.match(g.blocked ? g.reason : "", /no firm-wide NetSuite item/);
  assert.match(g.blocked ? g.reason : "", /chosen per line/);
});

test("mark-complete throws the gate's reason BEFORE building any SO payload", async () => {
  const mc = await code("lib/netsuite/mark-complete.ts");
  // CALL sites, not first mention. The first draft of this searched for the
  // bare identifier and matched the IMPORT of `buildSalesOrderPayload` at the
  // top of the file — so it measured import order and failed on correct code.
  // A filter that cannot express the thing it certifies is worse than none.
  const callIdx = (name: string) => mc.indexOf(`${name}(`);
  const gateIdx = callIdx("evaluateDirectServiceGate");
  const skuIdx = mc.indexOf("const uniqueSkus");
  const payloadIdx = callIdx("buildSalesOrderPayload");
  assert.ok(gateIdx > -1, "the gate is not called");
  assert.ok(gateIdx < skuIdx, "the gate runs after SKU resolution");
  assert.ok(payloadIdx > -1, "buildSalesOrderPayload is never called — check the pattern");
  assert.ok(gateIdx < payloadIdx, "the gate runs after payload construction");
  // And a "proceed" from the gate with services present is itself an error,
  // rather than silently falling through into the product path.
  assert.match(mc, /if \(!gate\.blocked\) \{[\s\S]{0,200}?throw new Error/);
});

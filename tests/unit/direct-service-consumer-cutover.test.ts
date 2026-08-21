import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  SERVICE_IDENTITY_DESTINATION,
  isPerLineDestination,
} from "../../src/lib/netsuite/bv011-destinations.ts";

const root = path.resolve(import.meta.dirname, "../..");
const code = (f: string) => readFile(path.join(root, "src", f), "utf8");

/**
 * #317 — Direct Service SO consumer cutover.
 *
 * The defect: admin governance and readiness had moved to
 * `netsuite_destination_item_map`, while the SO writer still resolved Direct
 * Services through `netsuite_service_item_map`. Two authorities answering one
 * question, so a correct and audited destination mapping was invisible to the
 * writer and the push refused a fully mapped quote.
 *
 * These pin the invariants, not the symptom. A Pack-out-shaped fix would pass
 * a symptom test and leave the next Direct Service broken the same way.
 */

test("INVARIANT 1+2 — every Direct Service identity has a governed destination", () => {
  // Identity → destination is the whole resolution rule; nothing string-matches
  // a display name, and nothing is special-cased per service.
  const identities = Object.keys(SERVICE_IDENTITY_DESTINATION);
  assert.ok(identities.length >= 5, "expected the fixed identity set");
  for (const id of identities) {
    const dest = (SERVICE_IDENTITY_DESTINATION as Record<string, string>)[id];
    assert.ok(typeof dest === "string" && dest.length > 0,
      `${id} has no governed destination`);
  }
  // The one under repair, stated explicitly so a rename cannot pass silently.
  assert.equal(SERVICE_IDENTITY_DESTINATION.packout_assembly, "otc_packout");
});

test("INVARIANT 4 — the SO push does NOT consult the superseded service map", async () => {
  const mc = await code("lib/netsuite/mark-complete.ts");
  assert.doesNotMatch(mc, /evaluateDirectServiceGate/);
  assert.doesNotMatch(mc, /loadServiceItemMappings/);
  assert.doesNotMatch(mc, /validateServiceItemMappings/);
  assert.doesNotMatch(mc, /netsuiteServiceItemMap/);
  assert.doesNotMatch(mc, /service-item-map/);
});

test("INVARIANT 2 — readiness resolves the item from the DESTINATION map", async () => {
  const r = await code("lib/netsuite/projection-readiness.ts");
  assert.match(r, /netsuiteDestinationItemMap/);
  // and derives a destination from the governed identity when the frozen row
  // predates the column — reading the same map the freeze would have used.
  assert.match(r, /SERVICE_IDENTITY_DESTINATION\[line\.serviceIdentity\]/);
});

test("INVARIANT 7 — an unmapped destination BLOCKS; a legacy row cannot rescue it", async () => {
  const r = await code("lib/netsuite/projection-readiness.ts");
  // The blocker exists and is reached from the same loop that resolves items,
  // so there is no path that skips it and still produces a line.
  assert.match(r, /kind: "unmapped_destination"/);
  assert.match(r, /has no NetSuite item mapped\. Add it in Settings/);
  // Readiness has no knowledge of the legacy authority at all — which is what
  // makes "a legacy row does not make the push succeed" structural rather than
  // a behaviour someone has to remember to preserve.
  assert.doesNotMatch(r, /netsuiteServiceItemMap|service-item-map/);
});

test("INVARIANT 3 — one pass produces both the blockers and the emitted item", async () => {
  const r = await code("lib/netsuite/projection-readiness.ts");
  // ResolvedAccountingLine carries netsuiteItemId, and it is what the emitter
  // consumes. A second resolver for emission is the divergence Pattern 58 warns
  // about: readiness could certify a line the emitter then sends elsewhere.
  assert.match(r, /netsuiteItemId: mapping\.internalId/);
  assert.match(r, /Resolved alongside the blockers, in the SAME pass/);
});

test("INVARIANT 5 — Filling and Formulation route through the same authority", () => {
  // No carve-out: the two services that already worked resolve by the identical
  // identity → destination rule, not by their surviving legacy rows.
  assert.equal(SERVICE_IDENTITY_DESTINATION.filling_blending, "otc_filling");
  assert.equal(SERVICE_IDENTITY_DESTINATION.formulation, "otc_formulation");
  assert.ok(!isPerLineDestination("otc_filling"));
  assert.ok(!isPerLineDestination("otc_formulation"));
  assert.ok(!isPerLineDestination("otc_packout"));
});

test("per-line destinations stay exempt — the cutover did not flatten them", () => {
  // `OTC - Other Service` has no firm-wide record by design; its item is frozen
  // per line. Routing it through the firm-wide map would send an admin to add a
  // row the schema forbids.
  assert.ok(isPerLineDestination(SERVICE_IDENTITY_DESTINATION.other_service));
});

test("the superseded table is NOT retired here — consumers still exist", async () => {
  // #317 is the writer cutover only. Admin write path, UI and schema remain,
  // and removing them is a separate cleanup. Pinned so the scope boundary is
  // explicit rather than a thing someone infers from the diff.
  const admin = await code("app/actions/netsuite-service-map.ts");
  assert.match(admin, /netsuiteServiceItemMap/);
});

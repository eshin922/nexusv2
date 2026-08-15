/**
 * Legacy freight attribution — the compatibility read is narrow, and stays narrow.
 *
 * The risk this guards is not that the path fails. It is that it succeeds too
 * often: a predicate loose enough to catch DPS-1050 and also exempt a current
 * malformed quote would restore assembly-anchor substitution by the back door,
 * which is the exact rule the equal-split policy replaced.
 *
 * So most of what follows asserts REFUSAL.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  MEMBERSHIP_REQUIRED_FROM,
  resolveLegacyFreightAttribution,
  type FrozenAttributionContext,
} from "../../src/lib/freight-legacy-attribution.ts";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** DPS-1050's real frozen shape, from its snapshot. */
const dps1050 = {
  frozenAt: new Date("2026-08-13T04:55:25.876Z"),
  subcategoryId: "0e0cba75-0000-0000-0000-000000000000",
  assemblyId: "0a14b79b-c176-45a0-8c44-172177e43960",
  frozenMemberCount: 0,
  costingContext: {
    ownerSkuBySubcategory: {},
    ownerSkuByAssembly: { "0a14b79b-c176-45a0-8c44-172177e43960": "12cc7e6f-bf4a-4522-a4c1-63029873cee5" },
  },
};

test("DPS-1050 resolves to the leaf its snapshot recorded at send", () => {
  const got = resolveLegacyFreightAttribution(dps1050);
  assert.deepEqual(got, { eligible: true, memberSkuId: "12cc7e6f-bf4a-4522-a4c1-63029873cee5" });
});

test("a record frozen at or after enforcement is refused", () => {
  // The boundary instant itself is already the new contract, so `>=`. A record
  // frozen a millisecond before it is legacy; one frozen ON it is not.
  const at = { ...dps1050, frozenAt: MEMBERSHIP_REQUIRED_FROM };
  assert.deepEqual(resolveLegacyFreightAttribution(at).eligible, false);
  assert.equal(
    (resolveLegacyFreightAttribution(at) as { reason: string }).reason,
    "frozen_after_enforcement",
  );
  const just_before = new Date(MEMBERSHIP_REQUIRED_FROM.getTime() - 1);
  assert.equal(resolveLegacyFreightAttribution({ ...dps1050, frozenAt: just_before }).eligible, true);
});

test("a frozen record with NO recorded anchor is refused, not reconstructed", () => {
  // The load-bearing refusal. An empty context is exactly the state where a
  // fallback would be tempting and where inventing one would manufacture
  // history — the assembly's lowest leaf, an id, a timestamp, a cost share and
  // a quantity are all excluded by policy, so there is nothing left to use.
  const contexts: Array<FrozenAttributionContext | null | undefined> = [
    {},
    { ownerSkuBySubcategory: {}, ownerSkuByAssembly: {} },
    { ownerSkuByAssembly: { "some-other-assembly": "leaf" } },
    null,
    undefined,
  ];
  for (const context of contexts) {
    const got = resolveLegacyFreightAttribution({ ...dps1050, costingContext: context });
    assert.equal(got.eligible, false, `context ${JSON.stringify(context)} must refuse`);
    assert.equal((got as { reason: string }).reason, "no_recorded_anchor");
  }
  // And an anchor present but empty is not an anchor.
  assert.equal(
    resolveLegacyFreightAttribution({
      ...dps1050,
      costingContext: { ownerSkuByAssembly: { [dps1050.assemblyId]: "" } },
    }).eligible,
    false,
  );
});

test("a shipment WITH membership is never a legacy case, whatever its date", () => {
  // Otherwise an old record with one recorded member would take the anchor
  // instead of its own membership — quietly preferring the substitution over
  // the operator's record.
  const got = resolveLegacyFreightAttribution({ ...dps1050, frozenMemberCount: 1 });
  assert.equal(got.eligible, false);
  assert.equal((got as { reason: string }).reason, "membership_recorded");
});

test("a Direct Component shipment with no assembly cannot borrow an anchor", () => {
  // `assemblyId: null` must not index the map with "undefined" or fall through
  // to some other assembly's leaf.
  const got = resolveLegacyFreightAttribution({ ...dps1050, assemblyId: null });
  assert.equal(got.eligible, false);
  assert.equal((got as { reason: string }).reason, "no_recorded_anchor");
});

test("the compatibility path is unreachable from the draft loader", () => {
  // The structural guarantee, and the reason the predicate does not need to
  // ask whether a quote is a draft: a draft never reaches the function that
  // calls the resolver. Asserted on the source because it is a property of the
  // call graph, not of any value.
  const source = stripComments(readFileSync("src/app/actions/costing.ts", "utf8"));
  const calls = source.match(/resolveLegacyFreightAttribution\(/g) ?? [];
  assert.equal(calls.length, 1, "exactly one call site");
  const snapshotFn = source.slice(source.indexOf("function projectSnapshotWorkbook"));
  assert.ok(
    snapshotFn.includes("resolveLegacyFreightAttribution("),
    "the only call site must be inside the snapshot projection",
  );
  // The draft loader keeps failing closed, with no anchor resolution of any kind.
  const draftFn = source.slice(
    source.indexOf("async function loadWorksheetFreightForQuote"),
    source.indexOf("function projectSnapshotWorkbook"),
  );
  assert.doesNotMatch(draftFn, /ownerSkuByAssembly|ownerSkuBySubcategory|anchorByAssembly/);
  assert.match(draftFn, /if \(members\.length === 0\) return \[\];/);
});

test("the boundary is a fixed instant, so the eligible population cannot grow", () => {
  // A relative window ("anything older than 30 days") would keep admitting new
  // records forever and turn a compatibility read into a standing exemption.
  const src = readFileSync("src/lib/freight-legacy-attribution.ts", "utf8");
  assert.match(src, /MEMBERSHIP_REQUIRED_FROM = new Date\("20\d\d-\d\d-\d\dT/);
  assert.doesNotMatch(src, /Date\.now\(\)|new Date\(\)/, "no relative boundary");
});

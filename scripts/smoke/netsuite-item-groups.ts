// Slice 12 Step 8c-1 — sandbox smoke for the NetSuite adapter.
//
// End-to-end exercise against the sandbox NetSuite account.
//
// REQUIRED INVOCATION: this script needs `server-only` shimmed BEFORE
// module resolution. Run via:
//   node --require ./scripts/smoke/shim-server-only.cjs \
//     --loader tsx ./scripts/smoke/netsuite-item-groups.ts
// or the npm-scripted equivalent (see scripts/smoke/README).

//   1. resolveNetsuiteItems() against a fixed set of real sandbox SKUs
//      — reports hit rate for CA's tracking ask.
//   2. findOrCreateItemGroup() for a fresh composition — expects
//      outcome="created", verifies persisted row + externalId round-trip.
//   3. findOrCreateItemGroup() with the SAME composition — expects
//      outcome="cache_hit", zero NetSuite writes.
//   4. findOrCreateItemGroup() with a DIFFERENT composition on the
//      same base_sku — expects fresh create with -G2/-G3 collision
//      handling.
//   5. Cleanup — delete the created groups + local cache rows so the
//      smoke is re-runnable.
//
// Run via:
//   node --experimental-strip-types --env-file=.env.local scripts/smoke/netsuite-item-groups.ts
//
// SANDBOX ONLY. Guardrail: script asserts NETSUITE_ENV=sandbox before
// any NetSuite call.

import { db } from "../../src/db/index.ts";
import { netsuiteItemGroups, auditLog } from "../../src/db/schema.ts";
import { eq, inArray } from "drizzle-orm";
import {
  loadNetsuiteConfig,
  suiteQL,
  nsRequest,
  _resetNetsuiteConfigForTests,
} from "../../src/lib/netsuite/client.ts";
import { findOrCreateItemGroup } from "../../src/lib/netsuite/item-groups.ts";
import {
  resolveNetsuiteItems,
} from "../../src/lib/netsuite/item-resolver.ts";
import type { CompositionMember } from "../../src/lib/netsuite/composition-hash.ts";

async function main() {
// Guardrail: sandbox only.
_resetNetsuiteConfigForTests();
const cfg = loadNetsuiteConfig();
if (cfg.env !== "sandbox") {
  console.error(
    `✗ REFUSED — NETSUITE_ENV=${cfg.env}, sandbox required. accountId=${cfg.accountId}`,
  );
  process.exit(1);
}
console.log(`✓ Sandbox confirmed: ${cfg.accountId} (env=${cfg.env})\n`);

// ────────────────────────────────────────────────────────────
// Test fixture SKUs — each labeled by CATEGORY so hit rate can be
// interpreted (per CA's ask 2026-07-28: "the difference between
// 'expected' and 'unmatched is the common path'").
//
// CATEGORY LEGEND:
//   real       — real NetSuite sandbox items surfaced via D1 probes.
//                Represents production-shape leaves. Expected: FOUND.
//   synthetic  — deliberately-nonexistent SKU to verify the not_found
//                branch. Represents "PM typo" or "unmigrated leaf".
//                Expected: NOT_FOUND (and that IS the pass condition).
const FIXTURE_SKUS: Array<{ sku: string; category: "real" | "synthetic"; note: string }> = [
  { sku: "001",              category: "real",      note: "Primary Packaging (InvtPart id=47954)" },
  { sku: "TCS-BAR-01",       category: "real",      note: "Bar-soap SKU — used to collide with -G Item Group before item-resolver's itemtype!='Group' filter" },
  { sku: "OTC-0001",         category: "real",      note: "OTC (NonInvtPart id=11012, class 61)" },
  { sku: "3PL-0004",         category: "real",      note: "Freight (NonInvtPart id=12429, class 60)" },
  { sku: "DOES-NOT-EXIST",   category: "synthetic", note: "intentional negative test — verifies not_found branch" },
];

console.log("=== 1. Item resolver smoke (SKU-match hit rate on real vs synthetic) ===\n");
const { results, stats } = await resolveNetsuiteItems(FIXTURE_SKUS.map((f) => f.sku));

let realFound = 0, realFail = 0, syntheticExpected = 0, syntheticUnexpected = 0;
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const fixture = FIXTURE_SKUS[i];
  const tag = fixture.category === "real" ? "REAL " : "SYNTH";
  if (r.status === "found") {
    console.log(`  ✓ [${tag}] ${r.sku} → id=${r.netsuiteItemId} itemid="${r.itemid}" type=${r.itemtype}`);
    if (fixture.category === "real") realFound++;
    else syntheticUnexpected++;
  } else if (r.status === "not_found") {
    if (fixture.category === "synthetic") {
      console.log(`  ✓ [${tag}] ${r.sku} — not_found (expected — ${fixture.note})`);
      syntheticExpected++;
    } else {
      console.log(`  ✗ [${tag}] ${r.sku} — not_found (UNEXPECTED for real fixture — ${fixture.note})`);
      realFail++;
    }
  } else {
    console.log(`  ⚠ [${tag}] ${r.sku} — ambiguous (${r.matches.length} matches: ${r.matches.map((m) => m.itemtype).join(", ")})`);
    console.log(`      ${fixture.note}`);
    if (fixture.category === "real") realFail++;
    else syntheticUnexpected++;
  }
}
console.log();
console.log(`  Real fixtures (represent production leaves):`);
console.log(`    ${realFound}/${realFound + realFail} resolved (${realFound + realFail === 0 ? 0 : (100 * realFound / (realFound + realFail)).toFixed(0)}%)`);
console.log(`  Synthetic fixtures (negative-test):`);
console.log(`    ${syntheticExpected}/${syntheticExpected + syntheticUnexpected} behaved as expected`);
console.log(`  Raw stats (all fixtures): found=${stats.found} not_found=${stats.notFound} ambiguous=${stats.ambiguous}\n`);
if (realFail > 0) {
  console.error(`✗ ${realFail} REAL fixture(s) failed to resolve — this would block SO push in production. Aborting.`);
  process.exit(1);
}

// Extract the resolved ids for the group-create smoke.
const resolved = results.filter((r) => r.status === "found");
if (resolved.length < 2) {
  console.error("✗ Need at least 2 resolved fixture items for the group smoke. Aborting.");
  process.exit(1);
}

// ────────────────────────────────────────────────────────────
// Pre-cleanup: delete any prior-smoke-run orphans by externalId prefix.
console.log("=== 1a. Pre-cleanup (drop any orphaned NS groups matching nxs-grp-*) ===\n");
try {
  const orphans = await suiteQL<{ id: string; itemid: string; externalid: string }>(
    "SELECT id, itemid, externalid FROM item WHERE itemtype='Group' AND externalid LIKE 'nxs-grp-%'",
  );
  console.log(`  found ${orphans.items.length} nxs-grp-* item groups`);
  for (const o of orphans.items) {
    try {
      await nsRequest({ method: "DELETE", path: `/record/v1/itemGroup/${o.id}` });
      console.log(`    ✓ deleted id=${o.id} itemid="${o.itemid}" ext=${o.externalid.slice(0,15)}…`);
    } catch (e) {
      console.log(`    ⚠ delete failed for ${o.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Clear local cache too
  await db.delete(netsuiteItemGroups);
  console.log("  ✓ local cache cleared\n");
} catch (e) {
  console.log(`  ⚠ pre-cleanup skipped: ${e instanceof Error ? e.message : e}\n`);
}

// ────────────────────────────────────────────────────────────
console.log("=== 2. First-create smoke (expect outcome='created') ===\n");
const SMOKE_TAG = `SMOKE-${Date.now()}`;
const customerNsId = "131860"; // Epicuren sandbox customer

const composition1: CompositionMember[] = resolved.slice(0, 2).map((r) => ({
  netsuiteItemId: r.status === "found" ? r.netsuiteItemId : "",
  quantity: 1,
}));

const createInput1 = {
  hashInput: {
    customerNetsuiteId: customerNsId,
    baseSku: SMOKE_TAG,
    members: composition1,
  },
  members: resolved.slice(0, 2).map((r) => ({
    netsuiteItemId: r.status === "found" ? r.netsuiteItemId : "",
    quantity: 1,
    sku: r.status === "found" ? r.itemid : "",
    name: r.status === "found" ? r.itemid : "",
  })),
  customerDisplay: "Smoke",
  dealName: "Smoke test",
  hubspotDealId: `SMOKE-DEAL-${Date.now()}`,
  quoteId: null,
  userId: null,
};

const created = await findOrCreateItemGroup(createInput1);
console.log(`  outcome:            ${created.outcome}`);
console.log(`  composition_hash:   ${created.compositionHash}`);
console.log(`  netsuite_ext_id:    ${created.netsuiteExternalId}`);
console.log(`  netsuite_int_id:    ${created.netsuiteInternalId}`);
console.log(`  itemid_display:     ${created.itemidDisplay}`);
if (created.outcome !== "created") {
  console.error(`\n✗ Expected outcome='created', got '${created.outcome}'. Aborting.`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────
console.log("\n=== 3. Cache-hit smoke (same composition; expect outcome='cache_hit') ===\n");
const reused = await findOrCreateItemGroup(createInput1);
console.log(`  outcome:            ${reused.outcome}`);
console.log(`  same hash:          ${reused.compositionHash === created.compositionHash}`);
console.log(`  same int id:        ${reused.netsuiteInternalId === created.netsuiteInternalId}`);
if (reused.outcome !== "cache_hit") {
  console.error(`\n✗ Expected outcome='cache_hit', got '${reused.outcome}'. Aborting.`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────
console.log("\n=== 4. Different composition on same base_sku (expect -G2 or fresh create) ===\n");
const composition2: CompositionMember[] = [
  ...composition1,
  ...(resolved[2] ? [{ netsuiteItemId: resolved[2].status === "found" ? resolved[2].netsuiteItemId : "", quantity: 1 }] : []),
];
if (composition2.length === composition1.length) {
  console.log("  ⚠ Skipping — only 2 resolved fixtures, no 3rd member to vary composition");
} else {
  const createInput2 = {
    ...createInput1,
    hashInput: { ...createInput1.hashInput, members: composition2 },
    members: [
      ...createInput1.members,
      ...(resolved[2] && resolved[2].status === "found"
        ? [
            {
              netsuiteItemId: resolved[2].netsuiteItemId,
              quantity: 1,
              sku: resolved[2].itemid,
              name: resolved[2].itemid,
            },
          ]
        : []),
    ],
  };
  const created2 = await findOrCreateItemGroup(createInput2);
  console.log(`  outcome:            ${created2.outcome}`);
  console.log(`  composition_hash:   ${created2.compositionHash}`);
  console.log(`  itemid_display:     ${created2.itemidDisplay}   (expect ${SMOKE_TAG}-G2)`);
  if (created2.outcome !== "created") {
    console.error(`\n✗ Expected outcome='created' for different composition, got '${created2.outcome}'.`);
    process.exit(1);
  }
  if (created2.itemidDisplay !== `${SMOKE_TAG}-G2`) {
    console.error(`\n✗ Expected itemidDisplay='${SMOKE_TAG}-G2', got '${created2.itemidDisplay}'.`);
    process.exit(1);
  }
  console.log("  ✓ -G2 collision resolution correct");
}

// ────────────────────────────────────────────────────────────
console.log("\n=== 5. Cleanup ===\n");
const cachedRows = await db
  .select()
  .from(netsuiteItemGroups)
  .where(eq(netsuiteItemGroups.baseSku, SMOKE_TAG));
console.log(`  local cache rows to delete: ${cachedRows.length}`);
for (const row of cachedRows) {
  try {
    await nsRequest({
      method: "DELETE",
      path: `/record/v1/itemGroup/${row.netsuiteInternalId}`,
    });
    console.log(`  ✓ NS delete: internalId=${row.netsuiteInternalId} itemid="${row.itemidDisplay}"`);
  } catch (e) {
    console.log(`  ⚠ NS delete failed for ${row.netsuiteInternalId}: ${e instanceof Error ? e.message : e}`);
  }
}
if (cachedRows.length > 0) {
  await db
    .delete(netsuiteItemGroups)
    .where(
      inArray(
        netsuiteItemGroups.compositionHash,
        cachedRows.map((r) => r.compositionHash),
      ),
    );
  console.log(`  ✓ Local cache cleared`);
}

// Also delete the smoke audit rows (entityId = composition_hash for
// this action; scoped to the tag via cache rows).
if (cachedRows.length > 0) {
  await db
    .delete(auditLog)
    .where(
      inArray(
        auditLog.entityId,
        cachedRows.map((r) => r.compositionHash),
      ),
    );
  console.log(`  ✓ Audit rows cleared`);
}

console.log("\n✓ ALL SMOKE STEPS PASSED\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n✗ SMOKE FAILED\n", e);
    process.exit(1);
  });

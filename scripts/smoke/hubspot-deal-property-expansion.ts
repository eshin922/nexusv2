// Slice 12 Step 8c-2 — smoke: sync one deal via syncDealById and
// verify the 10 new columns populate.
//
// Run via:
//   npm run smoke:hubspot-deal-property-expansion
//
// Uses Epicuren deal 40412634025 as the canonical fixture (55/200
// properties populated per D2 probe; all 10 8c-2 additions have
// values on this deal).

import { db } from "../../src/db/index.ts";
import { hubspotDealsCache } from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { syncDealById } from "../../src/lib/hubspot-cache.ts";

async function main() {
  const DEAL_ID = "40412634025"; // Epicuren - Pro Masks
  console.log(`Sync-by-id: ${DEAL_ID} (Epicuren - Pro Masks)\n`);
  const row = await syncDealById(DEAL_ID);
  if (!row) {
    console.error(`✗ syncDealById returned null — deal filtered out?`);
    process.exit(1);
  }

  // Re-read via db to get the persisted shape (syncDealById returns
  // the in-memory row; verify it matches what's actually written).
  const fresh = await db
    .select()
    .from(hubspotDealsCache)
    .where(eq(hubspotDealsCache.dealId, DEAL_ID))
    .limit(1);
  if (fresh.length === 0) {
    console.error(`✗ deal not found after sync`);
    process.exit(1);
  }
  const r = fresh[0];

  console.log("Full cache row (all columns):");
  for (const [k, v] of Object.entries(r).sort()) {
    console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v)}`);
  }
  console.log();

  // Verify the 10 new columns populated (or explain why not).
  const checks: Array<{ col: string; value: unknown; expected: string }> = [
    { col: "dealFolderUrl",         value: r.dealFolderUrl,         expected: "SharePoint URL" },
    { col: "projectServiceS",       value: r.projectServiceS,       expected: '"Copacking"' },
    { col: "projectCategory",       value: r.projectCategory,       expected: '"Co-Packing"' },
    { col: "sourcingLocation",      value: r.sourcingLocation,      expected: '"Domestic"' },
    { col: "businessSegmentId",     value: r.businessSegmentId,     expected: '"1" (enum id)' },
    { col: "clientPo",              value: r.clientPo,              expected: '"13969"' },
    { col: "invoiceDateEst",        value: r.invoiceDateEst,        expected: '"2026-09-07"' },
    { col: "productionShipDateEst", value: r.productionShipDateEst, expected: '"2026-09-07"' },
    { col: "priority",              value: r.priority,              expected: '"medium"' },
    { col: "dealType",              value: r.dealType,              expected: '"newbusiness"' },
    // pmId only populates when HUBSPOT_PM_PROPERTY env is set.
    { col: "pmId (PM_PROPERTY-gated)", value: r.pmId, expected: 'HubSpot owner id or null if env unset' },
  ];

  console.log("New-column population check:");
  let missing = 0;
  for (const c of checks) {
    const populated = c.value !== null && c.value !== undefined && c.value !== "";
    const marker = populated ? "✓" : "○";
    console.log(`  ${marker} ${c.col.padEnd(32)} → ${JSON.stringify(c.value)}   [expected ${c.expected}]`);
    // 10 additions all expected to populate on Epicuren
    if (!populated && c.col !== "pmId (PM_PROPERTY-gated)") missing++;
  }

  if (missing > 0) {
    console.error(`\n✗ ${missing} required column(s) unpopulated`);
    process.exit(1);
  }
  console.log("\n✓ All 10 new columns populated correctly");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n✗ SMOKE FAILED\n", e);
    process.exit(1);
  });

// Slice 12 Step 7 — CB fixture cleanup.
//
// Invoked by CC AFTER CB reports the walk complete.
//
// USAGE:
//   FIXTURE_QUOTE_ID=<uuid> FIXTURE_HS_DEAL_ID=<id> \
//     node scripts/cleanup-cb-step7-fixture.mjs
//
// OR pass on command line:
//   node scripts/cleanup-cb-step7-fixture.mjs <quoteId> <hubspotDealId>
//
// Actions (in order — external first per project convention):
//   1. HubSpot: archive the throwaway deal
//   2. DB tx:
//      - delete audit_log rows tagged to the fixture entities (quote,
//        project, tiers, assembly, assembly_leaf) — anything created
//        by CB's walk (accept/rollback/accept/revise audits + system
//        review events with source='mark_accepted_auto_log' /
//        'unmark_accepted_auto_log' / etc)
//      - delete quote_review_events for the quote
//      - delete quote_snapshots for the quote
//      - delete assembly_leaves + assemblies for the quote
//        (RESTRICT cascade: library `leaves` untouched)
//      - delete quote_tiers for the quote
//      - delete the quote row
//      - delete the project row
//
// After cleanup: the borrowed library leaf id
// 6cce847c-37bf-46b4-ab33-315b2b33c6a6 is unchanged (assembly_leaves
// FK is RESTRICT — safe to delete our assembly_leaves; library row
// stays).

import postgres from "postgres";

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE) { console.error("HUBSPOT_WRITE_ACCESS_TOKEN required"); process.exit(1); }

const argQuote = process.argv[2] ?? process.env.FIXTURE_QUOTE_ID;
const argDeal = process.argv[3] ?? process.env.FIXTURE_HS_DEAL_ID;
if (!argQuote || !argDeal) {
  console.error("Usage: node cleanup-cb-step7-fixture.mjs <quoteId> <hubspotDealId>");
  console.error("   or: FIXTURE_QUOTE_ID=<uuid> FIXTURE_HS_DEAL_ID=<id> node ...");
  process.exit(1);
}

const QUOTE_ID = argQuote;
const HS_DEAL_ID = argDeal;

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

try {
  console.log(`Cleaning up fixture quote ${QUOTE_ID} + HubSpot deal ${HS_DEAL_ID}`);

  // 0. Pre-check — confirm this quote's project is a SMOKE-tagged
  //    throwaway. Guardrail so accidental cleanup against a real
  //    project id fails safely.
  const [check] = await sql`
    SELECT p.id AS project_id, p.deal_name, q.quote_number, q.status
    FROM quotes q
    JOIN projects p ON p.id = q.project_id
    WHERE q.id = ${QUOTE_ID}
  `;
  if (!check) {
    console.error(`ABORT: quote ${QUOTE_ID} not found`);
    process.exit(1);
  }
  if (!check.deal_name?.startsWith("SMOKE-CB-DELETE-ME-")) {
    console.error(
      `ABORT: project deal_name '${check.deal_name}' does not look like a throwaway fixture (expected 'SMOKE-CB-DELETE-ME-*'). Refusing to clean up.`,
    );
    process.exit(1);
  }
  console.log(`Confirmed throwaway: ${check.deal_name} · ${check.quote_number} · ${check.status}`);
  const projectId = check.project_id;

  // 1. Archive HubSpot deal
  console.log(`\n[1/2] Archiving HubSpot deal ${HS_DEAL_ID}…`);
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${HS_DEAL_ID}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HS_WRITE}` },
  });
  if (res.ok || res.status === 404) {
    console.log(`      → archived (HTTP ${res.status})`);
  } else {
    const t = await res.text();
    console.error(`      → HubSpot archive failed: ${res.status} ${t}`);
    // Continue with DB cleanup — HS orphan is easier to clean up
    // manually than a lingering DB fixture that keeps confusing PMs.
  }

  // 2. DB cleanup — one tx
  console.log(`\n[2/2] Deleting Nexus fixture rows…`);
  await sql.begin(async (tx) => {
    // Collect ids for audit_log cleanup
    const assemblyIds = await tx`
      SELECT id FROM assemblies WHERE quote_id = ${QUOTE_ID}
    `;
    const assemblyLeafIds = assemblyIds.length
      ? await tx`
          SELECT id FROM assembly_leaves
          WHERE assembly_id IN ${sql(assemblyIds.map(r => r.id))}
        `
      : [];
    const tierIds = await tx`
      SELECT id FROM quote_tiers WHERE quote_id = ${QUOTE_ID}
    `;
    const snapshotIds = await tx`
      SELECT id FROM quote_snapshots WHERE quote_id = ${QUOTE_ID}
    `;
    const reviewIds = await tx`
      SELECT id FROM quote_review_events WHERE quote_id = ${QUOTE_ID}
    `;

    // Cascade audit_log — anything keyed to fixture entity ids
    const allIds = [
      QUOTE_ID,
      projectId,
      ...assemblyIds.map(r => r.id),
      ...assemblyLeafIds.map(r => r.id),
      ...tierIds.map(r => r.id),
      ...snapshotIds.map(r => r.id),
      ...reviewIds.map(r => r.id),
    ];
    if (allIds.length > 0) {
      const [audit] = await tx`
        DELETE FROM audit_log WHERE entity_id IN ${sql(allIds)}
        RETURNING id
      `;
      // sql returns rows via .returning; count separately
      const auditCount = await tx`
        SELECT count(*)::int AS n FROM audit_log WHERE entity_id IN ${sql(allIds)}
      `;
      console.log(`      audit_log rows remaining: ${auditCount[0].n} (should be 0)`);
    }

    // Delete in FK-safe order
    await tx`DELETE FROM quote_review_events WHERE quote_id = ${QUOTE_ID}`;
    await tx`DELETE FROM quote_snapshots WHERE quote_id = ${QUOTE_ID}`;
    if (assemblyLeafIds.length) {
      await tx`DELETE FROM assembly_leaves WHERE id IN ${sql(assemblyLeafIds.map(r => r.id))}`;
    }
    if (assemblyIds.length) {
      await tx`DELETE FROM assemblies WHERE id IN ${sql(assemblyIds.map(r => r.id))}`;
    }
    await tx`DELETE FROM quote_tiers WHERE quote_id = ${QUOTE_ID}`;
    await tx`DELETE FROM quotes WHERE id = ${QUOTE_ID}`;
    await tx`DELETE FROM projects WHERE id = ${projectId}`;

    console.log(`      → all fixture rows deleted (project ${projectId}, quote ${QUOTE_ID})`);
  });

  console.log(`\n=== FIXTURE CLEANUP COMPLETE ===`);
} catch (e) {
  console.error("CLEANUP ERROR:", e);
  process.exit(1);
} finally {
  await sql.end();
}

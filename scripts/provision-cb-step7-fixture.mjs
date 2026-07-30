// Slice 12 Step 7 — CB browser walk fixture provisioning.
//
// Creates a self-contained throwaway fixture for the CB agent's
// walk of the Mark Accepted → Rollback → Mark Accepted → Revise
// flow. All artifacts are tagged SMOKE-CB-DELETE-ME with a timestamp
// so they're grep-able for cleanup.
//
// PROVISIONING (this script):
//   1. HubSpot throwaway deal (DPS Sales pipeline, "Development
//      & Quoting" stage — non-Won)
//   2. Nexus throwaway project pointing at that deal
//   3. Nexus throwaway quote in `sent` state at v1, tied to the
//      throwaway project, with a fresh quote_number from the sequence
//   4. One assembly + one assembly_leaf using an EXISTING library leaf
//      (avoids polluting the leaves library — the assembly_leaves FK
//      is RESTRICT, so cleanup is safe)
//   5. Two quote_tiers (Tier 1 @ 1000, Tier 2 @ 5000)
//   6. One quote_snapshot (superseded_at NULL — the "current sent"
//      snapshot Revise will supersede)
//   7. Two quote_review_events:
//        - system 'sent' event
//        - pm-authored note ("SMOKE-CB fixture walkable")
//
// Fixture invariants:
//   - status='sent', version_number=1
//   - accepted columns all NULL
//   - pending_hubspot_from_stage_* columns both NULL
//   - HubSpot deal at a NON-Won stage (Development & Quoting id
//     195274339) so Mark Accepted has a meaningful "from" stage to
//     snapshot then revert to
//
// CB WILL RUN: Mark Accepted → Rollback → Mark Accepted → Revise.
// CB IS EXPLICITLY NOT TOUCHING Tier Selection (irreversible).
//
// CLEANUP: separate script (cleanup-cb-step7-fixture.mjs) —
// invoked by CC after CB reports; archives the HS deal, deletes the
// Nexus fixture rows + audit + review events.

import postgres from "postgres";

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
const HS_READ = process.env.HUBSPOT_ACCESS_TOKEN;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE || !HS_READ) {
  console.error("HUBSPOT_WRITE_ACCESS_TOKEN + HUBSPOT_ACCESS_TOKEN required");
  process.exit(1);
}

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-CB-DELETE-ME-${NOW_ISO}`;

const DPS_SALES_PIPELINE_ID = "108896657";
const START_STAGE_ID = "195274339"; // Development & Quoting
const START_STAGE_LABEL = "Development & Quoting";

// Library leaf borrowed from DPS-1007 for the assembly_leaves FK.
// This is a persistent library entity; using it doesn't affect it.
const LIBRARY_LEAF_ID = "6cce847c-37bf-46b4-ab33-315b2b33c6a6";

// Edward's user id (my Nexus user) for owner/pm/creator fields.
const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

// ---------------------------------------------------------------
async function hubspotPost(path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HS_WRITE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HubSpot POST ${path} failed ${res.status}: ${t}`);
  }
  return res.json();
}

async function createHubspotDeal() {
  console.log(`\n[1/7] Creating throwaway HubSpot deal…`);
  const body = {
    properties: {
      dealname: SMOKE_TAG,
      pipeline: DPS_SALES_PIPELINE_ID,
      dealstage: START_STAGE_ID,
    },
  };
  const j = await hubspotPost("/crm/v3/objects/deals", body);
  console.log(`      → deal id ${j.id} at stage ${START_STAGE_LABEL} (${START_STAGE_ID})`);
  return { id: j.id, stageId: START_STAGE_ID, stageLabel: START_STAGE_LABEL };
}

// ---------------------------------------------------------------
try {
  const hs = await createHubspotDeal();

  const result = await sql.begin(async (tx) => {
    console.log(`\n[2/7] Inserting throwaway project…`);
    const [project] = await tx`
      INSERT INTO projects (
        hubspot_deal_id, hubspot_owner_id, deal_name, client_name,
        sales_rep_user_id, pm_user_id, project_category, status,
        deal_stage, imported_by_user_id, imported_at
      ) VALUES (
        ${hs.id}, NULL, ${SMOKE_TAG}, ${SMOKE_TAG},
        ${EDWARD_USER_ID}, ${EDWARD_USER_ID}, 'other', 'active',
        ${hs.stageLabel}, ${EDWARD_USER_ID}, NOW()
      )
      RETURNING id
    `;
    console.log(`      → project id ${project.id}`);

    console.log(`\n[3/7] Allocating quote_number from sequence…`);
    const [seq] = await tx`SELECT nextval('quote_number_seq') AS n`;
    const quoteNumber = `DPS-${seq.n}`;
    console.log(`      → ${quoteNumber}`);

    console.log(`\n[4/7] Inserting quote row (sent, v1)…`);
    const sentAt = new Date();
    const [quote] = await tx`
      INSERT INTO quotes (
        project_id, scenario_label, version_number, status,
        sent_at, quote_number, pdf_url,
        pdf_layout, detail_level, include_spec_addendum,
        prepared_by_name_snapshot, prepared_by_email_snapshot,
        prepared_by_phone_snapshot,
        created_by_user_id,
        pending_hubspot_from_stage_id, pending_hubspot_from_stage_version,
        accepted_at, accepted_by_user_id, accept_source
      ) VALUES (
        ${project.id}, 'SMOKE', 1, 'sent',
        ${sentAt}, ${quoteNumber}, NULL,
        'tier_table', 'itemized', false,
        'Edward Shin', 'edward@thedps.co', NULL,
        ${EDWARD_USER_ID},
        NULL, NULL,
        NULL, NULL, NULL
      )
      RETURNING id
    `;
    console.log(`      → quote id ${quote.id}`);

    console.log(`\n[5/7] Inserting tiers, assembly + assembly_leaf…`);
    const [tier1] = await tx`
      INSERT INTO quote_tiers (quote_id, label, qty, sort_order)
      VALUES (${quote.id}, 'Tier 1', 1000, 0)
      RETURNING id
    `;
    const [tier2] = await tx`
      INSERT INTO quote_tiers (quote_id, label, qty, sort_order)
      VALUES (${quote.id}, 'Tier 2', 5000, 1)
      RETURNING id
    `;
    const [assembly] = await tx`
      INSERT INTO assemblies (
        quote_id, sku, name, unit_cost, unit_price, markup_pct,
        owner_id, position
      ) VALUES (
        ${quote.id}, 'ASY-SMOKE-CB-1', 'SMOKE-CB Fixture Assembly',
        5.25, 12.50, 0.30,
        ${EDWARD_USER_ID}, 0
      )
      RETURNING id
    `;
    const [aleaf] = await tx`
      INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
      VALUES (${assembly.id}, ${LIBRARY_LEAF_ID}, 1, 0)
      RETURNING id
    `;
    console.log(`      → tiers ${tier1.id}, ${tier2.id}`);
    console.log(`      → assembly ${assembly.id}, leaf ${aleaf.id}`);

    console.log(`\n[6/7] Inserting quote_snapshot (current-sent, superseded_at=NULL)…`);
    const [snap] = await tx`
      INSERT INTO quote_snapshots (
        quote_id, version_number, effective_from, superseded_at,
        sent_at, quote_number,
        pdf_layout, detail_level, include_spec_addendum,
        prepared_by_name, prepared_by_email, prepared_by_phone,
        pdf_url,
        created_by_user_id
      ) VALUES (
        ${quote.id}, 1, ${sentAt}, NULL,
        ${sentAt}, ${quoteNumber},
        'tier_table', 'itemized', false,
        'Edward Shin', 'edward@thedps.co', NULL,
        NULL,
        ${EDWARD_USER_ID}
      )
      RETURNING id
    `;
    console.log(`      → snapshot ${snap.id}`);

    console.log(`\n[7/7] Inserting review events (system 'sent' + PM note)…`);
    const [ev1] = await tx`
      INSERT INTO quote_review_events (
        quote_id, version_number, event_type, note, author_user_id, system
      ) VALUES (
        ${quote.id}, 1, 'sent',
        'Sent to customer (SMOKE-CB fixture — system entry).',
        NULL, true
      )
      RETURNING id
    `;
    const [ev2] = await tx`
      INSERT INTO quote_review_events (
        quote_id, version_number, event_type, note, author_user_id, system
      ) VALUES (
        ${quote.id}, 1, 'asked',
        'SMOKE-CB fixture — this is a throwaway walkable quote for CB browser walk.',
        ${EDWARD_USER_ID}, false
      )
      RETURNING id
    `;
    console.log(`      → events ${ev1.id}, ${ev2.id}`);

    return {
      hubspotDealId: hs.id,
      hubspotDealStageId: hs.stageId,
      hubspotDealStageLabel: hs.stageLabel,
      projectId: project.id,
      quoteId: quote.id,
      quoteNumber,
      tierIds: [tier1.id, tier2.id],
      assemblyId: assembly.id,
      assemblyLeafId: aleaf.id,
      snapshotId: snap.id,
      reviewEventIds: [ev1.id, ev2.id],
      smokeTag: SMOKE_TAG,
    };
  });

  console.log("\n=============================================");
  console.log("=== FIXTURE PROVISIONED ===");
  console.log("=============================================\n");
  console.log(JSON.stringify(result, null, 2));

  const previewBase =
    "https://nexusv2-git-feat-slice-12-step-7c-rev-57ad4e-eshin922s-projects.vercel.app";
  const quoteUrl = `${previewBase}/projects/${result.projectId}/quotes/${result.quoteId}/quote?tab=accepted`;

  console.log("\n=== CB HANDOFF ===");
  console.log(`Preview URL (PR #146 — Step 7c branch — has Revise-from-accepted):`);
  console.log(`  ${previewBase}`);
  console.log(`Quote URL (deep link to Mark Accepted sub-tab):`);
  console.log(`  ${quoteUrl}`);
  console.log(`Quote number: ${result.quoteNumber}`);
  console.log(`HubSpot deal id: ${result.hubspotDealId}`);
  console.log(`HubSpot starting stage: "${result.hubspotDealStageLabel}" (id ${result.hubspotDealStageId})`);
  console.log(`Accept target stage (from firm_settings.hubspot_deal_stage_on_accept): "Won - In production" (id 195607084)`);
  console.log(`Fixture tag: ${result.smokeTag}`);
} catch (e) {
  console.error("PROVISIONING ERROR:", e);
  process.exit(1);
} finally {
  await sql.end();
}

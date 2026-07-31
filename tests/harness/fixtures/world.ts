import { createHash } from "node:crypto";
import postgres from "postgres";
import { assertRuntimeSafety } from "../../../src/lib/config/runtime-config.ts";

export type FixtureState = "draft" | "sent" | "accepted" | "failed" | "complete";

export type FixtureManifest = {
  runId: string;
  users: { pm: string; admin: string };
  quotes: Record<
    FixtureState,
    {
      projectId: string;
      quoteId: string;
      tierIds: [string, string];
      deepLinks: Record<string, string>;
    }
  >;
};

function uuid(runId: string, name: string): string {
  const hex = createHash("sha256").update(`${runId}:${name}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function fixtureRecordIds(runId: string) {
  const states: FixtureState[] = ["draft", "sent", "accepted", "failed", "complete"];
  return {
    projectIds: states.map((state) => uuid(runId, `project-${state}`)),
    quoteIds: states.map((state) => uuid(runId, `quote-${state}`)),
  };
}

function fakeHubSpotObjectId(runId: string, name: string): string {
  const hex = createHash("sha256").update(`${runId}:${name}`).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 1_000_000_000_000n)
    .toString()
    .padStart(12, "0");
  // HubSpot object IDs are numeric. Reserve a conspicuous synthetic range so
  // the real linkage predicate is exercised without resembling fixture labels.
  return `999${suffix}`;
}

function assertRunId(runId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{2,40}$/i.test(runId)) {
    throw new Error("[fixtures] runId must be 3-41 safe identifier characters");
  }
}

export async function seedFixtureWorld(runId: string): Promise<FixtureManifest> {
  assertRunId(runId);
  const safety = assertRuntimeSafety();
  if (safety.mode !== "isolated") throw new Error("[fixtures] isolated mode required");

  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  // Validation identities and firm policy are shared fixture infrastructure.
  // Keeping their primary keys independent of a run prevents a second run from
  // rewriting referenced IDs while still allowing every business record to be
  // reset by run ID.
  const pmId = uuid("nexus-validation-global", "user-pm");
  const adminId = uuid("nexus-validation-global", "user-admin");
  const firmSettingsId = uuid("nexus-validation-global", "firm");
  const companyId = `validation_hs_company_${runId}`;
  const states: FixtureState[] = ["draft", "sent", "accepted", "failed", "complete"];
  const manifest = {
    runId,
    users: { pm: pmId, admin: adminId },
    quotes: {},
  } as FixtureManifest;

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into users (id, clerk_user_id, email, name, role, hubspot_owner_id)
        values
          (${pmId}, 'validation_clerk_pm', 'pm@nexus-validation.invalid',
           'Validation PM', 'pm', 'validation_hs_owner_pm'),
          (${adminId}, 'validation_clerk_admin', 'admin@nexus-validation.invalid',
           'Validation Admin', 'admin', 'validation_hs_owner_admin')
        on conflict (clerk_user_id) do update set
          email = excluded.email, name = excluded.name,
          role = excluded.role, hubspot_owner_id = excluded.hubspot_owner_id
      `;
      await tx`
        insert into firm_settings (
          id, target_margin_pct, floor_margin_pct, vendor_name,
          quote_number_prefix, payment_terms_default, lead_time_default,
          incoterms_default, days_valid_default, hubspot_deal_stage_on_accept,
          netsuite_so_status_on_create, netsuite_subsidiary_id,
          netsuite_so_order_status_code, effective_from, updated_by_user_id
        ) values (
          ${firmSettingsId}, 0.35, 0.25, 'Nexus Validation Company',
          'VAL', 'Validation Net 30', 'Validation 4 weeks', 'Validation FOB',
          30, 'validation_stage_accepted', 'Pending Fulfillment',
          'validation_subsidiary', 'B', '2099-01-01', ${adminId}
        )
        on conflict (id) do update set
          target_margin_pct = excluded.target_margin_pct,
          floor_margin_pct = excluded.floor_margin_pct,
          vendor_name = excluded.vendor_name,
          updated_by_user_id = excluded.updated_by_user_id
      `;
      await tx`
        insert into netsuite_customer_map (
          hubspot_company_id, netsuite_customer_id,
          netsuite_customer_display_name, verified_by_user_id
        ) values (
          ${companyId}, ${`validation_ns_customer_${runId}`},
          'Validation Customer', ${adminId}
        )
      `;

      const leafIds = ["carton", "bottle", "insert"].map((name) => uuid(runId, `leaf-${name}`));
      for (const [index, leafId] of leafIds.entries()) {
        await tx`
          insert into leaves (id, name, sku, owner_id, hubspot_product_id)
          values (
            ${leafId}, ${`Validation Leaf ${index + 1}`},
            ${`VAL-${runId.toUpperCase()}-${index + 1}`}, ${pmId},
            ${`validation_hs_product_${runId}_${index + 1}`}
          )
        `;
      }

      for (const state of states) {
        const dealId = fakeHubSpotObjectId(runId, `deal-${state}`);
        const projectId = uuid(runId, `project-${state}`);
        const quoteId = uuid(runId, `quote-${state}`);
        const tier1 = uuid(runId, `tier-${state}-1`);
        const tier2 = uuid(runId, `tier-${state}-2`);
        const sent = state !== "draft";
        const accepted = state === "accepted" || state === "failed" || state === "complete";
        const complete = state === "complete";

        await tx`
          insert into hubspot_deals_cache (
            deal_id, deal_name, deal_stage, associated_company_id,
            associated_company_name, sales_rep_id, sales_rep_name,
            sales_rep_email, pm_id, pm_name, pm_email, sourcing_location,
            business_segment_id, business_segment_label, last_synced_at
          ) values (
            ${dealId}, ${`Validation ${state} deal`}, 'validation_stage_sent',
            ${companyId}, 'Validation Customer', 'validation_hs_owner_pm',
            'Validation Owner', 'owner@nexus-validation.invalid',
            'validation_hs_owner_pm', 'Validation PM',
            'pm@nexus-validation.invalid', 'Validation Domestic',
            'validation_segment', 'Validation Segment', '2026-01-15T12:00:00Z'
          )
        `;
        await tx`
          insert into projects (
            id, hubspot_deal_id, hubspot_owner_id, deal_name, client_name,
            sales_rep_user_id, pm_user_id, project_category, status,
            deal_stage, imported_by_user_id, imported_at
          ) values (
            ${projectId}, ${dealId}, 'validation_hs_owner_pm',
            ${`Validation ${state} deal`}, 'Validation Customer',
            ${state === "draft" ? null : pmId}, ${pmId},
            'turnkey', 'active', 'validation_stage_sent',
            ${pmId}, now()
          )
        `;
        await tx`
          insert into quotes (
            id, project_id, scenario_label, version_number, status,
            sent_at, accepted_at, accepted_by_user_id, accept_source,
            customer_response_channel, quote_number, valid_until,
            payment_terms_snapshot, lead_time_snapshot, incoterms_snapshot,
            days_valid_snapshot, prepared_by_name_snapshot,
            prepared_by_email_snapshot, pdf_layout, detail_level,
            include_spec_addendum, netsuite_so_id, netsuite_so_tranid,
            netsuite_so_push_status, created_by_user_id
          ) values (
            ${quoteId}, ${projectId}, ${`Validation ${state}`}, 1, ${complete ? "complete" : state === "failed" ? "accepted" : state},
            ${sent ? "2026-01-15T12:00:00Z" : null},
            ${accepted ? "2026-01-15T13:00:00Z" : null},
            ${accepted ? pmId : null}, ${accepted ? "manual_button" : null},
            ${accepted ? "email" : null}, ${sent ? `VAL-${runId}-${state}` : null},
            ${sent ? "2026-02-14" : null}, ${sent ? "Validation Net 30" : null},
            ${sent ? "Validation 4 weeks" : null}, ${sent ? "Validation FOB" : null},
            ${sent ? 30 : null}, ${sent ? "Validation Owner" : null},
            ${sent ? "owner@nexus-validation.invalid" : null},
            ${sent ? "tier_table" : null}, ${sent ? "itemized" : null},
            ${sent ? false : null},
            ${complete ? `validation_ns_so_${runId}` : null},
            ${complete ? `VSO-${runId}` : null},
            ${state === "failed" ? "failed" : complete ? "succeeded" : null},
            ${pmId}
          )
        `;
        await tx`
          insert into quote_tiers (id, quote_id, label, qty, sort_order, recommended)
          values
            (${tier1}, ${quoteId}, 'Validation 100', 100, 0, false),
            (${tier2}, ${quoteId}, 'Validation 500', 500, 1, true)
        `;
        if (accepted) {
          await tx`
            update quotes set
              customer_accepted_at = '2026-01-15T13:00:00Z',
              customer_accepted_tier_id = ${tier2},
              customer_accepted_recorded_by_user_id = ${pmId},
              accepted_tier_id = ${complete ? tier2 : null}
            where id = ${quoteId}
          `;
        }

        const assemblyId = uuid(runId, `assembly-${state}`);
        await tx`
          insert into assemblies (id, quote_id, sku, name, owner_id, position)
          values (
            ${assemblyId}, ${quoteId}, ${`VAL-ASY-${runId}-${state}`},
            ${`Validation ${state} assembly`}, ${pmId}, 0
          )
        `;
        for (const [index, leafId] of leafIds.entries()) {
          const junctionId = uuid(runId, `junction-${state}-${index}`);
          await tx`
            insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position)
            values (${junctionId}, ${assemblyId}, ${leafId}, 1, ${index})
          `;
          for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
            await tx`
              insert into assembly_leaf_inputs (
                id, assembly_leaf_id, tier_id, line_group_id,
                pricing_vendor_hubspot_company_id,
                pricing_vendor_name_snapshot, pricing_date, supplier,
                qty_per_sellable_unit, category, markup_pct,
                markup_pct_source, unit_cost, purchase_qty
              ) values (
                ${uuid(runId, `input-${state}-${index}-${tierIndex}`)},
                ${junctionId}, ${tierId},
                ${uuid(runId, `line-${state}-${index}`)},
                ${index === 0 ? "900000000000001" : null},
                ${index === 0 ? "Validation Packaging Vendor" : null},
                ${index === 0 ? "2026-01-10" : null},
                'Validation Supplier', 1, 'primary_packaging', 1,
                'manual_override', 0.10, ${tierIndex === 0 ? 100 : 500}
              )
            `;
          }
        }

        if (sent) {
          await tx`
            insert into quote_snapshots (
              id, quote_id, version_number, effective_from, sent_at,
              valid_until, quote_number, payment_terms, lead_time, incoterms,
              days_valid, prepared_by_name, prepared_by_email, pdf_layout,
              detail_level, include_spec_addendum, created_by_user_id
            ) values (
              ${uuid(runId, `snapshot-${state}`)}, ${quoteId}, 1,
              '2026-01-15T12:00:00Z', '2026-01-15T12:00:00Z',
              '2026-02-14', ${`VAL-${runId}-${state}`}, 'Validation Net 30',
              'Validation 4 weeks', 'Validation FOB', 30, 'Validation Owner',
              'owner@nexus-validation.invalid', 'tier_table', 'itemized',
              false, ${pmId}
            )
          `;
          await tx`
            insert into quote_review_events (
              id, quote_id, version_number, event_type, note, system
            ) values (
              ${uuid(runId, `review-${state}`)}, ${quoteId}, 1, 'sent',
              'Sent by deterministic validation fixture.', true
            )
          `;
          await tx`
            insert into audit_log (
              id, user_id, entity_type, entity_id, action, diff_json
            ) values (
              ${uuid(runId, `audit-${state}`)}, ${pmId}, 'quote', ${quoteId},
              'quote_sent', ${tx.json({ fixtureRunId: runId, state })}
            )
          `;
        }
        if (state === "failed" || complete) {
          await tx`
            insert into netsuite_so_pushes (
              id, quote_id, accepted_tier_id, status, netsuite_so_id,
              netsuite_so_tranid, amount_pushed, idempotency_key,
              error_class, error_detail, payload_snapshot,
              started_by_user_id, completed_at
            ) values (
              ${uuid(runId, `push-${state}`)}, ${quoteId}, ${tier2},
              ${complete ? "succeeded" : "failed"},
              ${complete ? `validation_ns_so_${runId}` : null},
              ${complete ? `VSO-${runId}` : null}, 1000,
              ${`validation_idempotency_${runId}_${state}`},
              ${complete ? null : "validation_failure"},
              ${complete ? null : "Injected validation failure"},
              ${tx.json({ fixtureRunId: runId })}, ${pmId},
              '2026-01-15T14:00:00Z'
            )
          `;
        }

        manifest.quotes[state] = {
          projectId,
          quoteId,
          tierIds: [tier1, tier2],
          deepLinks: {
            quote: `/projects/${projectId}/quotes/${quoteId}/quote`,
            setup: `/projects/${projectId}/quotes/${quoteId}/setup`,
            costs: `/projects/${projectId}/quotes/${quoteId}/costs`,
          },
        };
      }
    });
    return manifest;
  } finally {
    await sql.end();
  }
}

export async function resetFixtureWorld(runId: string): Promise<void> {
  assertRunId(runId);
  assertRuntimeSafety();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      const { quoteIds } = fixtureRecordIds(runId);
      // Send flows create random audit IDs and audit_log has no quote FK
      // cascade. Remove every audit tied to this deterministic fixture world.
      await tx`delete from audit_log where entity_id in ${tx(quoteIds)}`;
      for (const state of ["draft", "sent", "accepted", "failed", "complete"]) {
        await tx`delete from audit_log where id = ${uuid(runId, `audit-${state}`)}`;
        const dealId = fakeHubSpotObjectId(runId, `deal-${state}`);
        const legacyDealId = `validation_hs_deal_${runId}_${state}`;
        await tx`
          delete from projects
          where hubspot_deal_id in (${dealId}, ${legacyDealId})
        `;
        await tx`
          delete from hubspot_deals_cache
          where deal_id in (${dealId}, ${legacyDealId})
        `;
      }
      await tx`delete from netsuite_customer_map where hubspot_company_id = ${`validation_hs_company_${runId}`}`;
      for (const index of [1, 2, 3]) {
        await tx`delete from leaves where hubspot_product_id = ${`validation_hs_product_${runId}_${index}`}`;
      }
    });
  } finally {
    await sql.end();
  }
}

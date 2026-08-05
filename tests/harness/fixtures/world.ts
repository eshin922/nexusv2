import { createHash } from "node:crypto";
import postgres from "postgres";
import { assertRuntimeSafety } from "../../../src/lib/config/runtime-config.ts";

export type FixtureState = "draft" | "sent" | "accepted" | "failed" | "complete";
export type OperatorFixtureName = "oneSku" | "sixSku" | "tenSku";

type QuoteFixture = {
  projectId: string;
  quoteId: string;
  tierIds: [string, string];
  deepLinks: Record<string, string>;
};

export type FixtureManifest = {
  runId: string;
  users: { pm: string; admin: string };
  quotes: Record<FixtureState, QuoteFixture>;
  operatorQuotes: Record<OperatorFixtureName, QuoteFixture>;
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
  const operatorNames: OperatorFixtureName[] = ["oneSku", "sixSku", "tenSku"];
  return {
    projectIds: [
      ...states.map((state) => uuid(runId, `project-${state}`)),
      ...operatorNames.map((name) => uuid(runId, `project-operator-${name}`)),
    ],
    quoteIds: [
      ...states.map((state) => uuid(runId, `quote-${state}`)),
      ...operatorNames.map((name) => uuid(runId, `quote-operator-${name}`)),
    ],
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
    operatorQuotes: {},
  } as FixtureManifest;

  try {
    await sql.begin(async (tx) => {
      await tx`
          insert into users (
            id, clerk_user_id, email, name, role, hubspot_owner_id,
            can_create_leaves
          )
          values
            (${pmId}, 'validation_clerk_pm', 'pm@nexus-validation.invalid',
             'Validation PM', 'pm', 'validation_hs_owner_pm', true),
            (${adminId}, 'validation_clerk_admin', 'admin@nexus-validation.invalid',
             'Validation Admin', 'admin', 'validation_hs_owner_admin', true)
          on conflict (clerk_user_id) do update set
            email = excluded.email, name = excluded.name,
            role = excluded.role, hubspot_owner_id = excluded.hubspot_owner_id,
            can_create_leaves = excluded.can_create_leaves
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
        insert into markup_defaults (
          category, default_markup_pct, updated_by_user_id, updated_at
        ) values
          ('primary_packaging', 0.2000, ${adminId}, '2026-01-15T11:00:00Z'),
          ('Other', 0.1500, ${adminId}, '2026-01-15T11:00:00Z')
        on conflict (category) do update set
          default_markup_pct = excluded.default_markup_pct,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = excluded.updated_at
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
          const quoteLeafId = uuid(runId, `quote-leaf-${state}-${index}`);
          await tx`
            insert into quote_leaves (
              id, quote_id, assembly_id, leaf_id, quantity, position
            ) values (
              ${quoteLeafId}, ${quoteId}, ${assemblyId}, ${leafId}, 1, ${index}
            )
          `;
          await tx`
            insert into assembly_leaves (
              id, assembly_id, leaf_id, quote_leaf_id, quantity, position
            ) values (
              ${junctionId}, ${assemblyId}, ${leafId}, ${quoteLeafId}, 1, ${index}
            )
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

      // Operator-scale worksheet fixtures (PR-E). Scoped so their component
      // leaves do not collide with the governed Validation leaf identities.
      {
      const leafIds = Array.from({ length: 10 }, (_, index) =>
        uuid(runId, `leaf-operator-${index + 1}`),
      );
      const componentNames = ["Bottle", "Cap", "Sprayer", "Carton", "Label", "Pump", "Dropper", "Jar", "Lid", "Insert"];
      const componentSkus = ["BTL-100", "CAP-100", "SPR-100", "CTN-100", "LBL-100", "PMP-100", "DRP-100", "JAR-100", "LID-100", "INS-100"];
      for (const [index, leafId] of leafIds.entries()) {
        await tx`
          insert into leaves (id, name, sku, owner_id, hubspot_product_id)
          values (
            ${leafId}, ${componentNames[index]},
            ${componentSkus[index]}, ${pmId},
            ${`validation_hs_product_${runId}_operator_${index + 1}`}
          )
        `;
      }
      const operatorSpecs: Array<{
        name: OperatorFixtureName;
        skuCount: number;
        includeAirLeg: boolean;
        includeDomesticLeg: boolean;
      }> = [
        { name: "oneSku", skuCount: 1, includeAirLeg: false, includeDomesticLeg: false },
        { name: "sixSku", skuCount: 6, includeAirLeg: true, includeDomesticLeg: false },
        { name: "tenSku", skuCount: 10, includeAirLeg: true, includeDomesticLeg: true },
      ];
      for (const spec of operatorSpecs) {
        const dealId = fakeHubSpotObjectId(runId, `deal-operator-${spec.name}`);
        const projectId = uuid(runId, `project-operator-${spec.name}`);
        const quoteId = uuid(runId, `quote-operator-${spec.name}`);
        const tier1 = uuid(runId, `tier-operator-${spec.name}-1`);
        const tier2 = uuid(runId, `tier-operator-${spec.name}-2`);
        const assemblyId = uuid(runId, `assembly-operator-${spec.name}`);
        const groupId = uuid(runId, `freight-group-operator-${spec.name}`);
        const oceanLegId = uuid(runId, `freight-ocean-operator-${spec.name}`);
        const airLegId = uuid(runId, `freight-air-operator-${spec.name}`);
        const domesticLegId = uuid(runId, `freight-domestic-operator-${spec.name}`);

        await tx`
          insert into hubspot_deals_cache (
            deal_id, deal_name, deal_stage, associated_company_id,
            associated_company_name, pm_id, pm_name, pm_email, last_synced_at
          ) values (
            ${dealId}, ${`Acme Beauty ${spec.skuCount} SKU launch`},
            'closedwon', ${companyId}, 'Acme Beauty',
            'validation_hs_owner_pm', 'Cally Hou',
            'pm@nexus-validation.invalid', '2026-01-15T12:00:00Z'
          )
        `;
        await tx`
          insert into projects (
            id, hubspot_deal_id, hubspot_owner_id, deal_name, client_name,
            pm_user_id, project_category, status, deal_stage,
            imported_by_user_id, imported_at
          ) values (
            ${projectId}, ${dealId}, 'validation_hs_owner_pm',
            ${`Acme Beauty ${spec.skuCount} SKU launch`}, 'Acme Beauty',
            ${pmId}, 'turnkey', 'active', 'closedwon', ${pmId}, now()
          )
        `;
        await tx`
          insert into quotes (
            id, project_id, scenario_label, version_number, status,
            global_price_adj_pct, freight_markup_pct, created_by_user_id
          ) values (
            ${quoteId}, ${projectId}, ${`Launch assortment · ${spec.skuCount} SKUs`}, 1,
            'draft', 0, 0.3000, ${pmId}
          )
        `;
        await tx`
          insert into quote_tiers (id, quote_id, label, qty, sort_order, recommended)
          values
            (${tier1}, ${quoteId}, 'MOQ · 1,000 units', 1000, 0, false),
            (${tier2}, ${quoteId}, 'Quantity · 10,000 units', 10000, 1, true)
        `;
        await tx`
          insert into assemblies (id, quote_id, sku, name, owner_id, position)
          values (
            ${assemblyId}, ${quoteId}, ${`GLOW-KIT-${spec.skuCount}`},
            ${`Glow Serum Launch Kit · ${spec.skuCount} SKUs`}, ${pmId}, 0
          )
        `;

        const operatorQuoteLeafIds: string[] = [];
        const operatorJunctionIds: string[] = [];
        for (const [index, leafId] of leafIds.slice(0, spec.skuCount).entries()) {
          const quoteLeafId = uuid(runId, `quote-leaf-operator-${spec.name}-${index}`);
          const junctionId = uuid(runId, `junction-operator-${spec.name}-${index}`);
          operatorQuoteLeafIds.push(quoteLeafId);
          operatorJunctionIds.push(junctionId);
          await tx`
            insert into quote_leaves (id, quote_id, assembly_id, leaf_id, quantity, position)
            values (${quoteLeafId}, ${quoteId}, ${assemblyId}, ${leafId}, 1, ${index})
          `;
          await tx`
            insert into assembly_leaves (
              id, assembly_id, leaf_id, quote_leaf_id, quantity, position
            ) values (${junctionId}, ${assemblyId}, ${leafId}, ${quoteLeafId}, 1, ${index})
          `;
          for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
            await tx`
              insert into assembly_leaf_inputs (
                id, assembly_leaf_id, tier_id, line_group_id, supplier,
                qty_per_sellable_unit, category, markup_pct,
                markup_pct_source, unit_cost, purchase_qty
              ) values (
                ${uuid(runId, `input-operator-${spec.name}-${index}-${tierIndex}`)},
                ${junctionId}, ${tierId},
                ${uuid(runId, `line-operator-${spec.name}-${index}`)},
                'Pacific Components', 1, 'primary_packaging', 0.20,
                'manual_override', ${(index + 1) / 10},
                ${tierIndex === 0 ? 1000 : 10000}
              )
            `;
          }
        }

        await tx`
          insert into freight_leg_groups (id, quote_id, label, display_order)
          values (${groupId}, ${quoteId}, 'Outbound shipment · China to U.S.', 0)
        `;
        await tx`
          insert into freight_legs (
            id, leg_group_id, direction, label, origin, destination,
            treatment, mode, carrier, incoterm, cargo_ready_date,
            vessel_etd, vessel_eta, display_order
          ) values (
            ${oceanLegId}, ${groupId}, 'outbound', 'Ocean container · main shipment',
            'Ningbo, China', 'Long Beach, CA', 'bundled', 'ocean_fcl',
            'Maersk', 'FOB', '2026-09-01', '2026-09-05', '2026-09-24', 0
          )
        `;
        if (spec.includeAirLeg) {
          await tx`
            insert into freight_legs (
              id, leg_group_id, direction, label, origin, destination,
              treatment, mode, carrier, incoterm, cargo_ready_date,
              vessel_etd, vessel_eta, display_order
            ) values (
              ${airLegId}, ${groupId}, 'outbound', 'Air freight · split shipment',
              'Shenzhen, China', 'Los Angeles, CA', 'bundled', 'air_freight',
              'Cathay Cargo', 'DAP', '2026-08-25', '2026-08-27', '2026-08-29', 1
            )
          `;
        }
        if (spec.includeDomesticLeg) {
          await tx`
            insert into freight_legs (
              id, leg_group_id, direction, label, origin, destination,
              treatment, mode, carrier, incoterm, cargo_ready_date,
              vessel_etd, vessel_eta, display_order
            ) values (
              ${domesticLegId}, ${groupId}, 'outbound', 'Domestic transfer · ocean arrival',
              'Long Beach, CA', 'Dallas, TX', 'bundled', 'truckload',
              'J.B. Hunt', 'DAP', '2026-09-24', '2026-09-25', '2026-09-29', 2
            )
          `;
        }
        const legIds = [
          oceanLegId,
          ...(spec.includeAirLeg ? [airLegId] : []),
          ...(spec.includeDomesticLeg ? [domesticLegId] : []),
        ];
        for (const legId of legIds) {
          await tx`
            insert into freight_leg_tiers (freight_leg_id, tier_id, total_freight)
            values (${legId}, ${tier1}, null), (${legId}, ${tier2}, null)
          `;
        }
        for (const [leafIndex, quoteLeafId] of operatorQuoteLeafIds.entries()) {
          for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
            await tx`
              insert into freight_leg_component_tier_costs (
                freight_leg_id, quote_leaf_id, tier_id, actual_freight_cost
              ) values (
                ${oceanLegId}, ${quoteLeafId}, ${tierId},
                ${(leafIndex + 1) * (tierIndex + 1) * 125}
              )
            `;
          }
        }
        if (spec.includeAirLeg) {
          for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
            await tx`
              insert into freight_leg_component_tier_costs (
                freight_leg_id, quote_leaf_id, tier_id, actual_freight_cost
              ) values (
                ${airLegId}, ${operatorQuoteLeafIds[0]}, ${tierId},
                ${(tierIndex + 1) * 450}
              )
            `;
          }
        }
        if (spec.includeDomesticLeg) {
          for (const [leafIndex, quoteLeafId] of operatorQuoteLeafIds.slice(0, 3).entries()) {
            for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
              await tx`
                insert into freight_leg_component_tier_costs (
                  freight_leg_id, quote_leaf_id, tier_id, actual_freight_cost
                ) values (
                  ${domesticLegId}, ${quoteLeafId}, ${tierId},
                  ${(leafIndex + 1) * (tierIndex + 1) * 85}
                )
              `;
            }
          }
        }

        // Approved worksheet authority. Legacy rows above remain only as
        // transition evidence and are suppressed by costing whenever these
        // selected worksheet breaks exist.
        const shipmentSpecs = [
          { key: "ocean", label: "Packaging from overseas · ocean container", origin: "Ningbo, China", selected: "Long Beach, CA", comparison: "Houston, TX", mode: "ocean_fcl", carrier: "Straight Forwarding", members: operatorJunctionIds, border: true },
          ...(spec.includeAirLeg ? [{ key: "air", label: "Launch stock · split air shipment", origin: "Shenzhen, China", selected: "Los Angeles, CA", comparison: "Dallas, TX", mode: "air_freight", carrier: "Cathay Cargo", members: operatorJunctionIds.slice(0, Math.min(2, operatorJunctionIds.length)), border: true }] : []),
          ...(spec.includeDomesticLeg ? [{ key: "domestic", label: "Ocean arrival · domestic transfer", origin: "Long Beach, CA", selected: "Dallas, TX", comparison: "Chicago, IL", mode: "truckload", carrier: "J.B. Hunt", members: operatorJunctionIds.slice(0, 3), border: false }] : []),
        ];
        for (const [shipmentIndex, shipment] of shipmentSpecs.entries()) {
          const subcategoryId = uuid(runId, `worksheet-subcategory-${spec.name}-${shipment.key}`);
          const selectedDestinationId = uuid(runId, `worksheet-destination-selected-${spec.name}-${shipment.key}`);
          const comparisonDestinationId = uuid(runId, `worksheet-destination-comparison-${spec.name}-${shipment.key}`);
          await tx`
            insert into freight_subcategories (
              id, quote_id, assembly_id, label, origin, carrier_forwarder,
              incoterm, cargo_ready_date, treatment, crosses_international_border,
              display_order, source, field_provenance
            ) values (
              ${subcategoryId}, ${quoteId}, ${assemblyId}, ${shipment.label},
              ${shipment.origin}, ${shipment.carrier}, 'FOB', '2026-09-01',
              'bundled', ${shipment.border}, ${shipmentIndex}, 'manual',
              ${tx.json({ fixture: "operator worksheet" })}
            )
          `;
          for (const memberId of shipment.members) await tx`
            insert into freight_subcategory_items (freight_subcategory_id, assembly_leaf_id, source, field_provenance)
            values (${subcategoryId}, ${memberId}, 'manual', ${tx.json({ fixture: "shipment membership" })})
          `;
          await tx`
            insert into freight_destinations (
              id, freight_subcategory_id, destination, consignee, transit_days,
              quote_reference, internal_notes, display_order, same_value_all_breaks, source, field_provenance
            ) values
              (${selectedDestinationId}, ${subcategoryId}, ${shipment.selected}, 'Acme Beauty DC', '22–28 days', 'SF-SELECTED-001', 'Selected by Logistics for schedule and total cost.', 0, false, 'manual', ${tx.json({ fixture: "selected option" })}),
              (${comparisonDestinationId}, ${subcategoryId}, ${shipment.comparison}, 'Alternate DC', '30–36 days', 'SF-COMPARE-002', 'Retained as forwarder comparison evidence.', 1, false, 'manual', ${tx.json({ fixture: "comparison option" })})
          `;
          await tx`update freight_subcategories set selected_destination_id = ${selectedDestinationId}, selection_reason = 'Best confirmed schedule and commercial result.' where id = ${subcategoryId}`;
          for (const [tierIndex, tierId] of [tier1, tier2].entries()) {
            const selectedAmount = 4200 + shipmentIndex * 1500 + tierIndex * 900;
            await tx`
              insert into freight_destination_breaks (
                freight_destination_id, tier_id, freight_amount, freight_markup_pct,
                mode, shipment_note, source, field_provenance
              ) values
                (${selectedDestinationId}, ${tierId}, ${selectedAmount}, 0.30, ${shipment.mode}, 'Confirmed forwarder amount.', 'manual', ${tx.json({ fixture: "confirmed break" })}),
                (${comparisonDestinationId}, ${tierId}, ${selectedAmount + 725}, 0.30, ${shipment.mode}, 'Comparison amount; not commercially selected.', 'manual', ${tx.json({ fixture: "comparison break" })})
            `;
          }
          if (shipment.border) {
            const customsEntryId = uuid(runId, `worksheet-customs-${spec.name}-${shipment.key}`);
            await tx`
              insert into freight_customs_entries (
                id, freight_subcategory_id, source_mode, invoice_reference,
                entry_description, source, field_provenance
              ) values (${customsEntryId}, ${subcategoryId}, 'invoice', 'CI-2026-001', 'Customs entry supplied by Logistics.', 'manual', ${tx.json({ fixture: "customs entry" })})
            `;
            for (const [tierIndex, tierId] of [tier1, tier2].entries()) await tx`
              insert into freight_customs_breaks (
                freight_customs_entry_id, tier_id, charge_type, amount,
                markup_pct, detail, source, field_provenance
              ) values
                (${customsEntryId}, ${tierId}, 'duty', ${650 + tierIndex * 120}, 0.10, 'Duty supplied for this customs entry.', 'manual', ${tx.json({ fixture: "duty" })}),
                (${customsEntryId}, ${tierId}, 'tariff', ${325 + tierIndex * 80}, 0.10, 'Tariff supplied for this customs entry.', 'manual', ${tx.json({ fixture: "tariff" })})
            `;
          }
          await tx`
            insert into freight_destination_tracking (
              freight_destination_id, etd, eta, actual_delivery_date, source, field_provenance
            ) values (${selectedDestinationId}, '2026-09-05', '2026-09-28', null, 'manual', ${tx.json({ fixture: "selected tracking" })})
          `;
        }

        manifest.operatorQuotes[spec.name] = {
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
      // Markup pins intentionally RESTRICT canonical attachments and tiers.
      // Remove their Quote-scoped parent first so fixture reset can cascade the
      // rest of the graph without weakening the production integrity FKs.
      await tx`
        delete from quote_commercial_settings_pins
        where quote_id in ${tx(quoteIds)}
      `;
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
      for (const name of ["oneSku", "sixSku", "tenSku"] as const) {
        const dealId = fakeHubSpotObjectId(runId, `deal-operator-${name}`);
        await tx`delete from projects where id = ${uuid(runId, `project-operator-${name}`)}`;
        await tx`delete from hubspot_deals_cache where deal_id = ${dealId}`;
      }
      await tx`delete from netsuite_customer_map where hubspot_company_id = ${`validation_hs_company_${runId}`}`;
      for (const index of [1, 2, 3]) {
        await tx`delete from leaves where hubspot_product_id = ${`validation_hs_product_${runId}_${index}`}`;
      }
      // Operator-scale worksheet leaves carry a distinct product-id
      // namespace so they cannot collide with the governed Validation
      // leaf identities. Both sets must be cleared for a clean reseed.
      for (const index of Array.from({ length: 10 }, (_, i) => i + 1)) {
        await tx`delete from leaves where hubspot_product_id = ${`validation_hs_product_${runId}_operator_${index}`}`;
      }
    });
  } finally {
    await sql.end();
  }
}

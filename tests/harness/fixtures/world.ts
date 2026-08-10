import { createHash } from "node:crypto";
import postgres from "postgres";
import { assertRuntimeSafety } from "../../../src/lib/config/runtime-config.ts";

export type FixtureState = "draft" | "sent" | "accepted" | "failed" | "complete";

/**
 * Fixture isolation rule (2026-08-10, VAL-208).
 *
 * A scenario that destructively advances lifecycle state must not share that
 * mutable entity with scenarios that require its PRIOR lifecycle state.
 *
 * `sendable` is a second draft quote, seeded identically to `draft`, owned by
 * primary-send-lifecycle -- which sends it. `draft` therefore stays draft for
 * everyone else. The name is the fixture identity; the lifecycle it is seeded
 * at is a separate axis, which is why the two are different types.
 *
 * Scheduling is NOT the fix. `workers: 1` serialises within a Playwright
 * project and never between them, so costing-serial and lifecycle-serial run
 * concurrently against one database. Serialising them would hide the sharing
 * rather than remove it.
 */
export type FixtureQuoteName = FixtureState | "sendable";
const QUOTE_FIXTURE_NAMES: FixtureQuoteName[] = ["draft", "sent", "accepted", "failed", "complete", "sendable"];
const quoteLifecycle = (name: FixtureQuoteName): FixtureState =>
  name === "sendable" ? "draft" : name;
export type OperatorFixtureName =
  | "oneSku"
  | "sixSku"
  | "tenSku"
  | "r3Volume"
  | "r12Visual";

type QuoteFixture = {
  projectId: string;
  quoteId: string;
  /** The first two tiers. Kept a 2-tuple so existing specs are undisturbed. */
  tierIds: [string, string];
  /** Every tier, in sort order. `r3Volume` has four; the others have two. */
  allTierIds: string[];
  deepLinks: Record<string, string>;
};

export type FixtureManifest = {
  runId: string;
  users: { pm: string; admin: string };
  quotes: Record<FixtureQuoteName, QuoteFixture>;
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

/**
 * The operator fixtures, in one place.
 *
 * It was a literal repeated in three, and the reset's copy went stale the
 * moment a fifth fixture landed: the new project was never deleted, so the
 * next reseed died deleting shared leaves it still referenced. A list that
 * has to be updated in three files is a list that will be updated in two.
 */
export const OPERATOR_FIXTURE_NAMES: readonly OperatorFixtureName[] = [
  "oneSku",
  "sixSku",
  "tenSku",
  "r3Volume",
  "r12Visual",
];

export function fixtureRecordIds(runId: string) {
  const states = QUOTE_FIXTURE_NAMES;
  const operatorNames = OPERATOR_FIXTURE_NAMES;
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
  const states = QUOTE_FIXTURE_NAMES;
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

      for (const name of states) {
        const state = quoteLifecycle(name);
        const dealId = fakeHubSpotObjectId(runId, `deal-${name}`);
        const projectId = uuid(runId, `project-${name}`);
        const quoteId = uuid(runId, `quote-${name}`);
        const tier1 = uuid(runId, `tier-${name}-1`);
        const tier2 = uuid(runId, `tier-${name}-2`);
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
            ${dealId}, ${`Validation ${name} deal`}, 'validation_stage_sent',
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
            ${`Validation ${name} deal`}, 'Validation Customer',
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
            ${quoteId}, ${projectId}, ${`Validation ${name}`}, 1, ${complete ? "complete" : state === "failed" ? "accepted" : state},
            ${sent ? "2026-01-15T12:00:00Z" : null},
            ${accepted ? "2026-01-15T13:00:00Z" : null},
            ${accepted ? pmId : null}, ${accepted ? "manual_button" : null},
            ${accepted ? "email" : null}, ${sent ? `VAL-${runId}-${name}` : null},
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

        const assemblyId = uuid(runId, `assembly-${name}`);
        await tx`
          insert into assemblies (id, quote_id, sku, name, owner_id, position)
          values (
            ${assemblyId}, ${quoteId}, ${`VAL-ASY-${runId}-${name}`},
            ${`Validation ${name} assembly`}, ${pmId}, 0
          )
        `;
        for (const [index, leafId] of leafIds.entries()) {
          const junctionId = uuid(runId, `junction-${name}-${index}`);
          const quoteLeafId = uuid(runId, `quote-leaf-${name}-${index}`);
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
                ${uuid(runId, `input-${name}-${index}-${tierIndex}`)},
                ${junctionId}, ${tierId},
                ${uuid(runId, `line-${name}-${index}`)},
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
              ${uuid(runId, `snapshot-${name}`)}, ${quoteId}, 1,
              '2026-01-15T12:00:00Z', '2026-01-15T12:00:00Z',
              '2026-02-14', ${`VAL-${runId}-${name}`}, 'Validation Net 30',
              'Validation 4 weeks', 'Validation FOB', 30, 'Validation Owner',
              'owner@nexus-validation.invalid', 'tier_table', 'itemized',
              false, ${pmId}
            )
          `;
          await tx`
            insert into quote_review_events (
              id, quote_id, version_number, event_type, note, system
            ) values (
              ${uuid(runId, `review-${name}`)}, ${quoteId}, 1, 'sent',
              'Sent by deterministic validation fixture.', true
            )
          `;
          await tx`
            insert into audit_log (
              id, user_id, entity_type, entity_id, action, diff_json,
              actor_user_id, actor_display_name, actor_kind
            ) values (
              ${uuid(runId, `audit-${name}`)}, ${pmId}, 'quote', ${quoteId},
              'quote_sent', ${tx.json({ fixtureRunId: runId, state: name })},
              ${pmId}, 'Validation PM', 'human'
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
              ${uuid(runId, `push-${name}`)}, ${quoteId}, ${tier2},
              ${complete ? "succeeded" : "failed"},
              ${complete ? `validation_ns_so_${runId}` : null},
              ${complete ? `VSO-${runId}` : null}, 1000,
              ${`validation_idempotency_${runId}_${name}`},
              ${complete ? null : "validation_failure"},
              ${complete ? null : "Injected validation failure"},
              ${tx.json({ fixtureRunId: runId })}, ${pmId},
              '2026-01-15T14:00:00Z'
            )
          `;
        }

        manifest.quotes[name] = {
          projectId,
          quoteId,
          tierIds: [tier1, tier2],
          allTierIds: [tier1, tier2],
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
        /** Defaults to 2. R3's rehearsal contract requires four. */
        tierCount?: number;
        includeAirLeg: boolean;
        includeDomesticLeg: boolean;
        /**
         * Per-SKU packaging markup. Absent means the historical flat 0.20.
         *
         * `r3Volume` varies it so the quote carries BOTH compliant and
         * below-floor cells: R3 needs a genuine lift case, and the
         * selectable-vs-actionable split needs a compliant cell that is
         * pressable while offering no remediation. A quote where every cell
         * breaches proves neither.
         */
        markupByIndex?: (index: number) => number;
        /** A cell carrying a persisted direct price, so replacement is testable. */
        overrideAt?: { skuIndex: number; tierIndex: number; price: number };
        /**
         * Client targets, PER SKU — the benchmark does not vary by tier (R12
         * §13), so this is a per-row fact and the comparison happens per cell.
         *
         * Deliberately partial: a SKU without one must render NO chip and NO
         * markers, and "absence costs nothing because there is nothing to leave
         * blank" is only verifiable against a fixture where some rows lack it.
         */
        clientTargetAt?: Array<{ skuIndex: number; price: number }>;
        /** A persisted applied lift, so the LIFTED badge and its attribution render. */
        liftAt?: { skuIndex: number; tierIndex: number; pct: number };
        /** A quote-wide adjustment already in effect, for the APPLIED bar. */
        globalAdjPct?: number;
        /**
         * Write audit rows for the seeded adjustments.
         *
         * Provenance is READ from the audit trail, never synthesised, so a
         * fixture that seeds a lift without its audit row renders an
         * unattributed one — correct behaviour, but it makes the sourced
         * treatment unverifiable. Pattern 53: the fixture writes what the real
         * action writes.
         */
        seedProvenance?: boolean;
      }> = [
        { name: "oneSku", skuCount: 1, includeAirLeg: false, includeDomesticLeg: false },
        { name: "sixSku", skuCount: 6, includeAirLeg: true, includeDomesticLeg: false },
        { name: "tenSku", skuCount: 10, includeAirLeg: true, includeDomesticLeg: true },
        {
          // R3 · staged-versus-committed at production shape.
          // 6 SKUs x 4 tiers = 24 cells, inside the specification's 5-7 x 4.
          name: "r3Volume",
          skuCount: 6,
          tierCount: 4,
          includeAirLeg: true,
          includeDomesticLeg: false,
          // Index 0 lands well below the 25% floor; the rest clear the 35%
          // target. Chosen as INPUTS — the engine decides the margins, and the
          // rehearsal asserts what it produces rather than what was intended.
          markupByIndex: (index) => (index === 0 ? 0.2 : 0.9),
          // On a different SKU from the below-floor one, so the replacement
          // case and the lift case never contend for the same cell.
          overrideAt: { skuIndex: 2, tierIndex: 1, price: 12.5 },
        },
        {
          /**
           * R12 · the visual acceptance fixture.
           *
           * ONE quote that carries every presentation state at once, because
           * the states interact: a client-target marker sits beside a `needs
           * N%` chip on one cell and beside a `LIFTED` badge on another, and
           * the question the sweep asks is whether they read together — which
           * a fixture exercising them one at a time cannot answer.
           *
           * PERMANENT. Not a walk-scoped scratch quote: the density and
           * spacing it was accepted at are the density and spacing a future
           * change has to be compared against.
           *
           *   6 SKUs x 4 tiers   the production shape
           *   below-floor cells  SKU 0 at 0.2 markup, breaching on every tier
           *   applied lift       SKU 1 T1, persisted, with its audit row
           *   direct price       SKU 2 T2, persisted
           *   client targets     SKUs 0 and 3 only — 4 of 6 rows carry none
           *   quote-wide adj     already in effect, so the APPLIED bar renders
           *   worksheet freight  inherited from the shared seeding below
           */
          name: "r12Visual",
          skuCount: 6,
          tierCount: 4,
          includeAirLeg: true,
          includeDomesticLeg: true,
          markupByIndex: (index) => (index === 0 ? 0.2 : index === 1 ? 0.28 : 0.9),
          overrideAt: { skuIndex: 2, tierIndex: 1, price: 12.5 },
          // One target BELOW the computed price and one ABOVE it, so both
          // directions of the marker render on one screen. The values are
          // chosen relative to the seeded costs, not to a desired output.
          clientTargetAt: [
            { skuIndex: 0, price: 12.0 },
            { skuIndex: 3, price: 4.5 },
          ],
          liftAt: { skuIndex: 1, tierIndex: 0, pct: 0.06 },
          globalAdjPct: 0.02,
          seedProvenance: true,
        },
      ];
      for (const spec of operatorSpecs) {
        const dealId = fakeHubSpotObjectId(runId, `deal-operator-${spec.name}`);
        const projectId = uuid(runId, `project-operator-${spec.name}`);
        const quoteId = uuid(runId, `quote-operator-${spec.name}`);
        const tierCount = spec.tierCount ?? 2;
        const tierIdList = Array.from({ length: tierCount }, (_, i) =>
          uuid(runId, `tier-operator-${spec.name}-${i + 1}`),
        );
        const [tier1, tier2] = tierIdList;
        // Quantities climb per tier so the blend genuinely differs across them.
        const tierQtys = [1000, 10_000, 25_000, 50_000];
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
        for (const [tierIndex, tierId] of tierIdList.entries()) {
          const qty = tierQtys[tierIndex] ?? (tierIndex + 1) * 10_000;
          await tx`
            insert into quote_tiers (id, quote_id, label, qty, sort_order, recommended)
            values (
              ${tierId}, ${quoteId},
              ${tierIndex === 0 ? "MOQ · 1,000 units" : `Quantity · ${qty.toLocaleString("en-US")} units`},
              ${qty}, ${tierIndex}, ${tierIndex === 1}
            )
          `;
        }
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
          const markupPct = spec.markupByIndex?.(index) ?? 0.2;
          for (const [tierIndex, tierId] of tierIdList.entries()) {
            await tx`
              insert into assembly_leaf_inputs (
                id, assembly_leaf_id, tier_id, line_group_id, supplier,
                qty_per_sellable_unit, category, markup_pct,
                markup_pct_source, unit_cost, purchase_qty
              ) values (
                ${uuid(runId, `input-operator-${spec.name}-${index}-${tierIndex}`)},
                ${junctionId}, ${tierId},
                ${uuid(runId, `line-operator-${spec.name}-${index}`)},
                'Pacific Components', 1, 'primary_packaging', ${markupPct},
                'manual_override', ${(index + 1) / 10},
                ${tierQtys[tierIndex] ?? 10_000}
              )
            `;
          }
        }

        // A PERSISTED direct price, so staged-override REPLACEMENT can be
        // exercised through the real path. No production quote carries one, so
        // browser-verifying replacement was impossible without this row.
        if (spec.overrideAt) {
          const target = operatorJunctionIds[spec.overrideAt.skuIndex];
          const targetTier = tierIdList[spec.overrideAt.tierIndex];
          if (target && targetTier) {
            await tx`
              insert into assembly_leaf_overrides (
                assembly_leaf_id, tier_id, sell_price_override
              ) values (${target}, ${targetTier}, ${spec.overrideAt.price})
            `;
          }
        }

        // Client targets — per (leaf, tier) in storage, per SKU in meaning.
        // Written across EVERY tier because the table is keyed per cell while
        // the benchmark is a row fact; the grid states it once and compares it
        // per cell, which is exactly the dimensional split §13 describes.
        for (const t of spec.clientTargetAt ?? []) {
          const leaf = operatorJunctionIds[t.skuIndex];
          if (!leaf) continue;
          for (const tierId of tierIdList) {
            await tx`
              insert into assembly_leaf_targets (
                assembly_leaf_id, tier_id, client_target_price_per_unit
              ) values (${leaf}, ${tierId}, ${t.price})
            `;
          }
        }

        // A persisted applied lift, keyed CANONICALLY — the table is
        // `quote_leaf_lifts`, so this is a quote_leaf id, not the junction one
        // the two rows above use.
        if (spec.liftAt) {
          const canonical = operatorQuoteLeafIds[spec.liftAt.skuIndex];
          const tierId = tierIdList[spec.liftAt.tierIndex];
          if (canonical && tierId) {
            await tx`
              insert into quote_leaf_lifts (quote_leaf_id, tier_id, lift_pct)
              values (${canonical}, ${tierId}, ${spec.liftAt.pct})
            `;
          }
        }

        if (spec.globalAdjPct !== undefined) {
          await tx`
            update quotes set global_price_adj_pct = ${spec.globalAdjPct}
            where id = ${quoteId}
          `;
        }

        // Audit rows for what was just seeded.
        //
        // Provenance is read from the audit trail and never synthesised, so a
        // seeded adjustment without its row renders unattributed — correct, but
        // it leaves the SOURCED treatment unverifiable. These are the rows the
        // real actions write, with the same action names and entity ids.
        if (spec.seedProvenance) {
          const rows: Array<[string, string, string]> = [];
          if (spec.liftAt) {
            const canonical = operatorQuoteLeafIds[spec.liftAt.skuIndex];
            const tierId = tierIdList[spec.liftAt.tierIndex];
            if (canonical && tierId) {
              rows.push([
                "quote_leaf_lift",
                `${canonical}:${tierId}`,
                "pricing_lift_applied",
              ]);
            }
          }
          if (spec.overrideAt) {
            const leaf = operatorJunctionIds[spec.overrideAt.skuIndex];
            const tierId = tierIdList[spec.overrideAt.tierIndex];
            if (leaf && tierId) {
              rows.push([
                "assembly_leaf_override",
                `${leaf}:${tierId}`,
                "assembly_leaf_sell_override_updated",
              ]);
            }
          }
          if (spec.globalAdjPct !== undefined) {
            rows.push(["quote", quoteId, "global_price_adj_updated"]);
          }
          for (const [entityType, entityId, action] of rows) {
            await tx`
              insert into audit_log (
                user_id, actor_user_id, actor_display_name, actor_kind,
                entity_type, entity_id, action, diff_json
              ) values (
                ${pmId}, ${pmId}, 'Validation PM', 'human',
                ${entityType}, ${entityId}, ${action}, '{}'::jsonb
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
          for (const [tierIndex, tierId] of tierIdList.entries()) {
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
          for (const [tierIndex, tierId] of tierIdList.entries()) {
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
            for (const [tierIndex, tierId] of tierIdList.entries()) {
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
          for (const [tierIndex, tierId] of tierIdList.entries()) {
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
            for (const [tierIndex, tierId] of tierIdList.entries()) await tx`
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
          allTierIds: tierIdList,
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
      for (const state of QUOTE_FIXTURE_NAMES) {
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
      for (const name of OPERATOR_FIXTURE_NAMES) {
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

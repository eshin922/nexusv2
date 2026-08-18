"use server";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  // Slice 11.5 — NEW-model cost-data tables (Step 2 schema).
  assemblies,
  assemblyLeafInputs,
  assemblyLeafOverrides,
  quoteClientTargets,
  assemblyLeaves,
  assemblyProductionInputs,
  auditLog,
  freightCustomerArrangesMeta,
  freightLegComponentTierCosts,
  freightCustomsBreaks,
  freightCustomsEntries,
  freightDestinationBreaks,
  freightDestinations,
  freightLegGroups,
  freightLegs,
  freightLegTiers,
  freightSubcategories,
  freightSubcategoryItems,
  leaves,
  quotes,
  quoteLeafLifts,
  quoteLeaves,
  quoteSnapshotFreightInputs,
  quoteSnapshotFreightWorkbooks,
  quoteSnapshots,
  quoteTiers,
  quoteWarnings,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  quoteByIdDraft,
  quoteForQuoteLeaf,
} from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  computeQuoteCosting,
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";
import { resolveQuoteCommercialSettings } from "@/lib/commercial-settings";
import type { CommercialSettingsResolution } from "@/lib/commercial-settings-contract";
import { buildQuoteCostingInputFromNewModel } from "@/lib/costing-adapter";
import { loadShipmentMemberAnchors, type FreightWorkbook } from "@/lib/freight-workbook";
import { resolveLegacyFreightAttribution } from "@/lib/freight-legacy-attribution";
import type { HydrateSnapshot } from "@/lib/costing-store";
import {
  parseMarginPercent,
  parsePercentDisplay,
  parsePositivePrice,
} from "@/lib/numeric-input";

// ---------- helpers ----------

type Diff = Record<string, { from: unknown; to: unknown }>;

// Prod-hang investigation hotfix (2026-06-17 follow-on to
// `hotfix/db-timeout-prod-hang`). The statement_timeout in
// src/db/index.ts fires at 8s but doesn't tell us WHICH query
// in getCostingBundle is slow. `timed()` wraps a promise with
// wall-clock timing + structured log output (Vercel captures
// console.log). Grep-friendly tag: `[bundle:NAME q=<short>] Nms`.
//
// Goal: identify the suspect query so EXPLAIN ANALYZE can run
// on Supabase against the exact shape. Once a culprit is found
// (missing index? bad join order? bloated table?), this
// instrumentation can stay as a permanent safety net or be
// stripped — TBD on Edward's preference.
//
// Overhead per call: ~microseconds. No-op when production traffic
// resolves fast. Safe to ship.
function timed<T>(name: string, quoteId: string, p: Promise<T>): Promise<T> {
  const t0 = Date.now();
  const tag = quoteId.slice(0, 8);
  return p.then(
    (r) => {
      const dt = Date.now() - t0;
      // Threshold log filter: only emit when query takes >100ms.
      // Vercel logs are noisy enough; sub-100ms queries aren't the
      // suspects we're hunting. Threshold tunable if the suspect
      // sits below it (statement_timeout = 8000ms so we're well
      // clear at 100ms).
      if (dt >= 100) {
        console.log(`[bundle:${name} q=${tag}] ${dt}ms`);
      }
      return r;
    },
    (e) => {
      const dt = Date.now() - t0;
      console.log(
        `[bundle:${name} q=${tag}] FAIL after ${dt}ms: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw e;
    },
  );
}

/**
 * Delegates to the single audit writer (src/lib/audit.ts). Kept as a local
 * alias so call sites in this file are unchanged -- the sweep changes how audit
 * rows are written, never what an action means or when it emits.
 */
async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await writeAuditEntry(args);
}

// PostgreSQL numeric returns canonical strings ("0.4000"); form values
// arrive shorter ("0.4"). Compare numerically to avoid spurious diffs.
function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function num(v: string | null, fallback = 0): number {
  return numOrNull(v) ?? fallback;
}

// Slice R6.2 — shared loader for the multi-leg journey freight model.
// Returns four arrays in DB-shape order (groups → legs → leg-tiers →
// customer-arranges-meta) plus the math-input projections the
// computeQuoteCosting / HydrateSnapshot consumers expect. All three
// freight-loading call sites in this file go through this helper.
async function loadFreightForQuote(quoteId: string): Promise<{
  legGroupRows: Array<typeof freightLegGroups.$inferSelect>;
  legRows: Array<typeof freightLegs.$inferSelect>;
  legTierRows: Array<typeof freightLegTiers.$inferSelect>;
  custMetaRows: Array<typeof freightCustomerArrangesMeta.$inferSelect>;
  componentCostRows: Array<{
    freightLegId: string;
    quoteLeafId: string;
    tierId: string;
    actualFreightCost: string | null;
    effectiveUnits?: number;
  }>;
}> {
  const [lifecycle] = await db
    .select({ status: quotes.status, snapshotId: quoteSnapshots.id })
    .from(quotes)
    .leftJoin(
      quoteSnapshots,
      and(
        eq(quoteSnapshots.quoteId, quotes.id),
        isNull(quoteSnapshots.supersededAt),
      ),
    )
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!lifecycle) throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
  // OD-023 · `superseded_at IS NULL` here means THE CURRENT VERSION, and that
  // is now the correct reading rather than an unexamined default.
  //
  // This path feeds the internal Costs and Pricing surfaces, which ask "what is
  // the state of this quote", and for a sent quote the answer is its current
  // sent version. It no longer feeds the CUSTOMER artifact: a sent quote's
  // customer output is read from its frozen representation by
  // `readQuoteVersion`, which addresses a version explicitly and can therefore
  // reach a superseded one. That is where historical addressing belongs, and
  // why this predicate is allowed to stay.
  const useSnapshot = lifecycle.status !== "draft" && lifecycle.snapshotId;
  const componentCostPromise: Promise<Array<{
    freightLegId: string;
    quoteLeafId: string;
    tierId: string;
    actualFreightCost: string | null;
    effectiveUnits?: number;
  }>> = useSnapshot
    ? db
        .select({ input: quoteSnapshotFreightInputs })
        .from(quoteSnapshotFreightInputs)
        .where(eq(quoteSnapshotFreightInputs.quoteSnapshotId, lifecycle.snapshotId!))
        .then((rows) => rows.map(({ input }) => ({
          freightLegId: input.sourceFreightLegId,
          quoteLeafId: input.sourceQuoteLeafId,
          tierId: input.sourceTierId,
          actualFreightCost: input.actualFreightCost,
          effectiveUnits: input.effectiveUnits,
        })))
    : db
        .select({ cost: freightLegComponentTierCosts })
        .from(freightLegComponentTierCosts)
        .innerJoin(quoteLeaves, eq(quoteLeaves.id, freightLegComponentTierCosts.quoteLeafId))
        .where(eq(quoteLeaves.quoteId, quoteId))
        .then((rows) => rows.map(({ cost }) => ({
          freightLegId: cost.freightLegId,
          quoteLeafId: cost.quoteLeafId,
          tierId: cost.tierId,
          actualFreightCost: cost.actualFreightCost,
        })));
  const [legGroupRows, legJoinRows, legTierJoinRows, metaJoinRows, componentCostRows] =
    await Promise.all([
      timed("freight.groups", quoteId, db
        .select()
        .from(freightLegGroups)
        .where(eq(freightLegGroups.quoteId, quoteId))
        .orderBy(asc(freightLegGroups.displayOrder))),
      timed("freight.legs", quoteId, db
        .select({ freight_legs: freightLegs })
        .from(freightLegs)
        .innerJoin(
          freightLegGroups,
          eq(freightLegGroups.id, freightLegs.legGroupId),
        )
        .where(eq(freightLegGroups.quoteId, quoteId))
        .orderBy(asc(freightLegs.displayOrder))),
      timed("freight.leg_tiers", quoteId, db
        .select({ freight_leg_tiers: freightLegTiers })
        .from(freightLegTiers)
        .innerJoin(
          freightLegs,
          eq(freightLegs.id, freightLegTiers.freightLegId),
        )
        .innerJoin(
          freightLegGroups,
          eq(freightLegGroups.id, freightLegs.legGroupId),
        )
        .where(eq(freightLegGroups.quoteId, quoteId))),
      timed("freight.cust_meta", quoteId, db
        .select({
          freight_customer_arranges_meta: freightCustomerArrangesMeta,
        })
        .from(freightCustomerArrangesMeta)
        .innerJoin(
          freightLegs,
          eq(freightLegs.id, freightCustomerArrangesMeta.freightLegId),
        )
        .innerJoin(
          freightLegGroups,
          eq(freightLegGroups.id, freightLegs.legGroupId),
        )
        .where(eq(freightLegGroups.quoteId, quoteId))),
      timed("freight.component_costs", quoteId, componentCostPromise),
    ]);
  return {
    legGroupRows,
    legRows: legJoinRows.map((r) => r.freight_legs),
    legTierRows: legTierJoinRows.map((r) => r.freight_leg_tiers),
    custMetaRows: metaJoinRows.map((r) => r.freight_customer_arranges_meta),
    componentCostRows,
  };
}

// Project DB rows into the math-input shape (CostingFreightLeg*).
// Pure projection; no DB access. Used by all three call sites.
function projectFreightInputs(args: {
  legGroupRows: Array<typeof freightLegGroups.$inferSelect>;
  legRows: Array<typeof freightLegs.$inferSelect>;
  legTierRows: Array<typeof freightLegTiers.$inferSelect>;
  custMetaRows: Array<typeof freightCustomerArrangesMeta.$inferSelect>;
  componentCostRows: Array<{
    freightLegId: string;
    quoteLeafId: string;
    tierId: string;
    actualFreightCost: string | null;
    effectiveUnits?: number;
  }>;
}): {
  freightLegGroups: QuoteCostingInput["freightLegGroups"];
  freightLegs: QuoteCostingInput["freightLegs"];
  freightLegTiers: QuoteCostingInput["freightLegTiers"];
  freightComponentTierCosts: QuoteCostingInput["freightComponentTierCosts"];
  storedLegTiers: Array<
    QuoteCostingInput["freightLegTiers"][number] & { rowId: string }
  >;
  customerArrangesMeta: Array<{
    freightLegId: string;
    customerContact: string | null;
    auditNote: string | null;
  }>;
} {
  return {
    freightLegGroups: args.legGroupRows.map((g) => ({
      id: g.id,
      label: g.label,
      displayOrder: g.displayOrder,
    })),
    freightLegs: args.legRows.map((leg) => ({
      id: leg.id,
      legGroupId: leg.legGroupId,
      direction: leg.direction,
      label: leg.label,
      origin: leg.origin,
      destination: leg.destination,
      crossesInternationalBorder: leg.crossesInternationalBorder,
      treatment: leg.treatment,
      mode: leg.mode,
      carrier: leg.carrier,
      incoterm: leg.incoterm,
      cargoReadyDate: leg.cargoReadyDate,
      vesselEtd: leg.vesselEtd,
      vesselEta: leg.vesselEta,
      actualDeliveryDate: leg.actualDeliveryDate,
      dutyMarkupPct: num(leg.dutyMarkupPct, 0.3),
      tariffMarkupPct: num(leg.tariffMarkupPct, 0.3),
      customs: (() => {
        // DB JSONB shape uses snake_case keys (duty_pct, tariff_pct);
        // the math-layer type uses camelCase (dutyPct, tariffPct) for
        // consistency with the rest of the costing types. Translate
        // at the boundary.
        const raw = (leg.customs as
          | { duty_pct?: number; tariff_pct?: number }
          | undefined) ?? {};
        const out: { dutyPct?: number; tariffPct?: number } = {};
        if (raw.duty_pct !== undefined) out.dutyPct = raw.duty_pct;
        if (raw.tariff_pct !== undefined) out.tariffPct = raw.tariff_pct;
        return out;
      })(),
      displayOrder: leg.displayOrder,
    })),
    freightLegTiers: args.legTierRows.map((lt) => ({
      freightLegId: lt.freightLegId,
      tierId: lt.tierId,
      totalFreight: numOrNull(lt.totalFreight),
      unitsInShipment: lt.unitsInShipment,
    })),
    freightComponentTierCosts: args.componentCostRows.map((row) => ({
      freightLegId: row.freightLegId,
      quoteLeafId: row.quoteLeafId,
      tierId: row.tierId,
      actualFreightCost: numOrNull(row.actualFreightCost),
      effectiveUnits: row.effectiveUnits,
    })),
    storedLegTiers: args.legTierRows.map((lt) => ({
      rowId: lt.id,
      freightLegId: lt.freightLegId,
      tierId: lt.tierId,
      totalFreight: numOrNull(lt.totalFreight),
      unitsInShipment: lt.unitsInShipment,
    })),
    customerArrangesMeta: args.custMetaRows.map((m) => ({
      freightLegId: m.freightLegId,
      customerContact: m.customerContact,
      auditNote: m.auditNote,
    })),
  };
}

async function loadWorksheetFreightForQuote(
  quoteId: string,
): Promise<NonNullable<QuoteCostingInput["freightShipmentBreaks"]>> {
  const [quote] = await db
    .select({ status: quotes.status, snapshotId: quoteSnapshots.id })
    .from(quotes)
    .leftJoin(quoteSnapshots, and(eq(quoteSnapshots.quoteId, quotes.id), isNull(quoteSnapshots.supersededAt)))
    .where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) return [];
  // OD-023 · current-version read, as above. Historical customer output is
  // addressed by `readQuoteVersion`, not inferred from this predicate.
  if (quote.status !== "draft" && quote.snapshotId) {
    const [snapshot] = await db.select({
      workbook: quoteSnapshotFreightWorkbooks.workbook,
      // The legacy-attribution discriminator. Capture time, not quote age:
      // what matters is which contract the record was FROZEN under.
      frozenAt: quoteSnapshotFreightWorkbooks.createdAt,
    })
      .from(quoteSnapshotFreightWorkbooks)
      .where(eq(quoteSnapshotFreightWorkbooks.quoteSnapshotId, quote.snapshotId)).limit(1);
    if (snapshot) return projectSnapshotWorkbook(snapshot.workbook as FreightWorkbook, snapshot.frozenAt);
  }
  if (quote.status !== "draft") return [];
  const rows = await db
    .select({
      subcategoryId: freightSubcategories.id,
      assemblyId: freightSubcategories.assemblyId,
      treatment: freightSubcategories.treatment,
      tierId: freightDestinationBreaks.tierId,
      tierUnits: quoteTiers.qty,
      freightAmount: freightDestinationBreaks.freightAmount,
      freightMarkupPct: freightDestinationBreaks.freightMarkupPct,
    })
    .from(freightSubcategories)
    .innerJoin(
      freightDestinations,
      and(
        eq(freightDestinations.id, freightSubcategories.selectedDestinationId),
        eq(freightDestinations.freightSubcategoryId, freightSubcategories.id),
      ),
    )
    .innerJoin(freightDestinationBreaks, eq(freightDestinationBreaks.freightDestinationId, freightDestinations.id))
    .innerJoin(quoteTiers, eq(quoteTiers.id, freightDestinationBreaks.tierId))
    .where(eq(freightSubcategories.quoteId, quoteId));
  if (rows.length === 0) return [];
  // V1 FREIGHT DISTRIBUTION POLICY · membership, not an owner.
  //
  // This resolved ONE anchor leaf per shipment — the lowest-position leaf of
  // the shipment's ASSEMBLY. That set is not the shipment. On `2f29af72` a
  // two-product shipment's freight was attributed to a third product that was
  // not in it, and because the positions tie, the pick moved between a quote
  // and its copy: 107,225 against 113,105 on identical inputs.
  //
  // `freight_subcategory_items` is the operator's own record of what is being
  // shipped. It excludes products that are not in the shipment, it is identical
  // in a copy, and it depends on no row order, timestamp or id.
  const memberRows = await db
    .select({
      subcategoryId: freightSubcategoryItems.freightSubcategoryId,
      quoteLeafId: freightSubcategoryItems.quoteLeafId,
    })
    .from(freightSubcategoryItems)
    .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightSubcategoryItems.freightSubcategoryId))
    .where(eq(freightSubcategories.quoteId, quoteId));
  const membersBySubcategory = new Map<string, string[]>();
  for (const row of memberRows) {
    const list = membersBySubcategory.get(row.subcategoryId) ?? [];
    list.push(row.quoteLeafId);
    membersBySubcategory.set(row.subcategoryId, list);
  }

  const customs = await db.select({
    subcategoryId: freightCustomsEntries.freightSubcategoryId,
    tierId: freightCustomsBreaks.tierId,
    chargeType: freightCustomsBreaks.chargeType,
    amount: freightCustomsBreaks.amount,
    markupPct: freightCustomsBreaks.markupPct,
  }).from(freightCustomsBreaks)
    .innerJoin(freightCustomsEntries, eq(freightCustomsEntries.id, freightCustomsBreaks.freightCustomsEntryId))
    .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightCustomsEntries.freightSubcategoryId))
    .where(eq(freightSubcategories.quoteId, quoteId));
  const charge = (subcategoryId: string, tierId: string, type: "duty" | "tariff") =>
    customs.find((row) => row.subcategoryId === subcategoryId && row.tierId === tierId && row.chargeType === type);
  return rows.flatMap((row) => {
    const duty = charge(row.subcategoryId, row.tierId, "duty");
    const tariff = charge(row.subcategoryId, row.tierId, "tariff");
    const members = membersBySubcategory.get(row.subcategoryId) ?? [];
    // A PRICED SHIPMENT WITH NO RECORDED MEMBERS CONTRIBUTES NOTHING, AND DOES
    // NOT THROW.
    //
    // This threw, and it took a whole quote down with it: `9af5fe52` has a
    // $500 ocean shipment whose membership was never recorded, and under the
    // previous rule it was absorbed by a leaf picked from the assembly. That
    // substitution is exactly what the distribution policy removes, so there is
    // now no recipient — every fallback (assembly's first leaf, createdAt, id,
    // cost share, quantity) is explicitly excluded.
    //
    // Nothing here is smart enough to invent one, so it declines to. The
    // condition is a MISSING OPERATOR INPUT, not a fault, and it is surfaced
    // where the other missing freight inputs are: `loadUnresolvedQuoteCosts`
    // refuses the send until the operator says what is in the shipment. Costing
    // stays loadable meanwhile — a quote that cannot be sent is still a quote
    // someone is working on.
    if (members.length === 0) return [];
    // ONE BREAK PER MEMBER. The amounts stay whole; `memberCount` carries the
    // split so the engine can state it and the trace can show the operator's
    // entered figure rather than a divided one.
    return members.map((memberSkuId) => ({
      freightSubcategoryId: row.subcategoryId,
      memberSkuId,
      memberCount: members.length,
      tierId: row.tierId,
      tierUnits: row.tierUnits ?? 0,
      treatment: row.treatment,
      freightAmount: numOrNull(row.freightAmount),
      freightMarkupPct: num(row.freightMarkupPct, 0),
      dutyAmount: numOrNull(duty?.amount ?? null),
      dutyMarkupPct: num(duty?.markupPct ?? null, 0),
      tariffAmount: numOrNull(tariff?.amount ?? null),
      tariffMarkupPct: num(tariff?.markupPct ?? null, 0),
    }));
  });
}

function projectSnapshotWorkbook(
  workbook: FreightWorkbook,
  frozenAt: Date,
): NonNullable<QuoteCostingInput["freightShipmentBreaks"]> {
  const selectedDestinationIds = new Set(
    workbook.subcategories.map((row) => row.selectedDestinationId).filter((id): id is string => id !== null),
  );
  const selectedBreaks = workbook.breaks.filter((row) => selectedDestinationIds.has(row.freightDestinationId));
  const customsBySubcategory = new Map(workbook.customsEntries.map((row) => [row.freightSubcategoryId, row.id]));
  const customsCharge = (subcategoryId: string, tierId: string, chargeType: "duty" | "tariff") => {
    const entryId = customsBySubcategory.get(subcategoryId);
    return workbook.customsBreaks.find((row) => row.freightCustomsEntryId === entryId && row.tierId === tierId && row.chargeType === chargeType);
  };
  return selectedBreaks.flatMap((row) => {
    const destination = workbook.destinations.find((candidate) => candidate.id === row.freightDestinationId);
    const subcategory = workbook.subcategories.find((candidate) => candidate.id === destination?.freightSubcategoryId);
    if (!subcategory) throw new ActionGuardError(ERR.VALIDATION, "Freight snapshot contains a drifting destination mapping");
    // V1 FREIGHT DISTRIBUTION POLICY, applied to a SENT version too.
    //
    // The snapshot carries its own `memberships`, frozen at send, so a
    // historical read distributes across exactly the products that shipment
    // contained at the time — not across whatever the live tables say now.
    // That is the same governed boundary the draft path uses, read from the
    // frozen copy.
    const recorded = workbook.memberships
      .filter((m) => m.freightSubcategoryId === subcategory.id)
      .map((m) => m.quoteLeafId);
    // LEGACY COMPATIBILITY — historical preservation, not current policy.
    //
    // A sent version is a record of what was sent. DPS-1050 was sent, accepted
    // and pushed before membership existed as a requirement, and reading it
    // under the equal-split rule finds no recipient and silently drops $650 of
    // real cost from a completed customer-facing quote.
    //
    // The snapshot already holds the answer: `costingContext` froze the
    // attribution AT SEND. This reads it. It does not reconstruct one, and if
    // the record does not carry one it declines — see the resolver, which has
    // no fallback by design.
    //
    // Unreachable from the draft path, which is the real guarantee that a
    // malformed CURRENT quote cannot be exempted: it is not gated away from
    // this branch, it cannot arrive at it.
    const legacy =
      recorded.length === 0
        ? resolveLegacyFreightAttribution({
            frozenAt,
            subcategoryId: subcategory.id,
            assemblyId: subcategory.assemblyId ?? null,
            frozenMemberCount: 0,
            costingContext: workbook.costingContext,
          })
        : null;
    const members = legacy?.eligible ? [legacy.memberSkuId] : recorded;
    if (members.length === 0) return [];
    const duty = customsCharge(subcategory.id, row.tierId, "duty");
    const tariff = customsCharge(subcategory.id, row.tierId, "tariff");
    return members.map((memberSkuId) => ({
      freightSubcategoryId: subcategory.id,
      memberSkuId,
      memberCount: members.length,
      tierId: row.tierId,
      tierUnits: workbook.costingContext.tierUnitsByTier[row.tierId] ?? 0,
      treatment: subcategory.treatment,
      freightAmount: numOrNull(row.freightAmount),
      freightMarkupPct: num(row.freightMarkupPct, 0),
      dutyAmount: numOrNull(duty?.amount ?? null),
      dutyMarkupPct: num(duty?.markupPct ?? null, 0),
      tariffAmount: numOrNull(tariff?.amount ?? null),
      tariffMarkupPct: num(tariff?.markupPct ?? null, 0),
    }));
  });
}

// ---------- Slice 11.5 — NEW-model cost-data loader ----------
//
// Sister loader to loadFreightForQuote, for the NEW-model cost-data
// extension tables (Slice 11.5 Step 2 schema). Returns raw DB rows
// keyed for downstream adapter consumption.
//
// Six parallel queries; each scoped to the quote via:
//   - assemblies / assembly_production_inputs : direct quote_id FK
//   - assembly_leaves : join assemblies(quote_id)
//   - leaves : library (global) — joined for name/sku via leaf_id
//   - assembly_leaf_inputs / _overrides / _targets : join through
//     assembly_leaves → assemblies(quote_id)
async function loadNewModelCostDataForQuote(quoteId: string): Promise<{
  assemblyRows: Array<typeof assemblies.$inferSelect>;
  /**
   * The governed SKU population (OD-014): canonical `quote_leaves` rows, each
   * carrying its legacy `assembly_leaf_id` where one exists. NULL legacy id
   * means a direct canonical attachment.
   */
  quoteLeafAttachmentRows: Array<
    typeof quoteLeaves.$inferSelect & { assemblyLeafId: string | null }
  >;
  leafRows: Array<typeof leaves.$inferSelect>;
  assemblyLeafInputRows: Array<typeof assemblyLeafInputs.$inferSelect>;
  assemblyProductionInputRows: Array<
    typeof assemblyProductionInputs.$inferSelect
  >;
  assemblyLeafOverrideRows: Array<typeof assemblyLeafOverrides.$inferSelect>;
  clientTargetRows: Array<typeof quoteClientTargets.$inferSelect>;
  quoteLeafLiftRows: Array<typeof quoteLeafLifts.$inferSelect>;
}> {
  const [
    assemblyRows,
    quoteLeafAttachmentJoinRows,
    assemblyLeafInputJoinRows,
    assemblyProductionInputRows,
    assemblyLeafOverrideJoinRows,
    clientTargetJoinRows,
    quoteLeafLiftRows,
  ] = await Promise.all([
    timed("nm.assemblies", quoteId, db
      .select()
      .from(assemblies)
      .where(eq(assemblies.quoteId, quoteId))
      .orderBy(asc(assemblies.position), asc(assemblies.createdAt))),
    // OD-014 / C-2 — the SKU population comes from the CANONICAL attachment
    // table. This query previously started at `assembly_leaves` and reached
    // the quote through `assemblies`, which structurally excluded any leaf
    // attached directly to the quote (`quote_leaves.assembly_id IS NULL`) —
    // a form the schema indexes for and the identity module validates, but
    // that costing could never see.
    //
    // The legacy id is LEFT joined because it is compatibility data, not
    // population: its absence must not remove a governed SKU from the quote.
    //
    // Ordering is unchanged in effect. It was (assembly_id, position) read
    // off the legacy row; it is now the same pair read off the canonical row.
    // Both were verified equal for every attachment, and the pair was verified
    // unique within a quote, so the order is preserved and deterministic
    // rather than incidentally stable. Direct attachments sort last under
    // Postgres ASC NULLS LAST.
    timed("nm.quote_leaf_attachments", quoteId, db
      .select({
        quote_leaves: quoteLeaves,
        legacy_assembly_leaf_id: assemblyLeaves.id,
        leaves: leaves,
      })
      .from(quoteLeaves)
      .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
      .leftJoin(assemblyLeaves, eq(assemblyLeaves.quoteLeafId, quoteLeaves.id))
      .where(eq(quoteLeaves.quoteId, quoteId))
      .orderBy(
        asc(quoteLeaves.assemblyId),
        asc(quoteLeaves.position),
      )),
    // OD-017 · scoped through the CANONICAL attachment, not through
    // `assemblies`. Reaching the quote via `assemblies` structurally excluded a
    // Direct Component — its rows existed but no loader could see them, which
    // is most of why a direct attachment was unpriceable.
    timed("nm.assembly_leaf_inputs", quoteId, db
      .select({ assembly_leaf_inputs: assemblyLeafInputs })
      .from(assemblyLeafInputs)
      .innerJoin(
        quoteLeaves,
        eq(quoteLeaves.id, assemblyLeafInputs.quoteLeafId),
      )
      .where(eq(quoteLeaves.quoteId, quoteId))
      .orderBy(
        asc(assemblyLeafInputs.sortOrder),
        asc(assemblyLeafInputs.lineGroupId),
        asc(assemblyLeafInputs.createdAt),
      )),
    // Stage 3 A · BOTH owner branches reach the ENGINE.
    //
    // The inner join was correct while `assembly_id` was NOT NULL and silently
    // wrong the moment it was not: a Direct Service's production row carries a
    // `quote_leaf_id` and no assembly, so the join dropped it and the math
    // never saw the cost.
    //
    // The consequence was not a missing display. The service still reached
    // `skuRollups` as a leaf, priced at 0, so the customer PDF rendered a
    // `Formulation` line reading "quote on request" and EXCLUDED it from the
    // turnkey total — honestly, and for a cost the operator had entered and
    // could see on the Costs surface.
    //
    // Fourth instance of the same family in this slice, and the only one where
    // a write succeeded, displayed, and then failed to reach the arithmetic.
    timed("nm.assembly_production_inputs", quoteId, db
      .select({ row: assemblyProductionInputs })
      .from(assemblyProductionInputs)
      .leftJoin(
        assemblies,
        eq(assemblies.id, assemblyProductionInputs.assemblyId),
      )
      .leftJoin(
        quoteLeaves,
        eq(quoteLeaves.id, assemblyProductionInputs.quoteLeafId),
      )
      .where(
        or(eq(assemblies.quoteId, quoteId), eq(quoteLeaves.quoteId, quoteId)),
      )
      .then((rows) => rows.map((r) => r.row))),
    timed("nm.assembly_leaf_overrides", quoteId, db
      .select({ assembly_leaf_overrides: assemblyLeafOverrides })
      .from(assemblyLeafOverrides)
      .innerJoin(
        quoteLeaves,
        eq(quoteLeaves.id, assemblyLeafOverrides.quoteLeafId),
      )
      .where(eq(quoteLeaves.quoteId, quoteId))),
    // Client Target, keyed to the top-level sellable unit. Scoped by
    // `quote_id` directly — the row names its own quote, so no join is needed
    // to establish which one it belongs to.
    //
    // This replaced a load of `assembly_leaf_targets`, whose key
    // `(quote_leaf_id, tier_id)` is the right identity for a Direct Product
    // and the wrong one for an Item Group. See
    // docs/validation/client-target-identity-trace.md.
    timed("nm.quote_client_targets", quoteId, db
      .select({ quote_client_targets: quoteClientTargets })
      .from(quoteClientTargets)
      .where(eq(quoteClientTargets.quoteId, quoteId))),
    // Phase 3 · Package 1 — applied surgical lifts, scoped through the
    // CANONICAL attachment. As of OD-017 every leaf-level cost loader above
    // does the same; this one simply got there first.
    timed("nm.quote_leaf_lifts", quoteId, db
      .select({ quote_leaf_lifts: quoteLeafLifts })
      .from(quoteLeafLifts)
      .innerJoin(quoteLeaves, eq(quoteLeaves.id, quoteLeafLifts.quoteLeafId))
      .where(eq(quoteLeaves.quoteId, quoteId))
      .then((rows) => rows.map((r) => r.quote_leaf_lifts))),
  ]);
  // Dedupe library leaves (assembly_leaves join may surface the
  // same library leaf multiple times if reused across assemblies in
  // the same quote).
  const leafMap = new Map<string, typeof leaves.$inferSelect>();
  for (const r of quoteLeafAttachmentJoinRows) {
    leafMap.set(r.leaves.id, r.leaves);
  }
  return {
    assemblyRows,
    quoteLeafAttachmentRows: quoteLeafAttachmentJoinRows.map((r) => ({
      ...r.quote_leaves,
      assemblyLeafId: r.legacy_assembly_leaf_id,
    })),
    leafRows: Array.from(leafMap.values()),
    assemblyLeafInputRows: assemblyLeafInputJoinRows.map(
      (r) => r.assembly_leaf_inputs,
    ),
    assemblyProductionInputRows,
    assemblyLeafOverrideRows: assemblyLeafOverrideJoinRows.map(
      (r) => r.assembly_leaf_overrides,
    ),
    clientTargetRows: clientTargetJoinRows.map((r) => r.quote_client_targets),
    quoteLeafLiftRows,
  };
}

// ---------- read action: getQuoteCosting ----------

// Pure read. Assembles QuoteCostingInput from the DB, calls the pure
// rollup module, returns the result. No audit log; this is read-only.
//
// Surfaced as `ActionResult` (not raw return) so the caller can handle
// not-found cleanly through the same shape as mutations.
export async function getQuoteCosting(
  quoteId: string,
): Promise<ActionResult<QuoteCostingResult>> {
  return runAction(async () => {
    const quoteRows = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (quoteRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    const quote = quoteRows[0];

    // Current firm_settings row: effective_until IS NULL means it's the
    // active version. If somehow there are multiple (shouldn't happen
    // — admin update path closes the prior row's effective_until before
    // inserting the new), order by effective_from desc to pick the
    // newest.
    const commercial = await resolveQuoteCommercialSettings(quoteId);

    // Slice 11.5 Step 3 — NEW-model read path. Load NEW-model
    // cost-data tables + freight (model-agnostic) + tiers +
    // markup_defaults; adapter builds QuoteCostingInput; math layer
    // unchanged.
    const [tiers, newModelData, freightLoad, worksheetFreight] = await Promise.all([
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      loadNewModelCostDataForQuote(quoteId),
      // Slice R6.2 — multi-leg journey freight load (4 joined tables).
      loadFreightForQuote(quoteId),
      loadWorksheetFreightForQuote(quoteId),
    ]);

    // Plain Record (not Map) so the snapshot serializes cleanly across
    // the RSC server→client boundary. See costing.ts type comment.
    const markupMap = commercial.markupDefaults;

    const freightProjection = projectFreightInputs(freightLoad);

    // Build the library-leaf lookup so the adapter can join
    // assembly_leaves.leaf_id → leaves.name / leaves.sku.
    const leafById = new Map(newModelData.leafRows.map((l) => [l.id, l]));

    const input = buildQuoteCostingInputFromNewModel({
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
        targetMarginPct: numOrNull(quote.targetMarginPct),
        freightMarkupPct: commercial.freightMarkupPct,
      },
      firmSettings: {
        targetMarginPct: commercial.targetMarginPct,
        floorMarginPct: commercial.floorMarginPct,
      },
      markupDefaults: markupMap,
      tiers: tiers.map((t) => ({
        id: t.id,
        label: t.label,
        qty: t.qty,
        sortOrder: t.sortOrder,
        tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
      })),
      assemblies: newModelData.assemblyRows.map((a) => ({
        id: a.id,
        sku: a.sku,
        name: a.name,
        position: a.position,
      })),
      quoteLeafAttachments: newModelData.quoteLeafAttachmentRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          quoteLeafId: al.id,
          assemblyLeafId: al.assemblyLeafId,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
          // Stage 3 A · the other owner branch. Threaded here so a Direct
          // Service's production reaches the adapter; without it the row
          // would load and then be silently dropped for having no owner the
          // adapter recognises.
          quoteLeafId: r.quoteLeafId,
          tierId: r.tierId,
          customerShipsRaws: r.customerShipsRaws,
          allocateServiceFeesToCost: r.allocateServiceFeesToCost,
          fillingBlendingCost: r.fillingBlendingCost,
          cmAssemblyTotal: r.cmAssemblyTotal,
          setupFeeTotal: r.setupFeeTotal,
          toolingArtworkTotal: r.toolingArtworkTotal,
          rdTotal: r.rdTotal,
          otherServiceTotal: r.otherServiceTotal,
          bulkRawCost: r.bulkRawCost,
          actualUnitsProduced: r.actualUnitsProduced,
        }),
      ),
      assemblyLeafOverrides: newModelData.assemblyLeafOverrideRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      // Raw rows, not a resolved value. Resolution is `tier ?? common` PER
      // TIER and belongs to one shared function; a bundle field holding an
      // already-collapsed number is what the previous model shipped, and the
      // collapse is the defect.
      clientTargets: newModelData.clientTargetRows.map((r) => ({
        assemblyId: r.assemblyId,
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      lifts: newModelData.quoteLeafLiftRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        liftPct: r.liftPct,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
      freightComponentTierCosts: freightProjection.freightComponentTierCosts,
      freightShipmentBreaks: worksheetFreight,
    });

    return computeQuoteCosting(input);
  });
}

// ---------- mutation: updateQuoteGlobalPriceAdj ----------

// Updates the per-quote global price adjustment. Percent-display
// convention: UI sends "5" for 5%; action layer divides by 100 to store
// as "0.0500". Negatives accepted (PM may pull margin down deliberately;
// the BELOW_FLOOR status flag still fires, enforcement comes Slice 9).
//
// Audit-logged with from/to. revalidates the costing route + the
// summary card on cost-input pages.
export async function updateQuoteGlobalPriceAdj(
  formData: FormData,
): Promise<
  ActionResult<{ quoteId: string; globalPriceAdjPct: string | null }>
> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    const newAdj = parsePercentDisplay(formData.get("globalPriceAdjPct"), {
      field: "globalPriceAdjPct",
      label: "Global price adjustment",
      nullable: true,
      minPercent: -99.99,
      maxPercent: 999,
    });

    if (numericEquals(quote.globalPriceAdjPct, newAdj)) {
      // No-op; return canonical snapshot.
      return {
        quoteId,
        globalPriceAdjPct: quote.globalPriceAdjPct,
      };
    }

    // global_price_adj_pct is NOT NULL in the schema; use "0" if PM
    // cleared the field (UI sent empty string).
    const stored = newAdj ?? "0";

    await db
      .update(quotes)
      .set({ globalPriceAdjPct: stored, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    await logAudit({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "global_price_adj_updated",
      diffJson: {
        global_price_adj_pct: {
          from: quote.globalPriceAdjPct,
          to: stored,
        },
      },
    });

    // Costing changes propagate everywhere that reads it. revalidateQuoteTree
    // covers /, /packaging, /production, /freight, /costing — single source of
    // truth for the quote-tree subpath list.
    revalidateQuoteTree(quote.projectId, quote.id);

    return { quoteId, globalPriceAdjPct: stored };
  });
}

// ---------- REMOVED: updateTierPriceAdj (Slice 9.2 → removed 2026-08-16) ----------
//
// The per-tier price adjustment had TWO writers over one column. Setup's tier
// row wrote `quote_tiers.tier_price_adj_pct` through this action on a
// debounce, immediately — no staging, no preview, no Discard — while Pricing
// staged the same column through `planApply`.
//
// Same column, same audit action, same meaning; no distinct semantics on
// either side. What differed was governance, entirely in Setup's disfavour:
// this path never participated in the rule that clears tier overrides when the
// quote-wide rate moves, and it sat outside both staleness guards. An operator
// could change a committed price from Setup and see no chip for it, and a
// concurrent write from here could move a lever a Pricing operator had already
// staged against, with the guard's refusal being the only sign.
//
// Pricing is the authority. `applyPricingAdjustments` is the only writer, and
// the column, its audit action `tier_price_adj_updated`, and every persisted
// value are unchanged — this removes a door, not a capability.

// ---------- mutation: updateQuoteTargetMargin (Slice 9.2) ----------

// Per-quote override of `firm_settings.target_margin_pct`. NULL =
// inherit firm-level. Drives the BELOW_TARGET verdict band and the
// suggested-GPA goal (when status === BELOW_TARGET).
//
// Form contract: quoteId, targetMarginPct (percent display, or empty
// to clear). Audit `quote_target_margin_updated` records from/to.
export async function updateQuoteTargetMargin(
  formData: FormData,
): Promise<
  ActionResult<{ quoteId: string; targetMarginPct: string | null }>
> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    const newTarget = parseMarginPercent(
      formData.get("targetMarginPct"),
      "targetMarginPct",
      "Target margin",
    );

    if (numericEquals(quote.targetMarginPct, newTarget)) {
      return { quoteId, targetMarginPct: quote.targetMarginPct };
    }

    await db
      .update(quotes)
      .set({ targetMarginPct: newTarget, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    await logAudit({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "quote_target_margin_updated",
      diffJson: {
        target_margin_pct: {
          from: quote.targetMarginPct,
          to: newTarget,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { quoteId, targetMarginPct: newTarget };
  });
}

// ---------- mutation: applySuggestedGlobalAdj (Slice 9.2) ----------

// One-click apply of the system-suggested GPA. Writes the suggested
// value to `quotes.global_price_adj_pct` (same column as the manual
// slider). Audited as `global_price_adj_updated` with `source:
// "system_suggestion"` in metadata so post-hoc analysis can
// distinguish PM-typed vs. system-applied edits.
//
// AUDIT SOURCE CONVENTION: `source: "system_suggestion"` is reserved
// for THIS specific surface — the live coaching banner on the
// Pricing that applies the closed-form GPA reverse-solve.
// Future suggestion paths (e.g., Slice 9.5 bulk validation engine,
// scenario-comparison apply, etc.) get their own distinct source
// values (`bulk_validation_suggestion`, `scenario_apply`, ...) so a
// PM querying "where did this GPA change come from" can disambiguate
// without reading the human-context columns. Single-stream audit
// timeline; per-source filter when needed.
//
// Form contract: quoteId, suggestedAdj (percent display string —
// banner UI sends back the integer it just rendered).
export async function applySuggestedGlobalAdj(
  formData: FormData,
): Promise<
  ActionResult<{ quoteId: string; globalPriceAdjPct: string | null }>
> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    const newAdj = parsePercentDisplay(formData.get("suggestedAdj"), {
      field: "suggestedAdj",
      label: "Suggested adjustment",
      nullable: true,
      minPercent: -99.99,
      maxPercent: 999,
    });
    if (newAdj === null)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "suggestedAdj required (percent display)",
      );

    if (numericEquals(quote.globalPriceAdjPct, newAdj)) {
      return { quoteId, globalPriceAdjPct: quote.globalPriceAdjPct };
    }

    await db
      .update(quotes)
      .set({ globalPriceAdjPct: newAdj, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    await logAudit({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "global_price_adj_updated",
      diffJson: {
        global_price_adj_pct: {
          from: quote.globalPriceAdjPct,
          to: newAdj,
        },
        source: "system_suggestion",
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { quoteId, globalPriceAdjPct: newAdj };
  });
}

// ---------- mutation: updateAssemblyLeafOverride (Slice 11.5) ----------
//
// Per-cell sell-price override on the (assembly_leaf, tier) cell.
// NEW-model successor to OLD `updateSellPriceOverride` per brief
// §4. Single action handles both set and clear via the value-or-null
// parameter; one audit row per state change with `action:
// "assembly_leaf_sell_override_updated"`; the from/to encodes the
// transition (set: from null, to value; change: from old, to new;
// clear: from value, to null).
//
// DB shape: `assembly_leaf_overrides` is a sparse table — rows exist
// ONLY for cells with overrides. NOT NULL on `sell_price_override`
// enforces "row exists ⟹ override is set" at the schema level.
//   - value === null  → DELETE the row
//   - value > 0       → INSERT ON CONFLICT (PK) DO UPDATE
//   - value <= 0      → reject (action layer guard); zero or
//                       negative sell price isn't a legitimate
//                       quoting scenario and would break partition
//                       revenue invariants. To clear an override,
//                       send empty input (→ null at the action)
//                       which DELETEs the row.
//
// FormData field "quoteSkuId" carries the assembly_leaf.id per
// Q2 (a) preserve-prop-names disposition.
//
// Leaf-only invariant inherent in schema (FK to assembly_leaves;
// assemblies cannot be overridden — they roll up children).
export async function updateAssemblyLeafOverride(
  formData: FormData,
): Promise<
  ActionResult<{
    quoteLeafId: string;
    quoteSkuId: string;
    tierId: string;
    sellPriceOverride: string | null;
  }>
> {
  return runAction(async () => {
    // OD-017 · `quoteSkuId` carries the math-leaf id, which IS the canonical
    // `quote_leaf_id` now that the adapter no longer keys leaves on the legacy
    // junction. The form field name is unchanged to keep the wire contract
    // stable; only what it denotes moved.
    const quoteLeafId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!quoteLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    // Quote draft + ownership through the canonical leaf — no assembly needed.
    const { quote, attachment } = await quoteForQuoteLeaf(quoteLeafId);

    // Verify tier belongs to the same quote (defense in depth — FK
    // alone can't catch cross-quote tier IDs).
    const tierRows = await db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.id, tierId))
      .limit(1);
    if (tierRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
    if (tierRows[0].quoteId !== quote.id) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Tier does not belong to this quote.",
      );
    }

    // Parse the value. Empty input → null → clear; non-empty → numeric.
    const parsedValueString = parsePositivePrice(
      formData.get("sellPriceOverride"),
    );
    const parsedValue =
      parsedValueString === null ? null : Number(parsedValueString);

    // Read previous value (if any) for the audit diff.
    const existingRows = await db
      .select()
      .from(assemblyLeafOverrides)
      .where(
        and(
          eq(assemblyLeafOverrides.quoteLeafId, quoteLeafId),
          eq(assemblyLeafOverrides.tierId, tierId),
        ),
      )
      .limit(1);
    const previousValue =
      existingRows.length > 0 ? existingRows[0].sellPriceOverride : null;

    // No-op: incoming value matches stored value.
    if (numericEquals(previousValue, parsedValue?.toString() ?? null)) {
      return {
        quoteLeafId: attachment.quoteLeafId,
        quoteSkuId: quoteLeafId,
        tierId,
        sellPriceOverride: previousValue,
      };
    }

    let storedValue: string | null;
    if (parsedValue === null) {
      await db
        .delete(assemblyLeafOverrides)
        .where(
          and(
            eq(assemblyLeafOverrides.quoteLeafId, quoteLeafId),
            eq(assemblyLeafOverrides.tierId, tierId),
          ),
        );
      storedValue = null;
    } else {
      const stored = parsedValue.toString();
      await db
        .insert(assemblyLeafOverrides)
        .values({
          quoteLeafId,
          // Legacy compatibility only — NULL for a Direct Component, and read
          // by nothing. Written so the column stays truthful until it is dropped.
          assemblyLeafId: attachment.assemblyLeafId,
          tierId,
          sellPriceOverride: stored,
        })
        .onConflictDoUpdate({
          target: [
            assemblyLeafOverrides.quoteLeafId,
            assemblyLeafOverrides.tierId,
          ],
          set: { sellPriceOverride: stored, updatedAt: new Date() },
        });
      storedValue = stored;
    }

    // Audit. entity_id is the synthesized composite key (text per
    // CLAUDE.md "audit_log.entity_id is text"). entity_type updated
    // to NEW model identity.
    await logAudit({
      userId: user.id,
      entityType: "assembly_leaf_override",
      entityId: `${quoteLeafId}:${tierId}`,
      action: "assembly_leaf_sell_override_updated",
      diffJson: {
        quote_leaf_id: attachment.quoteLeafId,
        assembly_leaf_id: attachment.assemblyLeafId,
        tier_id: tierId,
        sell_price_override: {
          from: previousValue,
          to: storedValue,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteLeafId: attachment.quoteLeafId,
      quoteSkuId: quoteLeafId,
      tierId,
      sellPriceOverride: storedValue,
    };
  });
}

// ---------- REMOVED: updateAssemblyLeafTarget (Slice 9.4b → removed 2026-08-17) ----------
//
// The per-(leaf, tier) client-target writer, superseded by
// `src/app/actions/client-targets.ts`.
//
// Its identity was wrong for two of the three cases. `assembly_leaf_targets`
// keys `(quote_leaf_id, tier_id)`: correct for a Direct Product, where the leaf
// IS the sellable unit; wrong for an Item Group, where a leaf is an internal
// component nobody named a price for; and with no key at all for an Item Group
// finished good. A target written against a member was accepted here and then
// silently ignored by the math layer, which sets `competitiveStatus: null` on
// assemblies. It also could not express "one target across all tiers", because
// `tier_id` is NOT NULL and in its primary key.
//
// It had no production caller and the table held zero rows, so nothing was
// migrated and no operator expectation changed. Full trace:
// docs/validation/client-target-identity-trace.md

// ---------- mutation: applyClientTargetSolveTierAdj (Slice 9.4b) ----------

// Apply path for the per-(SKU, tier) "match client target" reverse-solve.
// Mirrors Slice 9.2's `applySuggestedGlobalAdj` precedent (same shape,
// different surface/origin):
//   - Writes `quote_tiers.tier_price_adj_pct` (same column the manual
//     `updateTierPriceAdj` writes)
//   - Audit row: `action: "tier_price_adj_updated"` (same as manual);
//     `diff_json.source: "client_target_solve"` (namespaced — per
//     CLAUDE.md "Audit source convention", reserved for THIS surface;
//     future cell-level reverse-solves get distinct values)
//   - Forensic field `diff_json.solve_origin_sku_id` captures which
//     cell drove the solve (the `(quoteSkuId, tierId)` cell that the
//     PM clicked Apply on). Aids "where did this tier-adj come from"
//     audit-trail reads.
//
// Server re-derives the suggested value by re-running
// `suggestTierAdjForClientTarget` against freshly-loaded costing state.
// FormData-supplied `suggestedAdj` is compared to the server's
// re-derived value within precision tolerance; rejected if they
// disagree (defense against forged FormData per architect Q4 sign-off).
//
// Form contract: `quoteId`, `tierId`, `suggestedSkuId` (the cell that
// drove the solve — for forensic + re-derivation), `suggestedAdj`
// (numeric percent display, e.g., "5.5" for 5.5%; same convention as
// the manual updateTierPriceAdj input).
export async function applyClientTargetSolveTierAdj(
  formData: FormData,
): Promise<
  ActionResult<{
    quoteId: string;
    tierId: string;
    tierPriceAdjPct: string;
  }>
> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    const suggestedSkuId = String(formData.get("suggestedSkuId") ?? "").trim();
    const suggestedAdjRaw = String(formData.get("suggestedAdj") ?? "").trim();

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");
    if (!suggestedSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "suggestedSkuId required");
    if (!suggestedAdjRaw)
      throw new ActionGuardError(ERR.VALIDATION, "suggestedAdj required");

    const suggestedAdjFromForm = Number(suggestedAdjRaw);
    if (!Number.isFinite(suggestedAdjFromForm)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "suggestedAdj must be a number.",
      );
    }

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    // Load full costing state — same load shape as getCostingBundle.
    // Inline duplication is acceptable for Slice 9.4b's scope; backlog
    // entry exists to extract `loadCostingState(quoteId)` shared helper
    // when a third call site emerges.
    const commercial = await resolveQuoteCommercialSettings(quoteId);
    // Slice 11.5 Step 3 — NEW-model read path (mirrors getQuoteCosting).
    const [tiersFresh, newModelData, freightLoad, worksheetFreight] = await Promise.all([
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      loadNewModelCostDataForQuote(quoteId),
      // Slice R6.2 — multi-leg journey freight load.
      loadFreightForQuote(quoteId),
      loadWorksheetFreightForQuote(quoteId),
    ]);

    const markupMap = commercial.markupDefaults;

    const freightProjection = projectFreightInputs(freightLoad);

    const leafById = new Map(newModelData.leafRows.map((l) => [l.id, l]));

    const input = buildQuoteCostingInputFromNewModel({
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
        targetMarginPct: numOrNull(quote.targetMarginPct),
        freightMarkupPct: commercial.freightMarkupPct,
      },
      firmSettings: {
        targetMarginPct: commercial.targetMarginPct,
        floorMarginPct: commercial.floorMarginPct,
      },
      markupDefaults: markupMap,
      tiers: tiersFresh.map((t) => ({
        id: t.id,
        label: t.label,
        qty: t.qty,
        sortOrder: t.sortOrder,
        tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
      })),
      assemblies: newModelData.assemblyRows.map((a) => ({
        id: a.id,
        sku: a.sku,
        name: a.name,
        position: a.position,
      })),
      quoteLeafAttachments: newModelData.quoteLeafAttachmentRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          quoteLeafId: al.id,
          assemblyLeafId: al.assemblyLeafId,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
          // Stage 3 A · the other owner branch. Threaded here so a Direct
          // Service's production reaches the adapter; without it the row
          // would load and then be silently dropped for having no owner the
          // adapter recognises.
          quoteLeafId: r.quoteLeafId,
          tierId: r.tierId,
          customerShipsRaws: r.customerShipsRaws,
          allocateServiceFeesToCost: r.allocateServiceFeesToCost,
          fillingBlendingCost: r.fillingBlendingCost,
          cmAssemblyTotal: r.cmAssemblyTotal,
          setupFeeTotal: r.setupFeeTotal,
          toolingArtworkTotal: r.toolingArtworkTotal,
          rdTotal: r.rdTotal,
          otherServiceTotal: r.otherServiceTotal,
          bulkRawCost: r.bulkRawCost,
          actualUnitsProduced: r.actualUnitsProduced,
        }),
      ),
      assemblyLeafOverrides: newModelData.assemblyLeafOverrideRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      clientTargets: newModelData.clientTargetRows.map((r) => ({
        assemblyId: r.assemblyId,
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      lifts: newModelData.quoteLeafLiftRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        liftPct: r.liftPct,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
      freightComponentTierCosts: freightProjection.freightComponentTierCosts,
      freightShipmentBreaks: worksheetFreight,
    });

    // Defense in depth — leaf-only invariant on the origin cell.
    // `updateClientTarget` already rejects assembly writes, so any
    // assembly-origin solve must be forged FormData. Same posture as
    // updateClientTarget's leaf guard.
    //
    // Slice 11.5 — math-leaf semantics: in NEW model, math-leaves
    // are assembly_leaves (the cost-bearing junction PK). Lookup
    // against input.skus catches both shapes.
    const originSku = input.skus.find((s) => s.id === suggestedSkuId);
    if (!originSku) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Origin SKU not found.");
    }
    if (originSku.skuRole !== "leaf") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Reverse-solve origin must be a leaf SKU.",
      );
    }

    // Re-run the costing math + reverse-solve helper against fresh state.
    const costing = computeQuoteCosting(input);
    const solveResult = suggestTierAdjForClientTarget(
      suggestedSkuId,
      tierId,
      costing,
      input,
    );

    // Branch on solve result. Three outcomes:
    //   1. ok=true                       → use suggestedTierAdj
    //   2. ok=false, cost_exceeds_target → mirror cell.tsx consequence
    //      path: compute naive solution. Per Edward's pressure-test
    //      resolution, this case is applyable with explicit consequence
    //      framing on the dialog. The math layer's
    //      `suggestTierAdjForClientTarget` stops at the guard; the
    //      naive helper does the rest.
    //   3. ok=false, any other reason    → genuine refusal, throw.
    let serverDerived: number;
    if (solveResult.ok) {
      serverDerived = solveResult.suggestedTierAdj;
    } else if (solveResult.reason === "cost_exceeds_target") {
      // Re-derive base from fresh costing state; mirror cell.tsx
      // consequence-branch logic exactly.
      const skuRollup = costing.skuRollups.find(
        (r) => r.skuId === suggestedSkuId,
      );
      const cell = skuRollup?.perTier.find((p) => p.tierId === tierId);
      const tierRow = input.tiers.find((t) => t.id === tierId);
      const cellTargetEntry = input.cellTargets.find(
        (c) => c.quoteSkuId === suggestedSkuId && c.tierId === tierId,
      );
      if (!cell || !tierRow || !cellTargetEntry) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Cell state mismatch during cost-exceeds-target solve. Refresh and re-apply.",
        );
      }
      const currentTierAdj =
        tierRow.tierPriceAdjPct !== null && tierRow.tierPriceAdjPct !== undefined
          ? Number(tierRow.tierPriceAdjPct)
          : input.quote.globalPriceAdjPct;
      const denom = 1 + currentTierAdj;
      if (denom === 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Singular tier-adj denominator; cannot solve.",
        );
      }
      const base = cell.computedSellPerUnit / denom;
      const naive = naiveTierAdjForCostExceedsTarget(
        base,
        cellTargetEntry.clientTargetPricePerUnit,
      );
      if (naive === null) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Solution out of range for cost-exceeds-target case.",
        );
      }
      serverDerived = naive;
    } else {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Reverse-solve failed: ${solveResult.reason}. Cell state may have changed since the suggestion was computed; refresh and try again.`,
      );
    }

    // Defense against forged FormData: server-derived value MUST match
    // the FormData-supplied value within float precision tolerance.
    // Tolerance 0.0001 = 0.01pp (one-hundredth of a percent point) —
    // enough margin for client/server JS number serialization round-
    // trips, tight enough to catch any forged value.
    if (Math.abs(serverDerived - suggestedAdjFromForm) > 0.0001) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Suggested adj value does not match server-derived solution. Refresh and re-apply.",
      );
    }

    // Read previous tier_price_adj_pct for audit diff.
    const prevTier = tiersFresh.find((t) => t.id === tierId);
    if (!prevTier) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found.");
    }
    const previousAdj = prevTier.tierPriceAdjPct;
    const stored = serverDerived.toString();

    // No-op short-circuit: server-derived value matches existing
    // tier_price_adj_pct already.
    if (numericEquals(previousAdj, stored)) {
      return { quoteId, tierId, tierPriceAdjPct: stored };
    }

    await db
      .update(quoteTiers)
      .set({ tierPriceAdjPct: stored, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tierId));

    // Audit. Same `action` as manual updateTierPriceAdj; namespaced
    // `source` distinguishes the apply-path origin. `solve_origin_sku_id`
    // is the forensic field architect Q4 specified — captures which
    // cell drove the solve so audit-trail reads can answer "where did
    // this tier-adj come from."
    await logAudit({
      userId: user.id,
      entityType: "quote_tier",
      entityId: tierId,
      action: "tier_price_adj_updated",
      diffJson: {
        tier_price_adj_pct: {
          from: previousAdj,
          to: stored,
        },
        source: "client_target_solve",
        solve_origin_sku_id: suggestedSkuId,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { quoteId, tierId, tierPriceAdjPct: stored };
  });
}

// ---------- read action: getCostingBundle ----------

// Returns the HydrateSnapshot needed to seed the client-side Zustand store
// (Slice 8 sub-step 3). Same data fetch as getQuoteCosting but returns the
// raw input rows (with rowIds) PLUS the computed result, so the client
// store can apply optimistic edits to existing rows without re-fetching.
//
// Used by:
//   - <CostingStoreProvider> on first mount (initial hydrate)
//   - Same provider on prop change after revalidateQuoteTree settles
//     (debounced reconcile, server-wins overwrite)
//
// This duplicates the input-assembly portion of getQuoteCosting. Kept
// separate so the read-only callers (e.g., a future report) can keep
// using getQuoteCosting without dragging the bundle shape in.
export async function getCostingBundle(
  quoteId: string,
  commercialOverride?: CommercialSettingsResolution,
): Promise<ActionResult<HydrateSnapshot>> {
  return runAction(async () => {
    const bundleT0 = Date.now();
    // Reconciliation freshness authority, captured on the FIRST read of the
    // bundle. See the `revision` field on HydrateSnapshot for why this is a
    // database transaction marker rather than a wall clock, and why it is
    // taken at the start rather than the end.
    const quoteRows = await timed("quote_lookup", quoteId, db
      .select({
        quotes,
        revision: sql<string>`pg_snapshot_xmax(pg_current_snapshot())::text`,
      })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1));
    if (quoteRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    const quote = quoteRows[0].quotes;
    // Causally-ordered reconciliation revision — see HydrateSnapshot.revision.
    const bundleRevision = Number(quoteRows[0].revision);

    const commercial = commercialOverride ?? await timed(
      "commercial_settings",
      quoteId,
      resolveQuoteCommercialSettings(quoteId),
    );

    // Slice 11.5 Step 3 — NEW-model read path. Load NEW-model
    // cost-data + freight (model-agnostic) + tiers + markup_defaults
    // in parallel. Adapter builds QuoteCostingInput; math layer
    // unchanged. The HydrateSnapshot is constructed below directly
    // from the input + raw NEW-model rows (rowId attached for the
    // store's optimistic-edit pattern).
    const [tiers, newModelData, freightLoad, worksheetFreight] = await Promise.all([
      timed("tiers", quoteId, db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt))),
      timed("nm.total", quoteId, loadNewModelCostDataForQuote(quoteId)),
      // Slice R6.2 — multi-leg journey freight load. (Internal Promise.all
      // of 4 sub-queries; each instrumented separately inside
      // loadFreightForQuote.)
      timed("freight.total", quoteId, loadFreightForQuote(quoteId)),
      timed("freight.worksheet", quoteId, loadWorksheetFreightForQuote(quoteId)),
    ]);

    // Cumulative wall-clock for the whole bundle. Threshold-gated
    // (>500ms) since a bundle that completes fast doesn't need
    // attention.
    const bundleDt = Date.now() - bundleT0;
    if (bundleDt >= 500) {
      console.log(
        `[bundle:TOTAL q=${quoteId.slice(0, 8)}] ${bundleDt}ms (sequential + 4-wide parallel; nm.total internally parallel)`,
      );
    }

    // Plain Record (not Map) so the snapshot serializes cleanly across
    // the RSC server→client boundary. See costing.ts type comment.
    const markupMap = commercial.markupDefaults;

    const freightProjection = projectFreightInputs(freightLoad);

    const tierList = tiers.map((t) => ({
      id: t.id,
      label: t.label,
      qty: t.qty,
      sortOrder: t.sortOrder,
      tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
    }));

    // Slice 11.5 — build the library-leaf lookup so the adapter +
    // snapshot can join assembly_leaves.leaf_id → leaves.name/sku.
    const leafById = new Map(
      newModelData.leafRows.map((l) => [l.id, l]),
    );

    const input = buildQuoteCostingInputFromNewModel({
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
        targetMarginPct: numOrNull(quote.targetMarginPct),
        freightMarkupPct: commercial.freightMarkupPct,
      },
      firmSettings: {
        targetMarginPct: commercial.targetMarginPct,
        floorMarginPct: commercial.floorMarginPct,
      },
      markupDefaults: markupMap,
      tiers: tierList,
      assemblies: newModelData.assemblyRows.map((a) => ({
        id: a.id,
        sku: a.sku,
        name: a.name,
        position: a.position,
      })),
      quoteLeafAttachments: newModelData.quoteLeafAttachmentRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          quoteLeafId: al.id,
          assemblyLeafId: al.assemblyLeafId,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
          // Stage 3 A · the other owner branch. Threaded here so a Direct
          // Service's production reaches the adapter; without it the row
          // would load and then be silently dropped for having no owner the
          // adapter recognises.
          quoteLeafId: r.quoteLeafId,
          tierId: r.tierId,
          customerShipsRaws: r.customerShipsRaws,
          allocateServiceFeesToCost: r.allocateServiceFeesToCost,
          fillingBlendingCost: r.fillingBlendingCost,
          cmAssemblyTotal: r.cmAssemblyTotal,
          setupFeeTotal: r.setupFeeTotal,
          toolingArtworkTotal: r.toolingArtworkTotal,
          rdTotal: r.rdTotal,
          otherServiceTotal: r.otherServiceTotal,
          bulkRawCost: r.bulkRawCost,
          actualUnitsProduced: r.actualUnitsProduced,
        }),
      ),
      assemblyLeafOverrides: newModelData.assemblyLeafOverrideRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      clientTargets: newModelData.clientTargetRows.map((r) => ({
        assemblyId: r.assemblyId,
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      lifts: newModelData.quoteLeafLiftRows.map((r) => ({
        quoteLeafId: r.quoteLeafId,
        tierId: r.tierId,
        liftPct: r.liftPct,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
      freightComponentTierCosts: freightProjection.freightComponentTierCosts,
      freightShipmentBreaks: worksheetFreight,
    });

    // Snapshot-shape derivations from the input + raw rows. The
    // snapshot's packaging[] / production[] / cellOverrides[] /
    // cellTargets[] match the math input shape but the store
    // additionally tracks `rowId` on packaging (for optimistic
    // row-id-keyed edits per Slice 8 sub-step 3 pattern).
    const skuList = input.skus;
    const packagingList = newModelData.assemblyLeafInputRows.map((r) => ({
      rowId: r.id,
      // Store keys must agree with the math-leaf identity, which is canonical
      // after OD-017 — otherwise optimistic edits would key on a value no
      // rollup carries, and a Direct Component would key on NULL.
      quoteSkuId: r.quoteLeafId,
      tierId: r.tierId,
      lineGroupId: r.lineGroupId,
      pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
      pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
      legacySupplier: r.supplier,
      unitCost: numOrNull(r.unitCost),
      qtyPerSellableUnit: numOrNull(r.qtyPerSellableUnit),
      category: r.category,
      markupPct: numOrNull(r.markupPct),
    }));
    const productionList = input.production;
    const cellOverrideList = input.cellOverrides;
    const cellTargetList = input.cellTargets;

    // Slice R6.2 — freight projections (per-quote leg-group / leg /
    // leg-tier / customer-arranges-meta). The store hydrates the
    // grouped arrays directly; the math input consumes the same
    // projection sans `rowId`.
    const freightLegGroupList = freightProjection.freightLegGroups;
    const freightLegList = freightProjection.freightLegs;
    const freightLegTierList = freightProjection.storedLegTiers;
    const freightCustomerArrangesMetaList =
      freightProjection.customerArrangesMeta;

    const result = computeQuoteCosting(input);


    // Slice 9.5 — load persisted warnings (active + accepted) into
    // the snapshot so the client store can attach DB ids onto
    // engine-computed specs by identity tuple, enabling per-row
    // Accept actions. Auto_resolved rows omitted (historical noise).
    const persistedWarningRows = await db
      .select()
      .from(quoteWarnings)
      .where(
        and(
          eq(quoteWarnings.quoteId, quoteId),
          inArray(quoteWarnings.status, ["active", "accepted"]),
        ),
      );

    const persistedWarnings = persistedWarningRows.map((w) => ({
      id: w.id,
      quoteId: w.quoteId,
      scope: w.scope as "line" | "quote",
      tableName: w.tableName,
      rowId: w.rowId,
      fieldName: w.fieldName,
      tierId: w.tierId,
      kind: w.kind,
      severity: w.severity as "info" | "review" | "action_required",
      status: w.status as "active" | "accepted",
      acceptReasonKind: w.acceptReasonKind,
    }));

    const snapshot: HydrateSnapshot = {
      revision: bundleRevision,
      quoteId: quote.id,
      projectId: quote.projectId,
      globalPriceAdjPct: num(quote.globalPriceAdjPct),
      targetMarginPct: numOrNull(quote.targetMarginPct),
      firmSettings: input.firmSettings,
      markupDefaults: markupMap,
      skus: skuList,
      tiers: tierList,
      packaging: packagingList,
      production: productionList,
      freightLegGroups: freightLegGroupList,
      freightLegs: freightLegList,
      freightLegTiers: freightLegTierList,
      freightCustomerArrangesMeta: freightCustomerArrangesMetaList,
      // Straight from the input the server just computed with — not re-derived
      // from the tables. Anything the client reconstructs differently is a
      // divergence, and reconstructing these was the divergence.
      freightComponentTierCosts: input.freightComponentTierCosts ?? [],
      freightShipmentBreaks: input.freightShipmentBreaks ?? [],
      cellOverrides: cellOverrideList,
      cellTargets: cellTargetList,
      // Straight from the input the server just computed with, for the same
      // reason the freight worksheet fields are: anything the client
      // reconstructs differently is a divergence, and the reconstruction IS
      // where the divergence happened last time.
      lifts: input.lifts ?? [],
      costing: result,
      persistedWarnings,
    };

    return snapshot;
  });
}

"use server";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  // Slice 11.5 — NEW-model cost-data tables (Step 2 schema).
  assemblies,
  assemblyLeafInputs,
  assemblyLeafOverrides,
  assemblyLeafTargets,
  assemblyLeaves,
  assemblyProductionInputs,
  auditLog,
  firmSettings,
  freightCustomerArrangesMeta,
  freightLegGroups,
  freightLegs,
  freightLegTiers,
  leaves,
  markupDefaults,
  quotes,
  quoteTiers,
  quoteWarnings,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  quoteByIdDraft,
  quoteForAssemblyLeaf,
} from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  computeQuoteCosting,
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";
import { buildQuoteCostingInputFromNewModel } from "@/lib/costing-adapter";
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

async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    diffJson: args.diffJson ?? {},
  });
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
}> {
  const [legGroupRows, legJoinRows, legTierJoinRows, metaJoinRows] =
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
    ]);
  return {
    legGroupRows,
    legRows: legJoinRows.map((r) => r.freight_legs),
    legTierRows: legTierJoinRows.map((r) => r.freight_leg_tiers),
    custMetaRows: metaJoinRows.map((r) => r.freight_customer_arranges_meta),
  };
}

// Project DB rows into the math-input shape (CostingFreightLeg*).
// Pure projection; no DB access. Used by all three call sites.
function projectFreightInputs(args: {
  legGroupRows: Array<typeof freightLegGroups.$inferSelect>;
  legRows: Array<typeof freightLegs.$inferSelect>;
  legTierRows: Array<typeof freightLegTiers.$inferSelect>;
  custMetaRows: Array<typeof freightCustomerArrangesMeta.$inferSelect>;
}): {
  freightLegGroups: QuoteCostingInput["freightLegGroups"];
  freightLegs: QuoteCostingInput["freightLegs"];
  freightLegTiers: QuoteCostingInput["freightLegTiers"];
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
      freightMarkupPct: num(leg.freightMarkupPct, 0.3),
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
  assemblyLeafRows: Array<typeof assemblyLeaves.$inferSelect>;
  leafRows: Array<typeof leaves.$inferSelect>;
  assemblyLeafInputRows: Array<typeof assemblyLeafInputs.$inferSelect>;
  assemblyProductionInputRows: Array<
    typeof assemblyProductionInputs.$inferSelect
  >;
  assemblyLeafOverrideRows: Array<typeof assemblyLeafOverrides.$inferSelect>;
  assemblyLeafTargetRows: Array<typeof assemblyLeafTargets.$inferSelect>;
}> {
  const [
    assemblyRows,
    assemblyLeafJoinRows,
    assemblyLeafInputJoinRows,
    assemblyProductionInputRows,
    assemblyLeafOverrideJoinRows,
    assemblyLeafTargetJoinRows,
  ] = await Promise.all([
    timed("nm.assemblies", quoteId, db
      .select()
      .from(assemblies)
      .where(eq(assemblies.quoteId, quoteId))
      .orderBy(asc(assemblies.position), asc(assemblies.createdAt))),
    timed("nm.assembly_leaves", quoteId, db
      .select({ assembly_leaves: assemblyLeaves, leaves: leaves })
      .from(assemblyLeaves)
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .innerJoin(leaves, eq(leaves.id, assemblyLeaves.leafId))
      .where(eq(assemblies.quoteId, quoteId))
      .orderBy(
        asc(assemblyLeaves.assemblyId),
        asc(assemblyLeaves.position),
      )),
    timed("nm.assembly_leaf_inputs", quoteId, db
      .select({ assembly_leaf_inputs: assemblyLeafInputs })
      .from(assemblyLeafInputs)
      .innerJoin(
        assemblyLeaves,
        eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
      )
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .where(eq(assemblies.quoteId, quoteId))
      .orderBy(
        asc(assemblyLeafInputs.sortOrder),
        asc(assemblyLeafInputs.lineGroupId),
        asc(assemblyLeafInputs.createdAt),
      )),
    timed("nm.assembly_production_inputs", quoteId, db
      .select()
      .from(assemblyProductionInputs)
      .innerJoin(
        assemblies,
        eq(assemblies.id, assemblyProductionInputs.assemblyId),
      )
      .where(eq(assemblies.quoteId, quoteId))
      .then((rows) => rows.map((r) => r.assembly_production_inputs))),
    timed("nm.assembly_leaf_overrides", quoteId, db
      .select({ assembly_leaf_overrides: assemblyLeafOverrides })
      .from(assemblyLeafOverrides)
      .innerJoin(
        assemblyLeaves,
        eq(assemblyLeaves.id, assemblyLeafOverrides.assemblyLeafId),
      )
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .where(eq(assemblies.quoteId, quoteId))),
    timed("nm.assembly_leaf_targets", quoteId, db
      .select({ assembly_leaf_targets: assemblyLeafTargets })
      .from(assemblyLeafTargets)
      .innerJoin(
        assemblyLeaves,
        eq(assemblyLeaves.id, assemblyLeafTargets.assemblyLeafId),
      )
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .where(eq(assemblies.quoteId, quoteId))),
  ]);
  // Dedupe library leaves (assembly_leaves join may surface the
  // same library leaf multiple times if reused across assemblies in
  // the same quote).
  const leafMap = new Map<string, typeof leaves.$inferSelect>();
  for (const r of assemblyLeafJoinRows) {
    leafMap.set(r.leaves.id, r.leaves);
  }
  return {
    assemblyRows,
    assemblyLeafRows: assemblyLeafJoinRows.map((r) => r.assembly_leaves),
    leafRows: Array.from(leafMap.values()),
    assemblyLeafInputRows: assemblyLeafInputJoinRows.map(
      (r) => r.assembly_leaf_inputs,
    ),
    assemblyProductionInputRows,
    assemblyLeafOverrideRows: assemblyLeafOverrideJoinRows.map(
      (r) => r.assembly_leaf_overrides,
    ),
    assemblyLeafTargetRows: assemblyLeafTargetJoinRows.map(
      (r) => r.assembly_leaf_targets,
    ),
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
    const fsRows = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);
    const fs = fsRows[0];
    if (!fs) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "firm_settings has no current row; run scripts/seed-firm-settings.mjs",
      );
    }

    // Slice 11.5 Step 3 — NEW-model read path. Load NEW-model
    // cost-data tables + freight (model-agnostic) + tiers +
    // markup_defaults; adapter builds QuoteCostingInput; math layer
    // unchanged.
    const [
      tiers,
      newModelData,
      freightLoad,
      mks,
    ] = await Promise.all([
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      loadNewModelCostDataForQuote(quoteId),
      // Slice R6.2 — multi-leg journey freight load (4 joined tables).
      loadFreightForQuote(quoteId),
      db.select().from(markupDefaults),
    ]);

    // Plain Record (not Map) so the snapshot serializes cleanly across
    // the RSC server→client boundary. See costing.ts type comment.
    const markupMap: Record<string, number> = Object.fromEntries(
      mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
    );

    const freightProjection = projectFreightInputs(freightLoad);

    // Build the library-leaf lookup so the adapter can join
    // assembly_leaves.leaf_id → leaves.name / leaves.sku.
    const leafById = new Map(newModelData.leafRows.map((l) => [l.id, l]));

    const input = buildQuoteCostingInputFromNewModel({
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
        targetMarginPct: numOrNull(quote.targetMarginPct),
      },
      firmSettings: {
        targetMarginPct: num(fs.targetMarginPct),
        floorMarginPct: num(fs.floorMarginPct),
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
      assemblyLeaves: newModelData.assemblyLeafRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          id: al.id,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        pricingDate: r.pricingDate,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
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
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      assemblyLeafTargets: newModelData.assemblyLeafTargetRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
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

// ---------- mutation: updateTierPriceAdj (Slice 9.2) ----------

// Per-tier price-adjustment override. NULL = inherit GPA; value =
// REPLACE GPA for this tier (does not stack — see CLAUDE.md "Slice 9
// pricing-control columns").
//
// Form contract: tierId, tierPriceAdjPct (percent display string, or
// empty string to clear → NULL). Audit `tier_price_adj_updated`
// records from/to including the explicit null-string for clarity.
export async function updateTierPriceAdj(
  formData: FormData,
): Promise<
  ActionResult<{ tierId: string; tierPriceAdjPct: string | null }>
> {
  return runAction(async () => {
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    const tierRows = await db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.id, tierId))
      .limit(1);
    if (tierRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
    const tier = tierRows[0];

    // Re-uses the central draft guard via the quote.
    const quote = await quoteByIdDraft(tier.quoteId);

    const newAdj = parsePercentDisplay(formData.get("tierPriceAdjPct"), {
      field: "tierPriceAdjPct",
      label: "Tier price adjustment",
      nullable: true,
      minPercent: -99.99,
      maxPercent: 999,
    });

    if (numericEquals(tier.tierPriceAdjPct, newAdj)) {
      return { tierId, tierPriceAdjPct: tier.tierPriceAdjPct };
    }

    await db
      .update(quoteTiers)
      .set({ tierPriceAdjPct: newAdj, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tierId));

    await logAudit({
      userId: user.id,
      entityType: "quote_tier",
      entityId: tierId,
      action: "tier_price_adj_updated",
      diffJson: {
        tier_price_adj_pct: {
          from: tier.tierPriceAdjPct,
          to: newAdj,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { tierId, tierPriceAdjPct: newAdj };
  });
}

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
    quoteSkuId: string;
    tierId: string;
    sellPriceOverride: string | null;
  }>
> {
  return runAction(async () => {
    const assemblyLeafId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!assemblyLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    // Quote draft + ownership through the assembly_leaf.
    const { quote } = await quoteForAssemblyLeaf(assemblyLeafId);

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
          eq(assemblyLeafOverrides.assemblyLeafId, assemblyLeafId),
          eq(assemblyLeafOverrides.tierId, tierId),
        ),
      )
      .limit(1);
    const previousValue =
      existingRows.length > 0 ? existingRows[0].sellPriceOverride : null;

    // No-op: incoming value matches stored value.
    if (numericEquals(previousValue, parsedValue?.toString() ?? null)) {
      return {
        quoteSkuId: assemblyLeafId,
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
            eq(assemblyLeafOverrides.assemblyLeafId, assemblyLeafId),
            eq(assemblyLeafOverrides.tierId, tierId),
          ),
        );
      storedValue = null;
    } else {
      const stored = parsedValue.toString();
      await db
        .insert(assemblyLeafOverrides)
        .values({
          assemblyLeafId,
          tierId,
          sellPriceOverride: stored,
        })
        .onConflictDoUpdate({
          target: [
            assemblyLeafOverrides.assemblyLeafId,
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
      entityId: `${assemblyLeafId}:${tierId}`,
      action: "assembly_leaf_sell_override_updated",
      diffJson: {
        assembly_leaf_id: assemblyLeafId,
        tier_id: tierId,
        sell_price_override: {
          from: previousValue,
          to: storedValue,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteSkuId: assemblyLeafId,
      tierId,
      sellPriceOverride: storedValue,
    };
  });
}

// ---------- mutation: updateAssemblyLeafTarget (Slice 11.5) ----------
//
// Per-cell client target benchmark on the (assembly_leaf, tier) cell.
// NEW-model successor to OLD `updateClientTarget` per brief §4.
// Single action handles set + change + clear via the value-or-null
// parameter; one audit row per state change with `action:
// "assembly_leaf_client_target_updated"`; the from/to encodes the
// transition.
//
// DB shape: `assembly_leaf_targets` is a sparse sister table to
// `assembly_leaf_overrides`. Different concern (customer-stated
// benchmark vs PM-authored override) but identical shape. Lazy rows;
// NOT NULL on `client_target_price_per_unit` enforces "row exists
// ⟹ benchmark is set" at the schema level.
//   - value === null  → DELETE the row
//   - value > 0       → INSERT ON CONFLICT (PK) DO UPDATE
//   - value <= 0      → reject (action layer guard).
//
// Leaf-only invariant inherent in schema (FK to assembly_leaves;
// assemblies cannot carry targets — they roll up children).
//
// Audit source: no `source` flag. Per CLAUDE.md "Audit source
// convention" — set/change/clear on the same column = same semantic,
// share `action`, distinguish via from/to.
export async function updateAssemblyLeafTarget(
  formData: FormData,
): Promise<
  ActionResult<{
    quoteSkuId: string;
    tierId: string;
    clientTargetPricePerUnit: string | null;
  }>
> {
  return runAction(async () => {
    const assemblyLeafId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!assemblyLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    const { quote } = await quoteForAssemblyLeaf(assemblyLeafId);

    // Verify tier belongs to the same quote.
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

    const rawValue = String(
      formData.get("clientTargetPricePerUnit") ?? "",
    ).trim();
    let parsedValue: number | null;
    if (rawValue === "") {
      parsedValue = null;
    } else {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Client target must be a number.",
        );
      }
      if (n <= 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Client target must be greater than zero. To remove a benchmark, clear the field.",
        );
      }
      parsedValue = n;
    }

    const existingRows = await db
      .select()
      .from(assemblyLeafTargets)
      .where(
        and(
          eq(assemblyLeafTargets.assemblyLeafId, assemblyLeafId),
          eq(assemblyLeafTargets.tierId, tierId),
        ),
      )
      .limit(1);
    const previousValue =
      existingRows.length > 0
        ? existingRows[0].clientTargetPricePerUnit
        : null;

    if (numericEquals(previousValue, parsedValue?.toString() ?? null)) {
      return {
        quoteSkuId: assemblyLeafId,
        tierId,
        clientTargetPricePerUnit: previousValue,
      };
    }

    let storedValue: string | null;
    if (parsedValue === null) {
      await db
        .delete(assemblyLeafTargets)
        .where(
          and(
            eq(assemblyLeafTargets.assemblyLeafId, assemblyLeafId),
            eq(assemblyLeafTargets.tierId, tierId),
          ),
        );
      storedValue = null;
    } else {
      const stored = parsedValue.toString();
      await db
        .insert(assemblyLeafTargets)
        .values({
          assemblyLeafId,
          tierId,
          clientTargetPricePerUnit: stored,
        })
        .onConflictDoUpdate({
          target: [
            assemblyLeafTargets.assemblyLeafId,
            assemblyLeafTargets.tierId,
          ],
          set: {
            clientTargetPricePerUnit: stored,
            updatedAt: new Date(),
          },
        });
      storedValue = stored;
    }

    await logAudit({
      userId: user.id,
      entityType: "assembly_leaf_target",
      entityId: `${assemblyLeafId}:${tierId}`,
      action: "assembly_leaf_client_target_updated",
      diffJson: {
        assembly_leaf_id: assemblyLeafId,
        tier_id: tierId,
        client_target_price_per_unit: {
          from: previousValue,
          to: storedValue,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteSkuId: assemblyLeafId,
      tierId,
      clientTargetPricePerUnit: storedValue,
    };
  });
}

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
    const fsRows = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);
    const fs = fsRows[0];
    if (!fs) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "firm_settings has no current row.",
      );
    }
    // Slice 11.5 Step 3 — NEW-model read path (mirrors getQuoteCosting).
    const [tiersFresh, newModelData, freightLoad, mks] = await Promise.all([
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      loadNewModelCostDataForQuote(quoteId),
      // Slice R6.2 — multi-leg journey freight load.
      loadFreightForQuote(quoteId),
      db.select().from(markupDefaults),
    ]);

    const markupMap: Record<string, number> = Object.fromEntries(
      mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
    );

    const freightProjection = projectFreightInputs(freightLoad);

    const leafById = new Map(newModelData.leafRows.map((l) => [l.id, l]));

    const input = buildQuoteCostingInputFromNewModel({
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
        targetMarginPct: numOrNull(quote.targetMarginPct),
      },
      firmSettings: {
        targetMarginPct: num(fs.targetMarginPct),
        floorMarginPct: num(fs.floorMarginPct),
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
      assemblyLeaves: newModelData.assemblyLeafRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          id: al.id,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        pricingDate: r.pricingDate,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
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
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      assemblyLeafTargets: newModelData.assemblyLeafTargetRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
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
): Promise<ActionResult<HydrateSnapshot>> {
  return runAction(async () => {
    const bundleT0 = Date.now();
    const quoteRows = await timed("quote_lookup", quoteId, db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1));
    if (quoteRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    const quote = quoteRows[0];

    const fsRows = await timed("firm_settings", quoteId, db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1));
    const fs = fsRows[0];
    if (!fs) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "firm_settings has no current row; run scripts/seed-firm-settings.mjs",
      );
    }

    // Slice 11.5 Step 3 — NEW-model read path. Load NEW-model
    // cost-data + freight (model-agnostic) + tiers + markup_defaults
    // in parallel. Adapter builds QuoteCostingInput; math layer
    // unchanged. The HydrateSnapshot is constructed below directly
    // from the input + raw NEW-model rows (rowId attached for the
    // store's optimistic-edit pattern).
    const [tiers, newModelData, freightLoad, mks] = await Promise.all([
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
      timed("markup_defaults", quoteId, db.select().from(markupDefaults)),
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
    const markupMap: Record<string, number> = Object.fromEntries(
      mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
    );

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
      },
      firmSettings: {
        targetMarginPct: num(fs.targetMarginPct),
        floorMarginPct: num(fs.floorMarginPct),
      },
      markupDefaults: markupMap,
      tiers: tierList,
      assemblies: newModelData.assemblyRows.map((a) => ({
        id: a.id,
        sku: a.sku,
        name: a.name,
        position: a.position,
      })),
      assemblyLeaves: newModelData.assemblyLeafRows.map((al) => {
        const lib = leafById.get(al.leafId);
        return {
          id: al.id,
          assemblyId: al.assemblyId,
          leafId: al.leafId,
          quantity: al.quantity,
          position: al.position,
          leafName: lib?.name ?? "",
          leafSku: lib?.sku ?? "",
        };
      }),
      assemblyLeafInputs: newModelData.assemblyLeafInputRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        lineGroupId: r.lineGroupId,
        pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
        pricingDate: r.pricingDate,
        unitCost: r.unitCost,
        qtyPerSellableUnit: r.qtyPerSellableUnit,
        category: r.category,
        markupPct: r.markupPct,
      })),
      assemblyProductionInputs: newModelData.assemblyProductionInputRows.map(
        (r) => ({
          assemblyId: r.assemblyId,
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
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        sellPriceOverride: r.sellPriceOverride,
      })),
      assemblyLeafTargets: newModelData.assemblyLeafTargetRows.map((r) => ({
        assemblyLeafId: r.assemblyLeafId,
        tierId: r.tierId,
        clientTargetPricePerUnit: r.clientTargetPricePerUnit,
      })),
      freightLegGroups: freightProjection.freightLegGroups,
      freightLegs: freightProjection.freightLegs,
      freightLegTiers: freightProjection.freightLegTiers,
    });

    // Snapshot-shape derivations from the input + raw rows. The
    // snapshot's packaging[] / production[] / cellOverrides[] /
    // cellTargets[] match the math input shape but the store
    // additionally tracks `rowId` on packaging (for optimistic
    // row-id-keyed edits per Slice 8 sub-step 3 pattern).
    const skuList = input.skus;
    const packagingList = newModelData.assemblyLeafInputRows.map((r) => ({
      rowId: r.id,
      quoteSkuId: r.assemblyLeafId,
      tierId: r.tierId,
      lineGroupId: r.lineGroupId,
      pricingVendorHubspotCompanyId: r.pricingVendorHubspotCompanyId,
      pricingVendorNameSnapshot: r.pricingVendorNameSnapshot,
      pricingDate: r.pricingDate,
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
      cellOverrides: cellOverrideList,
      cellTargets: cellTargetList,
      costing: result,
      persistedWarnings,
    };

    return snapshot;
  });
}

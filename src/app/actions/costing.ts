"use server";

import { asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  firmSettings,
  freightInputs,
  markupDefaults,
  packagingInputs,
  productionInputs,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";
import type { HydrateSnapshot } from "@/lib/costing-store";

// ---------- helpers ----------

type Diff = Record<string, { from: unknown; to: unknown }>;

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

// Convert a percent-display string ("5" for 5%) into the decimal stored in
// DB ("0.0500"). Empty/null → null. Per CLAUDE.md percent convention.
function percentDisplayToDecimal(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toString();
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function num(v: string | null, fallback = 0): number {
  return numOrNull(v) ?? fallback;
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

    const [skus, tiers, pkgs, prods, frts, mks] = await Promise.all([
      db
        .select()
        .from(quoteSkus)
        .where(eq(quoteSkus.quoteId, quoteId))
        .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt)),
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      db
        .select()
        .from(packagingInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(productionInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(freightInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db.select().from(markupDefaults),
    ]);

    // Plain Record (not Map) so the snapshot serializes cleanly across
    // the RSC server→client boundary. See costing.ts type comment.
    const markupMap: Record<string, number> = Object.fromEntries(
      mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
    );

    const input: QuoteCostingInput = {
      quote: {
        id: quote.id,
        globalPriceAdjPct: num(quote.globalPriceAdjPct),
      },
      firmSettings: {
        targetMarginPct: num(fs.targetMarginPct),
        floorMarginPct: num(fs.floorMarginPct),
      },
      markupDefaults: markupMap,
      skus: skus.map((s) => ({
        id: s.id,
        parentSkuId: s.parentSkuId,
        qtyPerParent: numOrNull(s.qtyPerParent),
        skuRole: s.skuRole as "leaf" | "assembly",
        skuLabel: s.skuLabel,
        productName: s.productName,
        sortOrder: s.sortOrder,
        dutyPct: numOrNull(s.dutyPct),
        tariffPct: numOrNull(s.tariffPct),
      })),
      tiers: tiers.map((t) => ({
        id: t.id,
        label: t.label,
        qty: t.qty,
        sortOrder: t.sortOrder,
      })),
      packaging: pkgs.map((r) => {
        const p = r.packaging_inputs;
        return {
          quoteSkuId: p.quoteSkuId,
          tierId: p.tierId,
          lineGroupId: p.lineGroupId,
          unitCost: numOrNull(p.unitCost),
          qtyPerSellableUnit: numOrNull(p.qtyPerSellableUnit),
          category: p.category,
          markupPct: numOrNull(p.markupPct),
        };
      }),
      production: prods.map((r) => {
        const p = r.production_inputs;
        return {
          quoteSkuId: p.quoteSkuId,
          tierId: p.tierId,
          customerShipsRaws: p.customerShipsRaws,
          allocateServiceFeesToCost: p.allocateServiceFeesToCost,
          fillingBlendingCost: numOrNull(p.fillingBlendingCost),
          cmAssemblyTotal: numOrNull(p.cmAssemblyTotal),
          setupFeeTotal: numOrNull(p.setupFeeTotal),
          toolingArtworkTotal: numOrNull(p.toolingArtworkTotal),
          rdTotal: numOrNull(p.rdTotal),
          otherServiceTotal: numOrNull(p.otherServiceTotal),
          bulkRawCost: numOrNull(p.bulkRawCost),
          actualUnitsProduced: p.actualUnitsProduced,
        };
      }),
      freight: frts.map((r) => {
        const f = r.freight_inputs;
        return {
          quoteSkuId: f.quoteSkuId,
          tierId: f.tierId,
          lineGroupId: f.lineGroupId,
          totalFreight: numOrNull(f.totalFreight),
          unitsInShipment: f.unitsInShipment,
          skuTotalCbm: numOrNull(f.skuTotalCbm),
          markupPct: numOrNull(f.markupPct),
          freightTreatment: f.freightTreatment,
        };
      }),
    };

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

    const newAdj = percentDisplayToDecimal(formData.get("globalPriceAdjPct"));

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
    const quoteRows = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (quoteRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    const quote = quoteRows[0];

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

    const [skus, tiers, pkgs, prods, frts, mks] = await Promise.all([
      db
        .select()
        .from(quoteSkus)
        .where(eq(quoteSkus.quoteId, quoteId))
        .orderBy(asc(quoteSkus.sortOrder), asc(quoteSkus.createdAt)),
      db
        .select()
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId))
        .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
      db
        .select()
        .from(packagingInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(productionInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db
        .select()
        .from(freightInputs)
        .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      db.select().from(markupDefaults),
    ]);

    // Plain Record (not Map) so the snapshot serializes cleanly across
    // the RSC server→client boundary. See costing.ts type comment.
    const markupMap: Record<string, number> = Object.fromEntries(
      mks.map((m) => [m.category, Number(m.defaultMarkupPct)]),
    );

    const skuList = skus.map((s) => ({
      id: s.id,
      parentSkuId: s.parentSkuId,
      qtyPerParent: numOrNull(s.qtyPerParent),
      skuRole: s.skuRole as "leaf" | "assembly",
      skuLabel: s.skuLabel,
      productName: s.productName,
      sortOrder: s.sortOrder,
      dutyPct: numOrNull(s.dutyPct),
      tariffPct: numOrNull(s.tariffPct),
    }));

    const tierList = tiers.map((t) => ({
      id: t.id,
      label: t.label,
      qty: t.qty,
      sortOrder: t.sortOrder,
    }));

    const packagingList = pkgs.map((r) => {
      const p = r.packaging_inputs;
      return {
        rowId: p.id,
        quoteSkuId: p.quoteSkuId,
        tierId: p.tierId,
        lineGroupId: p.lineGroupId,
        unitCost: numOrNull(p.unitCost),
        qtyPerSellableUnit: numOrNull(p.qtyPerSellableUnit),
        category: p.category,
        markupPct: numOrNull(p.markupPct),
      };
    });

    const productionList = prods.map((r) => {
      const p = r.production_inputs;
      return {
        quoteSkuId: p.quoteSkuId,
        tierId: p.tierId,
        customerShipsRaws: p.customerShipsRaws,
        allocateServiceFeesToCost: p.allocateServiceFeesToCost,
        fillingBlendingCost: numOrNull(p.fillingBlendingCost),
        cmAssemblyTotal: numOrNull(p.cmAssemblyTotal),
        setupFeeTotal: numOrNull(p.setupFeeTotal),
        toolingArtworkTotal: numOrNull(p.toolingArtworkTotal),
        rdTotal: numOrNull(p.rdTotal),
        otherServiceTotal: numOrNull(p.otherServiceTotal),
        bulkRawCost: numOrNull(p.bulkRawCost),
        actualUnitsProduced: p.actualUnitsProduced,
      };
    });

    const freightList = frts.map((r) => {
      const f = r.freight_inputs;
      return {
        rowId: f.id,
        quoteSkuId: f.quoteSkuId,
        tierId: f.tierId,
        lineGroupId: f.lineGroupId,
        totalFreight: numOrNull(f.totalFreight),
        unitsInShipment: f.unitsInShipment,
        skuTotalCbm: numOrNull(f.skuTotalCbm),
        markupPct: numOrNull(f.markupPct),
        freightTreatment: f.freightTreatment,
      };
    });

    const input: QuoteCostingInput = {
      quote: { id: quote.id, globalPriceAdjPct: num(quote.globalPriceAdjPct) },
      firmSettings: {
        targetMarginPct: num(fs.targetMarginPct),
        floorMarginPct: num(fs.floorMarginPct),
      },
      markupDefaults: markupMap,
      skus: skuList,
      tiers: tierList,
      packaging: packagingList,
      production: productionList,
      freight: freightList,
    };

    const result = computeQuoteCosting(input);

    const snapshot: HydrateSnapshot = {
      quoteId: quote.id,
      projectId: quote.projectId,
      globalPriceAdjPct: num(quote.globalPriceAdjPct),
      firmSettings: input.firmSettings,
      markupDefaults: markupMap,
      skus: skuList,
      tiers: tierList,
      packaging: packagingList,
      production: productionList,
      freight: freightList,
      costing: result,
    };

    return snapshot;
  });
}

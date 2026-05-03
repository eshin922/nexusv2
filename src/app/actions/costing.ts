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
        targetMarginPct: numOrNull(quote.targetMarginPct),
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
        tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
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

    const newAdj = percentDisplayToDecimal(formData.get("tierPriceAdjPct"));

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

    const newTarget = percentDisplayToDecimal(formData.get("targetMarginPct"));

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
// Costing Sheet that applies the closed-form GPA reverse-solve.
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

    const newAdj = percentDisplayToDecimal(formData.get("suggestedAdj"));
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
      tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
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
      targetMarginPct: numOrNull(quote.targetMarginPct),
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

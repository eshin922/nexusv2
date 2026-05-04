"use server";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
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
  quoteSkuTiers,
  quoteSkuTierTargets,
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
import { quoteByIdDraft, quoteForSku } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  computeQuoteCosting,
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
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

    const [skus, tiers, pkgs, prods, frts, mks, cellOvr, cellTgt] = await Promise.all([
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
      // Slice 9.3 — sparse load: only rows that exist for this quote's
      // SKUs. Empty result = no overrides anywhere. INNER JOIN on
      // quote_skus to scope by quote_id (quote_sku_tiers itself doesn't
      // carry quote_id).
      db
        .select({
          quoteSkuId: quoteSkuTiers.quoteSkuId,
          tierId: quoteSkuTiers.tierId,
          sellPriceOverride: quoteSkuTiers.sellPriceOverride,
        })
        .from(quoteSkuTiers)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTiers.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      // Slice 9.4b — sparse load of per-cell client target benchmarks.
      // Mirror Slice 9.3 cellOverrides query shape.
      db
        .select({
          quoteSkuId: quoteSkuTierTargets.quoteSkuId,
          tierId: quoteSkuTierTargets.tierId,
          clientTargetPricePerUnit: quoteSkuTierTargets.clientTargetPricePerUnit,
        })
        .from(quoteSkuTierTargets)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTierTargets.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
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
        retailBenchmark: numOrNull(s.retailBenchmark),
      })),
      tiers: tiers.map((t) => ({
        id: t.id,
        label: t.label,
        qty: t.qty,
        sortOrder: t.sortOrder,
        tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
      })),
      cellOverrides: cellOvr.map((c) => ({
        quoteSkuId: c.quoteSkuId,
        tierId: c.tierId,
        sellPriceOverride: num(c.sellPriceOverride),
      })),
      cellTargets: cellTgt.map((c) => ({
        quoteSkuId: c.quoteSkuId,
        tierId: c.tierId,
        clientTargetPricePerUnit: num(c.clientTargetPricePerUnit),
      })),
      // Slice 9.4c — quote-level (per-tier) client targets. Sparse:
      // emit only tiers where clientTargetPriceTotal is non-null.
      // Engine looks up by tierId; missing tier reads as null
      // (NULL-as-empty-signal).
      quoteTierTargets: tiers
        .filter((t) => t.clientTargetPriceTotal !== null)
        .map((t) => ({
          tierId: t.id,
          clientTargetPriceTotal: num(t.clientTargetPriceTotal),
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

// ---------- mutation: updateSellPriceOverride (Slice 9.3) ----------

// Per-cell sell-price override on the (quote_sku, tier) cell. Single
// action handles both set and clear via the value-or-null parameter,
// matching the Slice 9.2 precedent (`updateTierPriceAdj`,
// `updateQuoteTargetMargin`). One audit row per state change with
// `action: "cell_override_updated"`; the from/to encodes the
// transition (set: from null, to value; change: from old, to new;
// clear: from value, to null).
//
// DB shape: `quote_sku_tiers` is a sparse table — rows exist ONLY for
// cells with overrides. NOT NULL on `sell_price_override` enforces
// "row exists ⟹ override is set" at the schema level.
//   - value === null  → DELETE the row
//   - value > 0       → INSERT ON CONFLICT (PK) DO UPDATE
//   - value <= 0      → reject (action layer guard); zero or negative
//                       sell price isn't a legitimate quoting scenario
//                       and would break partition revenue invariants.
//                       To clear an override, send empty input (→ null
//                       at the action) which DELETEs the row.
//
// Leaf-only invariant: overrides only apply to leaf SKUs. Assemblies
// roll up children's `requiredSellPerUnit`; overriding an assembly
// cell would orphan the children's computation. Action rejects on
// non-leaf SKU. UI hides the click-to-override affordance on assembly
// rows (defense in depth).
export async function updateSellPriceOverride(
  formData: FormData,
): Promise<
  ActionResult<{
    quoteSkuId: string;
    tierId: string;
    sellPriceOverride: string | null;
  }>
> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    // Quote draft + ownership through the SKU. Returns the quote and
    // sku rows; throws QUOTE_NOT_DRAFT or NOT_FOUND on failure.
    const { quote, sku } = await quoteForSku(quoteSkuId);

    // Leaf-only invariant. Overrides on assembly cells would orphan
    // the rolled-up children's computation; the math layer trusts
    // overrides are leaf-cell-terminal.
    if (sku.skuRole !== "leaf") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Sell-price overrides only apply to leaf SKUs.",
      );
    }

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
    const rawValue = String(formData.get("sellPriceOverride") ?? "").trim();
    let parsedValue: number | null;
    if (rawValue === "") {
      parsedValue = null;
    } else {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Sell price must be a number.",
        );
      }
      // Reject non-positive values per architect's defensive guard:
      // zero/negative breaks revenue contribution invariants and isn't
      // a legitimate PM quoting scenario. To clear an override, send
      // empty input (the dedicated revert path).
      if (n <= 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Sell price must be greater than zero. To remove an override, use the ↺ revert affordance.",
        );
      }
      parsedValue = n;
    }

    // Read previous value (if any) for the audit diff.
    const existingRows = await db
      .select()
      .from(quoteSkuTiers)
      .where(
        and(
          eq(quoteSkuTiers.quoteSkuId, quoteSkuId),
          eq(quoteSkuTiers.tierId, tierId),
        ),
      )
      .limit(1);
    const previousValue =
      existingRows.length > 0 ? existingRows[0].sellPriceOverride : null;

    // No-op: incoming value matches stored value.
    if (numericEquals(previousValue, parsedValue?.toString() ?? null)) {
      return { quoteSkuId, tierId, sellPriceOverride: previousValue };
    }

    let storedValue: string | null;
    if (parsedValue === null) {
      // Clear: DELETE the row. If no row existed (previousValue null),
      // the no-op short-circuit above already returned; reaching here
      // means there was a row to delete.
      await db
        .delete(quoteSkuTiers)
        .where(
          and(
            eq(quoteSkuTiers.quoteSkuId, quoteSkuId),
            eq(quoteSkuTiers.tierId, tierId),
          ),
        );
      storedValue = null;
    } else {
      // Set or update: INSERT ON CONFLICT. The composite PK
      // (quote_sku_id, tier_id) is the conflict target.
      const stored = parsedValue.toString();
      await db
        .insert(quoteSkuTiers)
        .values({
          quoteSkuId,
          tierId,
          sellPriceOverride: stored,
        })
        .onConflictDoUpdate({
          target: [quoteSkuTiers.quoteSkuId, quoteSkuTiers.tierId],
          set: { sellPriceOverride: stored, updatedAt: new Date() },
        });
      storedValue = stored;
    }

    // Audit. entity_id is the synthesized composite key (text per
    // CLAUDE.md "audit_log.entity_id is text"). diff_json carries
    // both component keys for query convenience.
    await logAudit({
      userId: user.id,
      entityType: "quote_sku_tier",
      entityId: `${quoteSkuId}:${tierId}`,
      action: "cell_override_updated",
      diffJson: {
        quote_sku_id: quoteSkuId,
        tier_id: tierId,
        sell_price_override: {
          from: previousValue,
          to: storedValue,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { quoteSkuId, tierId, sellPriceOverride: storedValue };
  });
}

// ---------- mutation: updateClientTarget (Slice 9.4b) ----------

// Per-cell client target benchmark on the (quote_sku, tier) cell.
// Single action handles set + change + clear via the value-or-null
// parameter (matches Slice 9.3 `updateSellPriceOverride` pattern;
// Slice 9.2 `updateTierPriceAdj`; Slice 9.2 `updateQuoteTargetMargin`).
// One audit row per state change with `action: "cell_target_updated"`;
// the from/to encodes the transition.
//
// DB shape: `quote_sku_tier_targets` is a sparse sister table to
// `quote_sku_tiers`. Different concern (customer-stated benchmark vs
// PM-authored override) but identical shape. Lazy rows; NOT NULL on
// `client_target_price_per_unit` enforces "row exists ⟹ benchmark
// is set" at the schema level. See CLAUDE.md "Slice 9 pricing-control
// columns" for the architect's sister-table-vs-single-table rationale.
//   - value === null  → DELETE the row
//   - value > 0       → INSERT ON CONFLICT (PK) DO UPDATE
//   - value <= 0      → reject (action layer guard); zero or negative
//                       benchmark isn't a legitimate quoting scenario.
//                       To clear a benchmark, send empty input → null
//                       → DELETE.
//
// Leaf-only invariant — matches Slice 9.3 sell-price-override
// invariant. Client targets are stated by customers at the SKU level
// (this surface) or the quote level (Slice 9.4c, separate column on
// `quote_tiers`). Assembly-level targets are not a real workflow case
// — surfaced during 9.4b smoke as a workflow correction; the prep PR
// erroneously shipped assembly support which was stripped before
// commit. Schema (`quote_sku_tier_targets`) accepts any role, but
// the runtime guard rejects non-leaf — same posture as
// `updateSellPriceOverride`.
//
// Audit source: no `source` flag. Per CLAUDE.md "Audit source convention"
// — set/change/clear on the same column = same semantic, share `action`,
// distinguish via from/to. Source flags reserved for non-default
// origins (system suggestions, scenario apply, bulk imports).
export async function updateClientTarget(
  formData: FormData,
): Promise<
  ActionResult<{
    quoteSkuId: string;
    tierId: string;
    clientTargetPricePerUnit: string | null;
  }>
> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    // Quote draft + ownership through the SKU. Returns the quote and
    // sku rows; throws QUOTE_NOT_DRAFT or NOT_FOUND on failure.
    const { quote, sku } = await quoteForSku(quoteSkuId);

    // Leaf-only invariant. Mirrors Slice 9.3 `updateSellPriceOverride`.
    // Client targets are SKU-level (this surface) or quote-level (Slice
    // 9.4c); assembly-level was scope creep removed during 9.4b smoke.
    if (sku.skuRole !== "leaf") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Client targets only apply to leaf SKUs.",
      );
    }

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
      // Reject non-positive values. Mirrors Slice 9.3 sell-override
      // invariant — non-positive prices break revenue math + reverse-
      // solve invariants. To clear the target, send empty input.
      if (n <= 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Client target must be greater than zero. To remove a benchmark, clear the field.",
        );
      }
      parsedValue = n;
    }

    // Read previous value (if any) for the audit diff.
    const existingRows = await db
      .select()
      .from(quoteSkuTierTargets)
      .where(
        and(
          eq(quoteSkuTierTargets.quoteSkuId, quoteSkuId),
          eq(quoteSkuTierTargets.tierId, tierId),
        ),
      )
      .limit(1);
    const previousValue =
      existingRows.length > 0
        ? existingRows[0].clientTargetPricePerUnit
        : null;

    // No-op: incoming value matches stored value (within precision).
    if (numericEquals(previousValue, parsedValue?.toString() ?? null)) {
      return {
        quoteSkuId,
        tierId,
        clientTargetPricePerUnit: previousValue,
      };
    }

    let storedValue: string | null;
    if (parsedValue === null) {
      // Clear: DELETE the row. The no-op short-circuit above already
      // handled the "nothing to clear" case; reaching here means a
      // row exists.
      await db
        .delete(quoteSkuTierTargets)
        .where(
          and(
            eq(quoteSkuTierTargets.quoteSkuId, quoteSkuId),
            eq(quoteSkuTierTargets.tierId, tierId),
          ),
        );
      storedValue = null;
    } else {
      // Set or update: INSERT ON CONFLICT. Composite PK is conflict target.
      const stored = parsedValue.toString();
      await db
        .insert(quoteSkuTierTargets)
        .values({
          quoteSkuId,
          tierId,
          clientTargetPricePerUnit: stored,
        })
        .onConflictDoUpdate({
          target: [
            quoteSkuTierTargets.quoteSkuId,
            quoteSkuTierTargets.tierId,
          ],
          set: { clientTargetPricePerUnit: stored, updatedAt: new Date() },
        });
      storedValue = stored;
    }

    // Audit. entity_id is the synthesized composite key (text per
    // CLAUDE.md "audit_log.entity_id is text"). entity_type is
    // "quote_sku_tier_target" — distinct from "quote_sku_tier" used
    // by sell-price overrides — so audit timeline queries can filter
    // benchmark changes from override changes natively.
    await logAudit({
      userId: user.id,
      entityType: "quote_sku_tier_target",
      entityId: `${quoteSkuId}:${tierId}`,
      action: "cell_target_updated",
      diffJson: {
        quote_sku_id: quoteSkuId,
        tier_id: tierId,
        client_target_price_per_unit: {
          from: previousValue,
          to: storedValue,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteSkuId,
      tierId,
      clientTargetPricePerUnit: storedValue,
    };
  });
}

// ---------- mutation: updateQuoteLevelClientTarget (Slice 9.4c) ----------

// Quote-level client target on the (quote, tier) cell. Direct column
// on `quote_tiers.client_target_price_total` (NOT a sister table —
// per-tier granularity matches `tierPriceAdjPct` precedent; sister-
// table justification — column count + lifecycle independence —
// doesn't apply at quote-tier level).
//
// Set + change + clear via the value-or-null parameter (mirrors
// `updateClientTarget` per-cell pattern). One audit row per state
// change with `action: "quote_level_client_target_updated"`; from/to
// encodes the transition. No `source` flag — set/change/clear on a
// single column = same semantic per CLAUDE.md "Audit source convention."
//
// Distinct from `updateClientTarget` (per-cell, per-unit, on the
// sparse sister table). Per-unit-vs-total asymmetry IS the customer-
// stated reality: customers state "$X for THIS SKU at 50k units" OR
// "$Y for the whole package at 50k" — different negotiation
// surfaces, different storage. See migration 0018 column comment +
// CLAUDE.md "Slice 9 pricing-control columns" for the rationale.
//
//   - value === null  → clear (UPDATE … SET … = NULL)
//   - value > 0       → set (UPDATE … SET … = value)
//   - value <= 0      → reject (action layer guard); zero or negative
//                       target isn't a legitimate quoting scenario.
//                       To clear, send empty input → null.
//
// Form contract: tierId, clientTargetPriceTotal (numeric dollar
// string, or empty string to clear → NULL).
export async function updateQuoteLevelClientTarget(
  formData: FormData,
): Promise<
  ActionResult<{ tierId: string; clientTargetPriceTotal: string | null }>
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

    // Parse the value. Empty input → null → clear; non-empty → numeric.
    const rawValue = String(
      formData.get("clientTargetPriceTotal") ?? "",
    ).trim();
    let parsedValue: number | null;
    if (rawValue === "") {
      parsedValue = null;
    } else {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Quote-level client target must be a number.",
        );
      }
      // Reject non-positive — same posture as per-cell `updateClientTarget`.
      // Zero/negative quote target breaks the COMPETITIVE/OVER verdict
      // (target ≥ revenue is the predicate; non-positive forces every
      // populated quote to OVER_CLIENT_TARGET).
      if (n <= 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Quote-level client target must be greater than zero. To remove a target, clear the field.",
        );
      }
      parsedValue = n;
    }

    const newStored = parsedValue === null ? null : parsedValue.toString();

    if (numericEquals(tier.clientTargetPriceTotal, newStored)) {
      return {
        tierId,
        clientTargetPriceTotal: tier.clientTargetPriceTotal,
      };
    }

    await db
      .update(quoteTiers)
      .set({ clientTargetPriceTotal: newStored, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tierId));

    await logAudit({
      userId: user.id,
      entityType: "quote_tier",
      entityId: tierId,
      action: "quote_level_client_target_updated",
      diffJson: {
        client_target_price_total: {
          from: tier.clientTargetPriceTotal,
          to: newStored,
        },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { tierId, clientTargetPriceTotal: newStored };
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
    const [skus, tiersFresh, pkgs, prods, frts, mks, cellOvr, cellTgt] =
      await Promise.all([
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
        db
          .select({
            quoteSkuId: quoteSkuTiers.quoteSkuId,
            tierId: quoteSkuTiers.tierId,
            sellPriceOverride: quoteSkuTiers.sellPriceOverride,
          })
          .from(quoteSkuTiers)
          .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTiers.quoteSkuId))
          .where(eq(quoteSkus.quoteId, quoteId)),
        db
          .select({
            quoteSkuId: quoteSkuTierTargets.quoteSkuId,
            tierId: quoteSkuTierTargets.tierId,
            clientTargetPricePerUnit:
              quoteSkuTierTargets.clientTargetPricePerUnit,
          })
          .from(quoteSkuTierTargets)
          .innerJoin(
            quoteSkus,
            eq(quoteSkus.id, quoteSkuTierTargets.quoteSkuId),
          )
          .where(eq(quoteSkus.quoteId, quoteId)),
      ]);

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
        retailBenchmark: numOrNull(s.retailBenchmark),
      })),
      tiers: tiersFresh.map((t) => ({
        id: t.id,
        label: t.label,
        qty: t.qty,
        sortOrder: t.sortOrder,
        tierPriceAdjPct: numOrNull(t.tierPriceAdjPct),
      })),
      cellOverrides: cellOvr.map((c) => ({
        quoteSkuId: c.quoteSkuId,
        tierId: c.tierId,
        sellPriceOverride: num(c.sellPriceOverride),
      })),
      cellTargets: cellTgt.map((c) => ({
        quoteSkuId: c.quoteSkuId,
        tierId: c.tierId,
        clientTargetPricePerUnit: num(c.clientTargetPricePerUnit),
      })),
      // Slice 9.4c — quote-level (per-tier) client targets. Sparse:
      // emit only tiers where clientTargetPriceTotal is non-null.
      // Engine looks up by tierId; missing tier reads as null
      // (NULL-as-empty-signal).
      quoteTierTargets: tiersFresh
        .filter((t) => t.clientTargetPriceTotal !== null)
        .map((t) => ({
          tierId: t.id,
          clientTargetPriceTotal: num(t.clientTargetPriceTotal),
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

    // Defense in depth — leaf-only invariant on the origin cell.
    // `updateClientTarget` already rejects assembly writes, so any
    // assembly-origin solve must be forged FormData. Same posture as
    // updateClientTarget's leaf guard.
    const originSku = skus.find((s) => s.id === suggestedSkuId);
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

    const [skus, tiers, pkgs, prods, frts, mks, cellOvr, cellTgt] = await Promise.all([
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
      // Slice 9.3 — sparse load of cell-level sell-price overrides.
      db
        .select({
          quoteSkuId: quoteSkuTiers.quoteSkuId,
          tierId: quoteSkuTiers.tierId,
          sellPriceOverride: quoteSkuTiers.sellPriceOverride,
        })
        .from(quoteSkuTiers)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTiers.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
      // Slice 9.4b — sparse load of cell-level client target benchmarks.
      db
        .select({
          quoteSkuId: quoteSkuTierTargets.quoteSkuId,
          tierId: quoteSkuTierTargets.tierId,
          clientTargetPricePerUnit: quoteSkuTierTargets.clientTargetPricePerUnit,
        })
        .from(quoteSkuTierTargets)
        .innerJoin(quoteSkus, eq(quoteSkus.id, quoteSkuTierTargets.quoteSkuId))
        .where(eq(quoteSkus.quoteId, quoteId)),
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
      retailBenchmark: numOrNull(s.retailBenchmark),
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

    // Slice 9.3 — shape DB rows into pure-math input. Sparse: empty
    // array if no overrides anywhere on this quote.
    const cellOverrideList = cellOvr.map((c) => ({
      quoteSkuId: c.quoteSkuId,
      tierId: c.tierId,
      sellPriceOverride: num(c.sellPriceOverride),
    }));
    // Slice 9.4b — sparse client target benchmarks; same shape pattern.
    const cellTargetList = cellTgt.map((c) => ({
      quoteSkuId: c.quoteSkuId,
      tierId: c.tierId,
      clientTargetPricePerUnit: num(c.clientTargetPricePerUnit),
    }));
    // Slice 9.4c — sparse quote-level (per-tier) client targets.
    // Built from the same `tiers` query result; column is on
    // `quote_tiers` directly. Empty array when no tier has a
    // quote-level target. Snapshot carries this through to the
    // store so optimistic edits + reconcile see the same shape.
    const quoteTierTargetList = tiers
      .filter((t) => t.clientTargetPriceTotal !== null)
      .map((t) => ({
        tierId: t.id,
        clientTargetPriceTotal: num(t.clientTargetPriceTotal),
      }));

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
      cellOverrides: cellOverrideList,
      cellTargets: cellTargetList,
      quoteTierTargets: quoteTierTargetList,
    };

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
      freight: freightList,
      cellOverrides: cellOverrideList,
      cellTargets: cellTargetList,
      quoteTierTargets: quoteTierTargetList,
      costing: result,
      persistedWarnings,
    };

    return snapshot;
  });
}

"use server";

// Pricing reframe v1 — suggestion apply paths.
//
// Two server actions, one per suggestion kind (Slice 9.4b
// single-concern helper naming):
//
//   - applySurgicalAdj  → writes one quote_tiers.tier_price_adj_pct
//                          row, single audit row, diff_json.source =
//                          'pricing_suggestion_surgical'. Emits
//                          surgical_apply + recommended_{accepted,
//                          overridden} telemetry.
//   - applyGlobalAdj    → writes N quote_tiers.tier_price_adj_pct
//                          rows under the cascade audit pattern (root
//                          row + N derived rows with caused_by_audit_id
//                          → root.id). Each derived row carries
//                          diff_json.source = 'pricing_suggestion_global'.
//                          Emits recommended_{accepted, overridden}
//                          telemetry.
//
// Math (replacing tier_price_adj_pct, which OVERRIDES global, doesn't
// stack):
//
//   current_adj = tier.tier_price_adj_pct ?? quote.global_price_adj_pct
//   new_adj     = (1 + current_adj) * (1 + applyDelta) - 1
//
// where `applyDelta` is the suggestion's multiplicative revenue lift
// (sourced from pricing-suggestions.ts buildSurgical/buildGlobal).
//
// Trust posture: client-provided applyDelta is validated numerically
// and bounded but NOT re-derived from server-side rollup (Slice 9.2
// trust pattern per brief §4.4 "via existing Slice 9.2 mutation
// path"). Forgery defense can layer in later via re-derive (Slice
// 9.4b pattern) if analytics integrity needs surface.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, pricingEvents, quoteTiers, quotes } from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { getCostingBundle } from "@/app/actions/costing";
import {
  buildGlobalPricingPreview,
  type GlobalPricingPreview,
} from "@/lib/pricing-lift";
import { composePricingAdjustment } from "@/lib/pricing-adjustment";

// Bound applyDelta to a sane range. Suggestion math caps at numeric(5,4)
// effective_adj domain anyway; this is belt-and-suspenders.
function validateApplyDelta(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ActionGuardError(ERR.VALIDATION, "applyDelta must be a number");
  }
  if (Math.abs(n) > 5) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "applyDelta out of bounds (|delta| <= 5 = ±500%)",
    );
  }
  return n;
}

function computeNewAdj(
  currentEffectiveAdj: number,
  applyDelta: number,
): string {
  // (1 + current) * (1 + delta) - 1, kept as string for numeric column.
  const next = composePricingAdjustment(currentEffectiveAdj, applyDelta);
  return next.toString();
}

export async function previewGlobalAdj(
  formData: FormData,
): Promise<ActionResult<GlobalPricingPreview>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const applyDeltaRaw = String(formData.get("applyDelta") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!applyDeltaRaw)
      throw new ActionGuardError(ERR.VALIDATION, "applyDelta required");
    const applyDelta = validateApplyDelta(applyDeltaRaw);
    await ensureUser();
    await quoteByIdDraft(quoteId);
    const bundle = await getCostingBundle(quoteId);
    if (!bundle.ok) {
      throw new ActionGuardError(bundle.error.code, bundle.error.message);
    }
    const preview = buildGlobalPricingPreview(bundle.data, applyDelta);
    for (const tier of preview.tiers) {
      assertNewAdjFitsBound(String(tier.resultingAdjustment), tier.label);
    }
    return preview;
  });
}

// Bug #2 fix (α): pre-check composed new_adj fits the numeric(5,4)
// field bound (±9.9999 = ±999.99%) BEFORE write. Raw Postgres overflow
// surfaces as the generic action-result.ts pgValidationError message
// ("Value out of allowed range. Percent fields must be between -999%
// and 999%") — accurate but uninformative. This pre-check produces a
// diagnostic message naming the tier + the computed adj + the reason.
//
// Math note: this is NOT a math defect. The compose formula is
// correct — new_adj IS the absolute adj that lands the tier at
// target. The bound is a SCHEMA limit. When cost is high relative
// to base revenue (e.g., tier in a deep margin hole with a prior
// large override applied), the absolute new_adj exceeds the field
// bound. No adj alone can reach target; cost-stack adjustment
// needed first.
const FIELD_BOUND = 9.99; // numeric(5,4) cap ±9.9999, small buffer
function assertNewAdjFitsBound(
  newAdj: string,
  tierLabel: string,
): void {
  const n = Number(newAdj);
  if (!Number.isFinite(n)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Computed adjustment for ${tierLabel} is not a finite number.`,
    );
  }
  if (Math.abs(n) > FIELD_BOUND) {
    const pct = (n * 100).toFixed(0);
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Cannot apply suggestion — required ${tierLabel} adjustment is ${pct}%, ` +
        `exceeds ±999% field range. The cost stack on ${tierLabel} is too high ` +
        `relative to base revenue. Reduce cost inputs or change the target ` +
        `margin before applying suggestion.`,
    );
  }
}

// ---------- applySurgicalAdj ----------

export async function applySurgicalAdj(
  formData: FormData,
): Promise<ActionResult<{ tierId: string; tierPriceAdjPct: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    const applyDeltaRaw = String(formData.get("applyDelta") ?? "").trim();
    const optionRecommended =
      String(formData.get("optionRecommended") ?? "").trim() === "true";

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!tierId)
      throw new ActionGuardError(ERR.VALIDATION, "tierId required");
    if (!applyDeltaRaw)
      throw new ActionGuardError(ERR.VALIDATION, "applyDelta required");

    const applyDelta = validateApplyDelta(applyDeltaRaw);
    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    const tierRows = await db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.id, tierId))
      .limit(1);
    if (tierRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found");
    const tier = tierRows[0];
    if (tier.quoteId !== quoteId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Tier does not belong to quote",
      );
    }

    const currentEffectiveAdj =
      tier.tierPriceAdjPct !== null
        ? Number(tier.tierPriceAdjPct)
        : Number(quote.globalPriceAdjPct ?? 0);
    const newAdj = computeNewAdj(currentEffectiveAdj, applyDelta);

    // Bug #2 fix (α): contextual error if composed new_adj exceeds
    // numeric(5,4) field bound. Replaces Postgres overflow with
    // diagnostic message naming the tier + reason.
    assertNewAdjFitsBound(newAdj, tier.label);

    // 1. Update the tier row.
    await db
      .update(quoteTiers)
      .set({ tierPriceAdjPct: newAdj, updatedAt: new Date() })
      .where(eq(quoteTiers.id, tierId));

    // 2. Audit log — same action as manual updateTierPriceAdj; namespaced
    //    source per Disposition B.
    await writeAuditEntry({
      userId: user.id,
      entityType: "quote_tier",
      entityId: tierId,
      action: "tier_price_adj_updated",
      diffJson: {
        tier_price_adj_pct: {
          from: tier.tierPriceAdjPct,
          to: newAdj,
        },
        source: "pricing_suggestion_surgical",
      },
    });

    // 3. Telemetry — surgical_apply always; recommended_accepted vs
    //    recommended_overridden based on which option PM picked.
    await db.insert(pricingEvents).values([
      {
        quoteId,
        userId: user.id,
        eventType: "surgical_apply",
        violationTierId: tierId,
        suggestionTargetTierIds: [tierId],
      },
      {
        quoteId,
        userId: user.id,
        eventType: optionRecommended
          ? "recommended_accepted"
          : "recommended_overridden",
        violationTierId: tierId,
        suggestionTargetTierIds: [tierId],
      },
    ]);

    revalidateQuoteTree(quote.projectId, quote.id);
    return { tierId, tierPriceAdjPct: newAdj };
  });
}

// ---------- applyGlobalAdj ----------

export async function applyGlobalAdj(
  formData: FormData,
): Promise<ActionResult<{ quoteId: string; tierCount: number; auditId: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const applyToRaw = String(formData.get("applyTo") ?? "").trim();
    const applyDeltaRaw = String(formData.get("applyDelta") ?? "").trim();
    const optionRecommended =
      String(formData.get("optionRecommended") ?? "").trim() === "true";
    const expectedPreviewRaw =
      String(formData.get("expectedPreview") ?? "").trim();

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!applyToRaw)
      throw new ActionGuardError(ERR.VALIDATION, "applyTo required");
    if (!applyDeltaRaw)
      throw new ActionGuardError(ERR.VALIDATION, "applyDelta required");

    const applyTo = applyToRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (applyTo.length === 0) {
      throw new ActionGuardError(ERR.VALIDATION, "applyTo must list ≥1 tier");
    }
    const applyDelta = validateApplyDelta(applyDeltaRaw);

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    // Load all targeted tiers.
    const tierRows = await db
      .select()
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quoteId));
    const tierMap = new Map(tierRows.map((t) => [t.id, t]));
    for (const tid of applyTo) {
      if (!tierMap.has(tid)) {
        throw new ActionGuardError(
          ERR.NOT_FOUND,
          `Tier ${tid} not found on quote`,
        );
      }
    }

    const globalAdj = Number(quote.globalPriceAdjPct ?? 0);
    if (expectedPreviewRaw) {
      let expected: Array<{
        tierId: string;
        priorPersistedAdjustment: string | null;
        resultingAdjustment: number;
      }>;
      try {
        expected = JSON.parse(expectedPreviewRaw) as typeof expected;
      } catch {
        throw new ActionGuardError(ERR.VALIDATION, "Pricing preview is malformed");
      }
      for (const item of expected) {
        const tier = tierMap.get(item.tierId);
        if (
          !tier ||
          String(tier.tierPriceAdjPct) !== String(item.priorPersistedAdjustment)
        ) {
          throw new ActionGuardError(
            ERR.VALIDATION,
            "Pricing changed after Preview; preview the changes again",
          );
        }
      }
    }

    // Bug #2 fix (α): pre-check ALL tier new_adj values BEFORE any
    // writes (including root audit). Atomic-fail semantic — if any
    // tier's composed new_adj exceeds field bound, the entire global
    // apply rejects with the first offending tier's diagnostic.
    // Avoids partial-write state where the root audit + some tiers
    // landed successfully and one tier failed.
    const newAdjPlanned: Array<{
      tierId: string;
      tier: typeof tierRows[number];
      newAdj: string;
    }> = [];
    for (const tid of applyTo) {
      const tier = tierMap.get(tid)!;
      const currentEffectiveAdj =
        tier.tierPriceAdjPct !== null
          ? Number(tier.tierPriceAdjPct)
          : globalAdj;
      const newAdj = computeNewAdj(currentEffectiveAdj, applyDelta);
      assertNewAdjFitsBound(newAdj, tier.label);
      newAdjPlanned.push({ tierId: tid, tier, newAdj });
    }

    // 1. Cascade audit root row — entity = quote; new action value
    //    (pricing_suggestion_global_applied) namespaces the user-action
    //    summary distinct from per-tier writes that follow.
    const rootAudit = await writeAuditEntryReturningId({
        userId: user.id,
        entityType: "quote",
        entityId: quoteId,
        action: "pricing_suggestion_global_applied",
        diffJson: {
          source: "pricing_suggestion_global",
          apply_to_tier_ids: applyTo,
          apply_delta: applyDelta,
          tier_count: applyTo.length,
        },
      });

    // 2. Per-tier writes + derived audit rows.
    for (const { tierId: tid, tier, newAdj } of newAdjPlanned) {

      await db
        .update(quoteTiers)
        .set({ tierPriceAdjPct: newAdj, updatedAt: new Date() })
        .where(eq(quoteTiers.id, tid));

      await writeAuditEntry({
        userId: user.id,
        entityType: "quote_tier",
        entityId: tid,
        action: "tier_price_adj_updated",
        diffJson: {
          tier_price_adj_pct: {
            from: tier.tierPriceAdjPct,
            to: newAdj,
          },
          source: "pricing_suggestion_global",
        },
        causedByAuditId: rootAudit,
      });
    }

    // 3. Telemetry — recommended_accepted vs overridden. No global_apply
    //    event_type exists in the pricing_events enum (5 named values:
    //    surgical_apply, request_override, recommended_{fired,accepted,
    //    overridden}); global-apply forensics live on audit_log via the
    //    root row's action = 'pricing_suggestion_global_applied'.
    await db.insert(pricingEvents).values({
      quoteId,
      userId: user.id,
      eventType: optionRecommended
        ? "recommended_accepted"
        : "recommended_overridden",
      suggestionTargetTierIds: applyTo,
    });

    revalidateQuoteTree(quote.projectId, quote.id);
    return { quoteId, tierCount: applyTo.length, auditId: rootAudit };
  });
}

export async function undoGlobalAdj(
  formData: FormData,
): Promise<ActionResult<{ quoteId: string; tierCount: number }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const auditId = String(formData.get("auditId") ?? "").trim();
    if (!quoteId || !auditId) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId and auditId required");
    }
    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);
    const roots = await db.select().from(auditLog).where(and(
      eq(auditLog.id, auditId),
      eq(auditLog.entityType, "quote"),
      eq(auditLog.entityId, quoteId),
      eq(auditLog.action, "pricing_suggestion_global_applied"),
    )).limit(1);
    if (!roots[0]) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Bulk pricing apply not found");
    }
    const children = await db.select().from(auditLog).where(and(
      eq(auditLog.causedByAuditId, auditId),
      eq(auditLog.entityType, "quote_tier"),
      eq(auditLog.action, "tier_price_adj_updated"),
    ));
    if (children.length === 0) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Bulk pricing apply has no tier changes");
    }
    const tierRows = await db.select().from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));
    const tierMap = new Map(tierRows.map((tier) => [tier.id, tier]));
    const restores = children.map((child) => {
      const diff = child.diffJson as {
        tier_price_adj_pct?: { from?: string | null; to?: string | null };
      };
      const change = diff.tier_price_adj_pct;
      const tier = tierMap.get(child.entityId);
      if (!tier || !change || change.to == null) {
        throw new ActionGuardError(ERR.VALIDATION, "Bulk pricing receipt is incomplete");
      }
      if (
        tier.tierPriceAdjPct == null ||
        Number(tier.tierPriceAdjPct) !== Number(change.to)
      ) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `Tier ${tier.label} changed after Apply; Undo was not performed`,
        );
      }
      return { tier, from: change.from ?? null, to: change.to };
    });
    const undoAudit = await writeAuditEntryReturningId({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "pricing_suggestion_global_undone",
      diffJson: {
        source: "pricing_suggestion_global_undo",
        applied_audit_id: auditId,
        tier_count: restores.length,
      },
    });
    for (const restore of restores) {
      await db.update(quoteTiers).set({
        tierPriceAdjPct: restore.from,
        updatedAt: new Date(),
      }).where(eq(quoteTiers.id, restore.tier.id));
      await writeAuditEntry({
        userId: user.id,
        entityType: "quote_tier",
        entityId: restore.tier.id,
        action: "tier_price_adj_updated",
        diffJson: {
          tier_price_adj_pct: { from: restore.to, to: restore.from },
          source: "pricing_suggestion_global_undo",
        },
        causedByAuditId: undoAudit,
      });
    }
    revalidateQuoteTree(quote.projectId, quote.id);
    return { quoteId, tierCount: restores.length };
  });
}

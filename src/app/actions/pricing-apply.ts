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

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, pricingEvents, quoteTiers, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";

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
  const next = (1 + currentEffectiveAdj) * (1 + applyDelta) - 1;
  return next.toString();
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
    await db.insert(auditLog).values({
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
): Promise<ActionResult<{ quoteId: string; tierCount: number }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const applyToRaw = String(formData.get("applyTo") ?? "").trim();
    const applyDeltaRaw = String(formData.get("applyDelta") ?? "").trim();
    const optionRecommended =
      String(formData.get("optionRecommended") ?? "").trim() === "true";

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
    const [rootAudit] = await db
      .insert(auditLog)
      .values({
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
      })
      .returning({ id: auditLog.id });

    // 2. Per-tier writes + derived audit rows.
    const newAdjByTier: Array<{ tierId: string; from: string | null; to: string }> = [];
    for (const { tierId: tid, tier, newAdj } of newAdjPlanned) {

      await db
        .update(quoteTiers)
        .set({ tierPriceAdjPct: newAdj, updatedAt: new Date() })
        .where(eq(quoteTiers.id, tid));

      await db.insert(auditLog).values({
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
        causedByAuditId: rootAudit.id,
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
    return { quoteId, tierCount: applyTo.length };
  });
}

"use server";

// Phase 3 · Package 1 — Apply, as one act.
//
// ── WHY THIS IS ONE ACTION AND NOT THREE ──────────────────────────────────
//
// The staging model commits a SET: lifts, direct prices and the quote-wide
// adjustment, together, on one Apply. Each lever already has a per-cell action
// of its own, and composing Apply out of those calls would make a partial
// commit reachable — three of five chips written, the fourth failing, and an
// APPLIED bar describing a state the quote is not in. One transaction is what
// makes "Apply 4 changes" mean four changes or none.
//
// It introduces no new commercial authority. What a lift DOES is the engine's
// statement; what is compliant is the classifier's; which lift is offered is
// the solver's. This layer decides only what is written down.
//
// ── THE SET IS COMPLETE, NOT A DELTA ──────────────────────────────────────
//
// Callers send the intended end state, and the server diffs it against what is
// persisted. An absent cell is a REMOVAL, which is the only way "remove the
// lift on GLW-50 · T2" can survive a reload: a delta-shaped API has no way to
// express the absence of something, and that is exactly the change an operator
// most needs to be able to make and see.
//
// ── IDENTITY ──────────────────────────────────────────────────────────────
//
// Lifts are addressed canonically end to end — staging key, `CostingLift`, and
// `quote_leaf_lifts` all key on `quote_leaves.id`. Nothing crosses.
//
// Direct prices are not so lucky. `assembly_leaf_overrides` keys on the legacy
// junction (OD-017), so writing one requires resolving canonical → legacy. That
// crossing happens ONCE, here, in a single query, and fails closed: an
// attachment with no junction row cannot have a direct price written against it
// and the whole Apply is refused with a reason, rather than silently dropping
// one chip out of five.

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblyLeafOverrides,
  assemblyLeaves,
  quoteLeafLifts,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft, quoteForQuoteLeaves } from "@/lib/quote-guards";
import {
  applyCellId,
  parseApplyCellId,
  planApply,
  type ApplyPlan,
} from "@/lib/pricing-apply-plan";
import { ensureUser } from "@/lib/auth/ensure-user";
import { writeAuditEntries, writeAuditEntryReturningId } from "@/lib/audit";
import { revalidateQuoteTree } from "@/lib/revalidate";

// ── the wire shape ────────────────────────────────────────────────────────

/** A lift, addressed the way the engine and the table both address one. */
export type AppliedLiftInput = {
  quoteLeafId: string;
  tierId: string;
  /** Multiplicative. `0.077` is +7.7%. */
  liftPct: number;
};

/** A direct price, addressed CANONICALLY. Crossed to the legacy id in here. */
export type AppliedOverrideInput = {
  quoteLeafId: string;
  tierId: string;
  sellPrice: number;
};

/** A per-tier adjustment. Authored elsewhere; carried here so it can be cleared. */
export type AppliedTierAdjInput = { tierId: string; adjPct: number };

export type ApplyPricingAdjustmentsInput = {
  quoteId: string;
  /** The COMPLETE intended lift set. Absent cells are removals. */
  lifts: AppliedLiftInput[];
  /** The COMPLETE intended set of canonically-addressable direct prices. */
  overrides: AppliedOverrideInput[];
  /**
   * The COMPLETE intended set of per-tier adjustments.
   *
   * These ARE staged. A recommendation CTA puts a composed per-tier
   * adjustment into the working set, and this is where the set arrives — by
   * the same path as lifts and overrides. That is the whole of the P3-016
   * repair: until it, nothing staged one, `applySurgicalAdj` wrote
   * `quote_tiers.tier_price_adj_pct` at click time, and an operator got a
   * committed pricing change with nothing on screen to preview or discard.
   *
   * Bulk lift is the one exception, and a governed one: `applyGlobalAdj`
   * still writes per-tier adjustments directly, under its own preview /
   * apply / undo contract.
   *
   * An untouched adjustment is passed back unchanged, so it plans no change.
   * One absent from the set is a REMOVAL — which is both how an operator
   * clears a single tier and how Return to baseline clears them all.
   */
  tierAdjustments: AppliedTierAdjInput[];
  globalAdjPct: number;
  /**
   * Which operator act this is.
   *
   * Not a `diff_json.source` flag: the audit-source convention reserves those
   * for marking a non-default ORIGIN when several surfaces write one column,
   * and explicitly not for naming variants of one act. Apply and Return to
   * baseline are two different things an operator did, so they are two audit
   * actions — the same reasoning that gives `leaf_archive` and `leaf_restored`
   * separate names rather than one action with a direction in its diff.
   */
  intent: "apply" | "baseline";
};

export type ApplyPricingAdjustmentsResult = {
  quoteId: string;
  lifts: AppliedLiftInput[];
  overrides: AppliedOverrideInput[];
  tierAdjustments: AppliedTierAdjInput[];
  globalAdjPct: number;
  /** How many rows the commit actually moved. Zero is a legitimate answer. */
  changeCount: number;
};

// ── value discipline ──────────────────────────────────────────────────────

/** `numeric(6,4)`. Postgres would round silently; rounding here is visible. */
function normalizeLiftPct(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ActionGuardError(ERR.VALIDATION, "A lift must be a number.");
  }
  const rounded = Math.round(value * 1e4) / 1e4;
  if (rounded <= 0) {
    // Includes the case of a positive value too small to store. Refusing is
    // better than storing 0.0000 and tripping a CHECK the operator cannot read,
    // and better still than an APPLIED bar counting an adjustment that moves no
    // price.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "A lift must raise the price. Remove it instead of setting it to zero.",
    );
  }
  if (rounded >= 100) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That lift is out of range for a price adjustment.",
    );
  }
  return rounded.toFixed(4);
}

/** `numeric(10,4)`, matching the column the direct price already lives in. */
function normalizeSellPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "A direct price must be greater than zero. Remove it instead of setting it to zero.",
    );
  }
  const rounded = Math.round(value * 1e4) / 1e4;
  if (rounded <= 0 || rounded >= 1e6) {
    throw new ActionGuardError(ERR.VALIDATION, "That price is out of range.");
  }
  return rounded.toFixed(4);
}

/** Same column semantics as the quote-wide adjustment, so the same range. */
function normalizeTierAdj(value: number): string {
  return normalizeGlobalAdj(value);
}

function normalizeGlobalAdj(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "The quote-wide adjustment must be a number.",
    );
  }
  const rounded = Math.round(value * 1e4) / 1e4;
  if (Math.abs(rounded) >= 10) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That quote-wide adjustment is out of range.",
    );
  }
  return rounded.toFixed(4);
}

// ── the action ────────────────────────────────────────────────────────────

export async function applyPricingAdjustments(
  input: ApplyPricingAdjustmentsInput,
): Promise<ActionResult<ApplyPricingAdjustmentsResult>> {
  return runAction(async () => {
    const user = await ensureUser();

    const named = Array.from(
      new Set([
        ...input.lifts.map((l) => l.quoteLeafId),
        ...input.overrides.map((o) => o.quoteLeafId),
      ]),
    );

    // The quote comes from CANONICAL IDENTITY whenever the set names one, so a
    // client-supplied quote id can never widen what is reachable: every cell
    // written is independently proved to belong to the quote being guarded.
    //
    // An empty set names nothing to resolve from — that is Return to baseline,
    // whose whole content is removals — so the quote id is the only address
    // available, and `quoteByIdDraft` guards it the same way.
    const quote =
      named.length > 0
        ? (await quoteForQuoteLeaves(named)).quote
        : await quoteByIdDraft(input.quoteId);

    if (quote.id !== input.quoteId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "These adjustments belong to a different quote.",
      );
    }

    // Tiers. The same-quote trigger on the table would catch a foreign tier,
    // but a raw trigger exception escapes as a database error rather than
    // something an operator can read. Checked here for the message; the trigger
    // stays as the thing that cannot be bypassed.
    const namedTiers = Array.from(
      new Set([
        ...input.lifts.map((l) => l.tierId),
        ...input.overrides.map((o) => o.tierId),
        ...input.tierAdjustments.map((t) => t.tierId),
      ]),
    );
    if (namedTiers.length > 0) {
      const tierRows = await db
        .select({ id: quoteTiers.id })
        .from(quoteTiers)
        .where(
          and(
            inArray(quoteTiers.id, namedTiers),
            eq(quoteTiers.quoteId, quote.id),
          ),
        );
      if (tierRows.length !== namedTiers.length) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "A tier these adjustments name does not belong to this quote.",
        );
      }
    }

    // A lift and a direct price on one cell are mutually exclusive, and the
    // engine already says so — it refuses the lift with the `overridden`
    // rejection, because a lift would silently overturn a price someone set on
    // purpose. Refused here too, so nothing is persisted that could never take
    // effect. Not a new rule: the engine's rule, enforced before the write
    // rather than discovered after it.
    const overrideCells = new Set(
      input.overrides.map((o) => applyCellId(o.quoteLeafId, o.tierId)),
    );
    const conflicted = input.lifts.find((l) =>
      overrideCells.has(applyCellId(l.quoteLeafId, l.tierId)),
    );
    if (conflicted) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A cell cannot carry both a lift and a direct price. Remove one before applying.",
      );
    }

    // Normalize BEFORE opening the transaction, so a bad value is rejected
    // without having taken a lock.
    const intendedLifts = new Map<string, { row: AppliedLiftInput; stored: string }>();
    for (const lift of input.lifts) {
      const key = applyCellId(lift.quoteLeafId, lift.tierId);
      if (intendedLifts.has(key)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "The same cell was lifted twice in one apply.",
        );
      }
      intendedLifts.set(key, { row: lift, stored: normalizeLiftPct(lift.liftPct) });
    }
    const intendedOverrides = new Map<
      string,
      { row: AppliedOverrideInput; stored: string }
    >();
    for (const o of input.overrides) {
      const key = applyCellId(o.quoteLeafId, o.tierId);
      if (intendedOverrides.has(key)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "The same cell was priced twice in one apply.",
        );
      }
      intendedOverrides.set(key, { row: o, stored: normalizeSellPrice(o.sellPrice) });
    }
    const intendedTierAdj = new Map<string, string>();
    for (const t of input.tierAdjustments) {
      if (intendedTierAdj.has(t.tierId)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "The same tier was adjusted twice in one apply.",
        );
      }
      intendedTierAdj.set(t.tierId, normalizeTierAdj(t.adjPct));
    }
    const storedGlobalAdj = normalizeGlobalAdj(input.globalAdjPct);

    // ── legacy compatibility lookup ───────────────────────────────────────
    //
    // OD-017 REMOVED the identity crossing this used to be. Overrides key
    // canonically now, so there is no canonical→legacy translation on the read
    // or write path, and the refusal that used to live here — "a direct price
    // cannot yet be set on this line" — is gone with it. A Direct Component can
    // hold a direct price because the table can now express one.
    //
    // What remains is a one-query lookup used ONLY to keep the legacy
    // compatibility column truthful while it still exists. It is not authority:
    // a missing junction yields NULL rather than a rejection.
    const legacyByCanonical = new Map<string, string>();
    const junctionRows = await db
      .select({
        legacyId: assemblyLeaves.id,
        canonicalId: assemblyLeaves.quoteLeafId,
      })
      .from(assemblyLeaves)
      .innerJoin(quoteLeaves, eq(quoteLeaves.id, assemblyLeaves.quoteLeafId))
      .where(
        and(
          eq(quoteLeaves.quoteId, quote.id),
          isNotNull(assemblyLeaves.quoteLeafId),
        ),
      );
    for (const r of junctionRows) {
      if (!r.canonicalId) continue;
      if (legacyByCanonical.has(r.canonicalId)) {
        // Two junctions for one canonical attachment. R2 proves this does not
        // happen today; if it ever does, choosing one is choosing a commercial
        // line at random.
        throw new ActionGuardError(
          ERR.DATA_INTEGRITY,
          "A commercial attachment resolves to more than one line, so no price was written.",
        );
      }
      legacyByCanonical.set(r.canonicalId, r.legacyId);
    }

    // ── read what is in effect, diff, write ───────────────────────────────

    const persistedLiftRows = await db
      .select({
        quoteLeafId: quoteLeafLifts.quoteLeafId,
        tierId: quoteLeafLifts.tierId,
        liftPct: quoteLeafLifts.liftPct,
      })
      .from(quoteLeafLifts)
      .innerJoin(quoteTiers, eq(quoteTiers.id, quoteLeafLifts.tierId))
      .where(eq(quoteTiers.quoteId, quote.id));

    const persistedOverrideRows = await db
      .select({
        canonicalId: assemblyLeafOverrides.quoteLeafId,
        tierId: assemblyLeafOverrides.tierId,
        sellPriceOverride: assemblyLeafOverrides.sellPriceOverride,
      })
      .from(assemblyLeafOverrides)
      .innerJoin(quoteTiers, eq(quoteTiers.id, assemblyLeafOverrides.tierId))
      .where(eq(quoteTiers.quoteId, quote.id));

    const persistedTierAdjRows = await db
      .select({ id: quoteTiers.id, adj: quoteTiers.tierPriceAdjPct })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id));
    const persistedTierAdj = new Map<string, string>();
    for (const t of persistedTierAdjRows) {
      if (t.adj !== null) persistedTierAdj.set(t.id, t.adj);
    }

    const persistedLifts = new Map(
      persistedLiftRows.map((r) => [applyCellId(r.quoteLeafId, r.tierId), r.liftPct]),
    );
    // Every persisted override is canonically addressable now, so the previous
    // "unrepresentable, therefore skip" branch is gone. It existed to avoid
    // deleting a price the operator could not see; with one identity domain
    // there is no such price.
    const persistedOverrides = new Map<string, { stored: string }>();
    for (const r of persistedOverrideRows) {
      persistedOverrides.set(applyCellId(r.canonicalId, r.tierId), {
        stored: r.sellPriceOverride,
      });
    }

    // The decision itself is pure and lives in `pricing-apply-plan`, so it can
    // be exercised without a database. Everything above this line loads state;
    // everything below writes it.
    const globalAdjFrom = String(quote.globalPriceAdjPct);
    const plan: ApplyPlan = planApply({
      intendedLifts: new Map(
        Array.from(intendedLifts, ([k, v]) => [k, v.stored] as const),
      ),
      intendedOverrides: new Map(
        Array.from(intendedOverrides, ([k, v]) => [k, v.stored] as const),
      ),
      persistedLifts,
      persistedOverrides: new Map(
        Array.from(persistedOverrides, ([k, v]) => [k, v.stored] as const),
      ),
      intendedTierAdj,
      persistedTierAdj,
      globalAdjFrom,
      globalAdjTo: storedGlobalAdj,
    });
    const {
      liftsSet,
      liftsRemoved,
      overridesSet,
      overridesRemoved,
      tierAdjSet,
      tierAdjRemoved,
      changeCount,
    } = plan;
    const globalAdjMoved = plan.globalAdj !== null;

    /**
     * THE RESULTING TIER STATE, not the requested one.
     *
     * This action returned `input.tierAdjustments` — an echo of what the client
     * SENT — and the client set its committed state from it. That was survivable
     * while every write was something the client had asked for. It stopped being
     * survivable when a global Apply began clearing tier overrides the client
     * never mentioned: the client kept believing four zero rows existed, resent
     * them next Apply against a now-empty quote, the server wrote them back as
     * `null -> 0.0000`, and the sweep cleared them again. A strict alternation,
     * every second Apply silently suppressing the global with explicit zeros.
     *
     * The value the operator entered was never involved, which is why 11% and
     * 101% "failed" while 12% and 50% "worked" — they landed on opposite phases.
     *
     * So the server states what IS, and the client adopts it.
     */
    const resultingTierAdj = new Map(persistedTierAdj);
    for (const r of tierAdjRemoved) resultingTierAdj.delete(r.key);
    for (const c of tierAdjSet) resultingTierAdj.set(c.key, c.to);
    const resultingTierAdjustments: AppliedTierAdjInput[] = [...resultingTierAdj].map(
      ([tierId, adjPct]) => ({ tierId, adjPct: Number(adjPct) }),
    );

    if (changeCount === 0) {
      // Nothing to write and nothing to record. An audit row saying an operator
      // committed no change is noise in the one log that has to stay readable.
      return {
        quoteId: quote.id,
        lifts: input.lifts,
        overrides: input.overrides,
        tierAdjustments: resultingTierAdjustments,
        globalAdjPct: Number(storedGlobalAdj),
        changeCount: 0,
      };
    }

    await db.transaction(async (tx) => {
      for (const { key } of liftsRemoved) {
        const { quoteLeafId, tierId } = parseApplyCellId(key);
        await tx
          .delete(quoteLeafLifts)
          .where(
            and(
              eq(quoteLeafLifts.quoteLeafId, quoteLeafId),
              eq(quoteLeafLifts.tierId, tierId),
            ),
          );
      }
      for (const { key, to } of liftsSet) {
        const { quoteLeafId, tierId } = parseApplyCellId(key);
        await tx
          .insert(quoteLeafLifts)
          .values({ quoteLeafId, tierId, liftPct: to })
          .onConflictDoUpdate({
            target: [quoteLeafLifts.quoteLeafId, quoteLeafLifts.tierId],
            set: { liftPct: to, updatedAt: new Date() },
          });
      }

      for (const { key } of overridesRemoved) {
        const { quoteLeafId: canonicalId, tierId } = parseApplyCellId(key);
        await tx
          .delete(assemblyLeafOverrides)
          .where(
            and(
              eq(assemblyLeafOverrides.quoteLeafId, canonicalId),
              eq(assemblyLeafOverrides.tierId, tierId),
            ),
          );
      }
      for (const { key, to } of overridesSet) {
        const { quoteLeafId: canonicalId, tierId } = parseApplyCellId(key);
        await tx
          .insert(assemblyLeafOverrides)
          .values({
            quoteLeafId: canonicalId,
            // Legacy compatibility only; NULL for a Direct Component.
            assemblyLeafId: legacyByCanonical.get(canonicalId) ?? null,
            tierId,
            sellPriceOverride: to,
          })
          .onConflictDoUpdate({
            target: [
              assemblyLeafOverrides.quoteLeafId,
              assemblyLeafOverrides.tierId,
            ],
            set: { sellPriceOverride: to, updatedAt: new Date() },
          });
      }

      for (const { key } of tierAdjRemoved) {
        await tx
          .update(quoteTiers)
          .set({ tierPriceAdjPct: null, updatedAt: new Date() })
          .where(eq(quoteTiers.id, key));
      }
      for (const { key, to } of tierAdjSet) {
        await tx
          .update(quoteTiers)
          .set({ tierPriceAdjPct: to, updatedAt: new Date() })
          .where(eq(quoteTiers.id, key));
      }

      if (globalAdjMoved) {
        await tx
          .update(quotes)
          .set({ globalPriceAdjPct: storedGlobalAdj, updatedAt: new Date() })
          .where(eq(quotes.id, quote.id));
      }

      // ── audit ───────────────────────────────────────────────────────────
      //
      // Root row plus one derived row per change, the cascade shape the rest of
      // the log uses. The root is what an operator did; the derived rows are
      // what it moved, and each carries `causedByAuditId` so the two are one
      // event rather than a burst of unrelated writes at the same timestamp.
      //
      // Written INSIDE the transaction. An audit that can commit without its
      // mutation, or the reverse, is not evidence.
      const rootId = await writeAuditEntryReturningId(
        {
          userId: user.id,
          entityType: "quote",
          entityId: quote.id,
          action:
            input.intent === "baseline"
              ? "pricing_adjustments_cleared"
              : "pricing_adjustments_applied",
          summary:
            input.intent === "baseline"
              ? "Returned pricing to the computed baseline"
              : `Applied ${changeCount} pricing adjustment${changeCount === 1 ? "" : "s"}`,
          diffJson: {
            change_count: changeCount,
            lifts_set: liftsSet,
            lifts_removed: liftsRemoved,
            overrides_set: overridesSet,
            overrides_removed: overridesRemoved,
            tier_adjustments_set: tierAdjSet,
            tier_adjustments_removed: tierAdjRemoved,
            ...(globalAdjMoved
              ? {
                  global_price_adj_pct: {
                    from: Number(globalAdjFrom),
                    to: Number(storedGlobalAdj),
                  },
                }
              : {}),
          },
        },
        tx,
      );

      const derived = [
        ...liftsSet.map((c) => ({
          userId: user.id,
          entityType: "quote_leaf_lift",
          entityId: c.key,
          action: "pricing_lift_applied",
          diffJson: {
            lift_pct: { from: c.from === null ? null : Number(c.from), to: Number(c.to) },
          },
          causedByAuditId: rootId,
        })),
        ...liftsRemoved.map((c) => ({
          userId: user.id,
          entityType: "quote_leaf_lift",
          entityId: c.key,
          action: "pricing_lift_removed",
          diffJson: { lift_pct: { from: Number(c.from), to: null } },
          causedByAuditId: rootId,
        })),
        // Direct prices keep the action name their per-cell path already writes,
        // so one column's history reads as one timeline. The Slice 9.2 source
        // convention is exactly this case: same column, same semantic effect,
        // different origin — so the origin goes in `diff_json.source`.
        ...overridesSet.map((c) => ({
          userId: user.id,
          entityType: "assembly_leaf_override",
          entityId: c.key,
          action: "assembly_leaf_sell_override_updated",
          diffJson: {
            sell_price_override: {
              from: c.from === null ? null : Number(c.from),
              to: Number(c.to),
            },
            source: "pricing_apply",
          },
          causedByAuditId: rootId,
        })),
        ...overridesRemoved.map((c) => ({
          userId: user.id,
          entityType: "assembly_leaf_override",
          entityId: c.key,
          action: "assembly_leaf_sell_override_updated",
          diffJson: {
            sell_price_override: { from: Number(c.from), to: null },
            source: "pricing_apply",
          },
          causedByAuditId: rootId,
        })),
        // Per-tier adjustments keep the action name their own write path uses,
        // so one column's history reads as one timeline; the origin goes in
        // `diff_json.source` per the Slice 9.2 convention.
        ...tierAdjSet.map((c) => ({
          userId: user.id,
          entityType: "quote_tier",
          entityId: c.key,
          action: "tier_price_adj_updated",
          diffJson: {
            tier_price_adj_pct: {
              from: c.from === null ? null : Number(c.from),
              to: Number(c.to),
            },
            source: "pricing_apply",
          },
          causedByAuditId: rootId,
        })),
        ...tierAdjRemoved.map((c) => ({
          userId: user.id,
          entityType: "quote_tier",
          entityId: c.key,
          action: "tier_price_adj_updated",
          diffJson: {
            tier_price_adj_pct: { from: Number(c.from), to: null },
            source: "pricing_apply",
          },
          causedByAuditId: rootId,
        })),
        ...(globalAdjMoved
          ? [
              {
                userId: user.id,
                entityType: "quote",
                entityId: quote.id,
                action: "global_price_adj_updated",
                diffJson: {
                  global_price_adj_pct: {
                    from: Number(globalAdjFrom),
                    to: Number(storedGlobalAdj),
                  },
                  source: "pricing_apply",
                },
                causedByAuditId: rootId,
              },
            ]
          : []),
      ];
      if (derived.length > 0) await writeAuditEntries(derived, tx);
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteId: quote.id,
      lifts: input.lifts,
      overrides: input.overrides,
      tierAdjustments: resultingTierAdjustments,
      globalAdjPct: Number(storedGlobalAdj),
      changeCount,
    };
  });
}

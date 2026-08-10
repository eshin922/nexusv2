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

export type ApplyPricingAdjustmentsInput = {
  quoteId: string;
  /** The COMPLETE intended lift set. Absent cells are removals. */
  lifts: AppliedLiftInput[];
  /** The COMPLETE intended set of canonically-addressable direct prices. */
  overrides: AppliedOverrideInput[];
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
    const storedGlobalAdj = normalizeGlobalAdj(input.globalAdjPct);

    // ── the one identity crossing ─────────────────────────────────────────
    //
    // Canonical → legacy junction, for the direct prices only. One query, and
    // it fails closed: an attachment carrying no junction row (OD-017's direct
    // attachment) cannot hold a direct price today, and saying so is better
    // than writing four chips out of five and reporting success.
    const legacyByCanonical = new Map<string, string>();
    const canonicalByLegacy = new Map<string, string>();
    //
    // Scoped through `quote_leaves`, which is the FK that says which quote a
    // junction belongs to. Reaching the quote any other way is what OD-017 is
    // about.
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
      canonicalByLegacy.set(r.legacyId, r.canonicalId);
    }
    for (const o of intendedOverrides.values()) {
      if (!legacyByCanonical.has(o.row.quoteLeafId)) {
        throw new ActionGuardError(
          ERR.DATA_INTEGRITY,
          "A direct price cannot yet be set on this line, so nothing was written.",
        );
      }
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
        legacyId: assemblyLeafOverrides.assemblyLeafId,
        tierId: assemblyLeafOverrides.tierId,
        sellPriceOverride: assemblyLeafOverrides.sellPriceOverride,
      })
      .from(assemblyLeafOverrides)
      .innerJoin(quoteTiers, eq(quoteTiers.id, assemblyLeafOverrides.tierId))
      .where(eq(quoteTiers.quoteId, quote.id));

    const persistedLifts = new Map(
      persistedLiftRows.map((r) => [applyCellId(r.quoteLeafId, r.tierId), r.liftPct]),
    );
    // Only the canonically-addressable ones. A persisted override on a junction
    // with no canonical row is real and in effect but cannot appear in a set
    // addressed canonically, so its absence from that set is not a removal —
    // it is unrepresentable. Treating it as a removal would delete a price the
    // operator never saw, let alone chose to remove.
    const persistedOverrides = new Map<string, { stored: string; legacyId: string }>();
    for (const r of persistedOverrideRows) {
      const canonical = canonicalByLegacy.get(r.legacyId);
      if (!canonical) continue;
      persistedOverrides.set(applyCellId(canonical, r.tierId), {
        stored: r.sellPriceOverride,
        legacyId: r.legacyId,
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
      globalAdjFrom,
      globalAdjTo: storedGlobalAdj,
    });
    const {
      liftsSet,
      liftsRemoved,
      overridesSet,
      overridesRemoved,
      changeCount,
    } = plan;
    const globalAdjMoved = plan.globalAdj !== null;

    if (changeCount === 0) {
      // Nothing to write and nothing to record. An audit row saying an operator
      // committed no change is noise in the one log that has to stay readable.
      return {
        quoteId: quote.id,
        lifts: input.lifts,
        overrides: input.overrides,
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
        const legacyId = persistedOverrides.get(key)!.legacyId;
        const { tierId } = parseApplyCellId(key);
        await tx
          .delete(assemblyLeafOverrides)
          .where(
            and(
              eq(assemblyLeafOverrides.assemblyLeafId, legacyId),
              eq(assemblyLeafOverrides.tierId, tierId),
            ),
          );
      }
      for (const { key, to } of overridesSet) {
        const { quoteLeafId: canonicalId, tierId } = parseApplyCellId(key);
        const legacyId = legacyByCanonical.get(canonicalId)!;
        await tx
          .insert(assemblyLeafOverrides)
          .values({
            assemblyLeafId: legacyId,
            tierId,
            sellPriceOverride: to,
          })
          .onConflictDoUpdate({
            target: [
              assemblyLeafOverrides.assemblyLeafId,
              assemblyLeafOverrides.tierId,
            ],
            set: { sellPriceOverride: to, updatedAt: new Date() },
          });
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
      globalAdjPct: Number(storedGlobalAdj),
      changeCount,
    };
  });
}

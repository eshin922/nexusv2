"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { quoteChargeRecovery } from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  assertNotFrozen,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { writeAuditEntry } from "@/lib/audit";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  assertElectionAllowed,
  loadElectionContext,
} from "@/lib/commercial-recovery/election-context";
import {
  chargePolicy,
  type RecoveryChargeKey,
  type RecoveryMode,
} from "@/lib/commercial-recovery/registry";

export type PersistedElection = { chargeKey: RecoveryChargeKey; mode: RecoveryMode };

export type PersistChargeRecoverySetResult = {
  quoteId: string;
  /** The set now in the database, read back after the write. */
  persisted: PersistedElection[];
  /** True when `persisted` is exactly the set that was asked for. */
  matchesRequested: boolean;
};

/**
 * Make the stored election set equal an exact proposed set, and confirm it.
 *
 * ── WHY A SET, AND WHY A READ-BACK ──────────────────────────────────────
 *
 * Evaluate-first means the operator acts on a projection that is not yet
 * durable. Everything downstream of an election — approval, Finalize, the
 * frozen artifact — must run against what is STORED, not against what is on
 * screen. So before either gate proceeds it flushes: persist this exact set,
 * read it back, and prove the two agree.
 *
 * "Wait for the debounce to settle" would not do. It waits on a timer rather
 * than on a fact, and a save that failed while the timer ran still elapses.
 * The gate needs to know the set is stored, which only a read-back can tell it.
 *
 * Per charge rather than in bulk on purpose: each election is an operator
 * decision and keeps its own audit row, so the timeline records what was
 * elected rather than that a set was synchronised.
 *
 * Unchanged charges are skipped — no write, no audit. A flush of an already
 * durable set is then free, which matters because both gates call it every
 * time regardless of whether anything is pending.
 */
export async function persistChargeRecoverySet(input: {
  quoteId: string;
  elections: { chargeKey: string; mode: string }[];
}): Promise<ActionResult<PersistChargeRecoverySetResult>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = input.quoteId.trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const quote = await quoteByIdDraft(quoteId);
    // Redundant by construction — draft is a subset of not-frozen — and kept so
    // the Pattern 52 protocol's grep finds this writer.
    assertNotFrozen(quote);

    const requested: PersistedElection[] = input.elections.map((e) => {
      const key = e.chargeKey as RecoveryChargeKey;
      chargePolicy(key); // throws on an unknown key
      return { chargeKey: key, mode: e.mode as RecoveryMode };
    });

    const prior = await db
      .select({
        chargeKey: quoteChargeRecovery.chargeKey,
        mode: quoteChargeRecovery.mode,
      })
      .from(quoteChargeRecovery)
      .where(eq(quoteChargeRecovery.quoteId, quoteId));
    const priorByKey = new Map(prior.map((p) => [p.chargeKey, p.mode]));

    // Applied here as well as in the evaluator, because the surface is not the
    // boundary: a set arriving from a replayed action id or a stale tab has
    // been through no evaluation at all.
    //
    // Only for charges that CHANGE, matching the evaluator exactly. Testing an
    // unchanged stored election would refuse a save because of a state the
    // operator is not touching — and would make a quote carrying one refused
    // election permanently unsaveable.
    const ctx = await loadElectionContext(quoteId);

    for (const { chargeKey, mode } of requested) {
      if (priorByKey.get(chargeKey) === mode) continue;
      assertElectionAllowed(chargeKey, mode, ctx);
      await db
        .insert(quoteChargeRecovery)
        .values({ quoteId, chargeKey, mode, electedByUserId: user.id })
        .onConflictDoUpdate({
          target: [quoteChargeRecovery.quoteId, quoteChargeRecovery.chargeKey],
          set: { mode, electedByUserId: user.id, electedAt: new Date() },
        });
      await writeAuditEntry({
        userId: user.id,
        entityType: "quote",
        entityId: quoteId,
        action: "charge_recovery_elected",
        diffJson: {
          charge_key: chargeKey,
          mode: { from: priorByKey.get(chargeKey) ?? null, to: mode },
        },
      });
    }

    // Anything stored that the proposal does not name is CLEARED. The set is
    // the unit of truth here: a charge the operator reverted to inherited
    // treatment leaves the proposal, and leaving its row behind would persist
    // an election they had abandoned.
    const requestedKeys = new Set(requested.map((r) => r.chargeKey));
    const orphans = prior.filter((p) => !requestedKeys.has(p.chargeKey as RecoveryChargeKey));
    if (orphans.length > 0) {
      await db.delete(quoteChargeRecovery).where(
        and(
          eq(quoteChargeRecovery.quoteId, quoteId),
          inArray(
            quoteChargeRecovery.chargeKey,
            orphans.map((o) => o.chargeKey),
          ),
        ),
      );
      for (const o of orphans) {
        await writeAuditEntry({
          userId: user.id,
          entityType: "quote",
          entityId: quoteId,
          action: "charge_recovery_cleared",
          diffJson: { charge_key: o.chargeKey, mode: { from: o.mode, to: null } },
        });
      }
    }

    // READ BACK. The gate's question is "is this set stored", and only the
    // database can answer it — returning the input would be the action
    // confirming itself.
    const after = await db
      .select({
        chargeKey: quoteChargeRecovery.chargeKey,
        mode: quoteChargeRecovery.mode,
      })
      .from(quoteChargeRecovery)
      .where(eq(quoteChargeRecovery.quoteId, quoteId));

    const norm = (rows: { chargeKey: string; mode: string }[]) =>
      rows
        .map((r) => `${r.chargeKey}:${r.mode}`)
        .sort()
        .join("|");

    const persisted = after.map((r) => ({
      chargeKey: r.chargeKey as RecoveryChargeKey,
      mode: r.mode as RecoveryMode,
    }));

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteId,
      persisted,
      matchesRequested: norm(after) === norm(requested),
    };
  });
}

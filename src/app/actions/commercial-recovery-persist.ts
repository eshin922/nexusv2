"use server";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { quoteChargeInstances, quoteChargeRecovery } from "@/db/schema";
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
  storedKeyFor,
} from "@/lib/commercial-recovery/election-context";
import {
  chargePolicy,
  type RecoveryChargeKey,
  type RecoveryMode,
} from "@/lib/commercial-recovery/registry";
import { ensureChargeInstance } from "@/lib/commercial-recovery/charge-instance";

export type PersistedElection = {
  chargeKey: RecoveryChargeKey;
  /** Present for a component charge; absent for a legacy production column. */
  chargeInstanceId?: string;
  mode: RecoveryMode;
};

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
  /**
   * The proposal, as a SET.
   *
   * `chargeInstanceId` names a component-owned charge. Its absence names a
   * legacy production column, for which the type IS the identity.
   *
   * A GROUP ACTION — "Set all Print plates → One-time fee" — arrives here as N
   * entries, one per instance, and is written as N governed rows with N audit
   * entries. There is no type-level stored election, and that is deliberate:
   * a group is ergonomics, never a grain.
   */
  elections: { chargeKey: string; chargeInstanceId?: string; mode: string }[];
}): Promise<ActionResult<PersistChargeRecoverySetResult>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = input.quoteId.trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");

    const quote = await quoteByIdDraft(quoteId);
    // Redundant by construction — draft is a subset of not-frozen — and kept so
    // the Pattern 52 protocol's grep finds this writer.
    assertNotFrozen(quote);

    const requested: PersistedElection[] = input.elections.map((e) => {
      const key = e.chargeKey as RecoveryChargeKey;
      chargePolicy(key); // throws on an unknown key
      return {
        chargeKey: key,
        chargeInstanceId: e.chargeInstanceId,
        mode: e.mode as RecoveryMode,
      };
    });

    // Two proposals for one instance is a surface defect, and silently keeping
    // the last would persist a decision the operator did not see themselves
    // make. Refused rather than resolved.
    const proposedInstances = requested
      .map((r) => r.chargeInstanceId)
      .filter((id): id is string => id !== undefined);
    if (new Set(proposedInstances).size !== proposedInstances.length) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "The same charge was proposed twice in one set.",
      );
    }

    const prior = await db
      .select({
        chargeKey: quoteChargeRecovery.chargeKey,
        chargeInstanceId: quoteChargeRecovery.chargeInstanceId,
        mode: quoteChargeRecovery.mode,
        ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      })
      .from(quoteChargeRecovery)
      .innerJoin(
        quoteChargeInstances,
        eq(quoteChargeInstances.id, quoteChargeRecovery.chargeInstanceId),
      )
      .where(eq(quoteChargeRecovery.quoteId, quoteId));

    // ── PRIOR STATE AT THE GRAIN IT IS ELECTED AT ─────────────────────────
    //
    // A COMPONENT election is keyed by instance; a LEGACY one by type, because
    // for a production column the type is the identity. Reading both by type
    // would make two component siblings look like one another's prior state,
    // and the second write of a group action would then be skipped as
    // "unchanged" while its row still said otherwise.
    //
    // `owner_quote_leaf_id` is the causal test, the same one the costing and
    // election loaders use.
    const priorByGrain = new Map<string, RecoveryMode>();
    for (const p of prior) {
      priorByGrain.set(
        storedKeyFor({
          chargeKey: p.chargeKey,
          chargeInstanceId:
            p.ownerQuoteLeafId !== null && p.chargeInstanceId
              ? p.chargeInstanceId
              : undefined,
        }),
        p.mode,
      );
    }
    // THE SAME key former the evaluator uses. Two implementations would be two
    // answers to "did this change", and the first divergence would evaluate an
    // election cleanly and refuse it at save.
    const priorOf = (e: PersistedElection) =>
      priorByGrain.get(storedKeyFor(e)) ?? null;

    // Applied here as well as in the evaluator, because the surface is not the
    // boundary: a set arriving from a replayed action id or a stale tab has
    // been through no evaluation at all.
    //
    // Only for charges that CHANGE, matching the evaluator exactly. Testing an
    // unchanged stored election would refuse a save because of a state the
    // operator is not touching — and would make a quote carrying one refused
    // election permanently unsaveable.
    const ctx = await loadElectionContext(quoteId);

    // ── EVERY REFUSAL FIRST, BEFORE ANY WRITE ──────────────────────────────
    //
    // A group action is N charges in one gesture. Refusing the third one
    // MID-LOOP left the first two written, so an operator who set all three
    // plate sets to a mode one of them could not carry would find two changed,
    // one not, and an error explaining none of it.
    //
    // The set is the unit of truth, so it is also the unit of refusal: nothing
    // is written unless the whole proposal is allowed.
    const changing = requested.filter((r) => priorOf(r) !== r.mode);
    for (const { chargeKey, mode } of changing) {
      assertElectionAllowed(chargeKey, mode, ctx);
    }

    // ── ONE TRANSACTION FOR THE WHOLE SET ──────────────────────────────────
    //
    // The refusals above already guarantee nothing is written when the
    // proposal is not allowed. This guarantees the same for everything that
    // can still fail after the first statement lands — a constraint, a lost
    // connection, an instance that cannot be resolved.
    //
    // A group action is one operator gesture. Two of three plate sets moved is
    // not a partial success; it is a state nobody chose, and the operator has
    // no way to tell which two.
    //
    // The audit rows ride the same transaction, so the record cannot survive a
    // write that was rolled back.
    await db.transaction(async (tx) => {
      for (const proposal of changing) {
        const { chargeKey, mode } = proposal;
        const before = priorOf(proposal);
        // OD-032 phase 1 — every write carries an instance id. Resolved before
        // the upsert rather than inside it, because the instance is the durable
        // identity and an upsert that created one only on the insert branch
        // would leave re-elections keyed to nothing.
        //
        // A component proposal already names its instance and must NOT synthesise
        // one: `ensureChargeInstance` with no owner would mint a `'@quote'` row,
        // and the election would then key to a charge nobody caused.
        const chargeInstanceId =
          proposal.chargeInstanceId ??
          (await ensureChargeInstance(tx, { quoteId, chargeKey }));
        await tx
          .insert(quoteChargeRecovery)
          .values({
            quoteId,
            chargeKey,
            chargeInstanceId,
            mode,
            electedByUserId: user.id,
          })
          .onConflictDoUpdate({
            // The PRIMARY KEY since phase 1b, and the reason phase 2 can drop the
            // temporary `(quote_id, charge_key)` unique at all: this writer no
            // longer names it, so removing it takes nothing this depends on.
            //
            // It is also the correct target on its own terms. `(quote, charge_key)`
            // could only ever address one charge of a type per quote — which is
            // exactly the limit phase 2 removes, and would have re-elected the
            // wrong carton's plates the moment a second one existed.
            target: [quoteChargeRecovery.chargeInstanceId],
            set: {
              mode,
              chargeInstanceId,
              electedByUserId: user.id,
              electedAt: new Date(),
            },
          });
        await writeAuditEntry(
          {
            userId: user.id,
            entityType: "quote",
            entityId: quoteId,
            action: "charge_recovery_elected",
            diffJson: {
              charge_key: chargeKey,
              // The instance, so a group action's N rows are separable in the
              // audit rather than N indistinguishable entries for one type.
              charge_instance_id: chargeInstanceId,
              mode: { from: before, to: mode },
            },
          },
          tx,
        );
      }

      // Anything stored that the proposal does not name is CLEARED. The set is
      // the unit of truth here: a charge the operator reverted to inherited
      // treatment leaves the proposal, and leaving its row behind would persist
      // an election they had abandoned.
      // Cleared at the grain it was elected at, for the same reason prior state is
      // read that way: a proposal that names one sibling and not the other is
      // clearing exactly one election, and matching by type would clear both.
      const requestedKeys = new Set(
        // `=== undefined`, not a falsy test. A proposal either names an instance
        // or it does not, and that is the exact question — a falsy test on
        // something called `chargeInstanceId` reads as a branch on the nullable
        // COLUMN, which is the shape the phase 1 guard forbids.
        requested
          .filter((r) => r.chargeInstanceId === undefined)
          .map((r) => r.chargeKey),
      );
      const requestedInstances = new Set(proposedInstances);
      const orphans = prior.filter((p) =>
        p.ownerQuoteLeafId !== null && p.chargeInstanceId
          ? !requestedInstances.has(p.chargeInstanceId)
          : !requestedKeys.has(p.chargeKey as RecoveryChargeKey),
      );
      if (orphans.length > 0) {
        await tx.delete(quoteChargeRecovery).where(
          and(
            eq(quoteChargeRecovery.quoteId, quoteId),
            // BY INSTANCE, which is the primary key — so clearing one component
            // charge cannot take its same-type sibling with it.
            inArray(
              quoteChargeRecovery.chargeInstanceId,
              orphans.map((o) => o.chargeInstanceId),
            ),
          ),
        );
        for (const o of orphans) {
          await writeAuditEntry(
            {
              userId: user.id,
              entityType: "quote",
              entityId: quoteId,
              action: "charge_recovery_cleared",
              diffJson: {
                charge_key: o.chargeKey,
                charge_instance_id: o.chargeInstanceId,
                mode: { from: o.mode, to: null },
              },
            },
            tx,
          );
        }
      }
    });

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

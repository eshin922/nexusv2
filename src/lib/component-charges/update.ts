/**
 * Component-charge economics — the COSTS write path, OD-032 step B.
 *
 * ── THE BOUNDARY THIS FILE EXISTS TO HOLD ───────────────────────────────
 *
 *   Setup    what does this component require?   identity + causal ownership
 *   Costs    what does DPS pay?                  ← this file
 *   Recovery how does DPS recover it?            customer treatment
 *
 * So this writes `cost_amount` and `recovery_ask`, and nothing else. It cannot
 * create a charge, cannot change its owner, cannot change its type, and cannot
 * elect a recovery mode. Each of those belongs to a surface that is not this
 * one, and a writer that could do them would make the boundary a convention.
 *
 * ── WHY CLEARING A COST DELETES THE ROW ─────────────────────────────────
 *
 * A blank is not zero — it means the operator has not supplied the fact. But
 * `cost_amount` is NOT NULL, so a blank cannot be stored as a value. Writing 0
 * would be the same defect from the other direction: it states that DPS pays
 * nothing, which is a cost fact nobody entered.
 *
 * So absence is represented by absence. The invariant is exact and checkable:
 *
 *   a `quote_charge_instance_tiers` row exists
 *     IF AND ONLY IF an operator has stated a positive cost for that tier
 *
 * One representation of "no cost stated", so readiness can answer the question
 * by counting rows rather than by interpreting values. The alternative —
 * a nullable `cost_amount` — would give the same state two representations, and
 * every future reader would have to handle both.
 *
 * The recovery ask rides on that row, so clearing a cost clears the ask with
 * it. That is stated rather than silent: an ask is what DPS intends to recover
 * FOR a cost, and there is no cost to recover once the cost is withdrawn.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteTiers,
} from "@/db/schema";
import {
  ActionGuardError,
  ERR,
  assertNotFrozen,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { writeAuditEntry } from "@/lib/audit";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";

/**
 * A money string as the operator typed it, or `null` for a cleared field.
 *
 * Rejected rather than coerced: `Number("")` is 0 and `Number("abc")` is NaN,
 * and both would enter the quote as a cost fact nobody stated.
 */
function money(raw: string | null | undefined, what: string): string | null {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `${what} must be a positive amount with at most two decimals — received "${raw}".`,
    );
  }
  return t;
}

async function loadTarget(quoteId: string, chargeInstanceId: string, tierId: string) {
  const quote = await quoteByIdDraft(quoteId);
  // Pattern 52: charge economics are freeze-list state, so the grep for a
  // writer of them finds it here as well as in the authoring core.
  assertNotFrozen(quote);

  const [charge] = await db
    .select({
      id: quoteChargeInstances.id,
      chargeKey: quoteChargeInstances.chargeKey,
      label: quoteChargeInstances.label,
      ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
    })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.id, chargeInstanceId),
        // Scoped to the quote, not merely to the id. An instance id from
        // another quote would satisfy the primary key and let this surface
        // reprice a different quote's charge.
        eq(quoteChargeInstances.quoteId, quoteId),
      ),
    )
    .limit(1);
  if (!charge) {
    throw new ActionGuardError(ERR.NOT_FOUND, "That charge is not on this quote.");
  }
  if (charge.ownerQuoteLeafId === null) {
    // A legacy `'@quote'` instance stands for a production column. Its amount
    // lives on that column and is authored on Production; pricing it here would
    // create a second source of truth for one number.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That charge is not component-owned, so its cost is not entered here.",
    );
  }

  const [tier] = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label })
    .from(quoteTiers)
    .where(and(eq(quoteTiers.id, tierId), eq(quoteTiers.quoteId, quoteId)))
    .limit(1);
  if (!tier) {
    throw new ActionGuardError(ERR.NOT_FOUND, "That tier is not on this quote.");
  }

  const [existing] = await db
    .select({
      costAmount: quoteChargeInstanceTiers.costAmount,
      recoveryAsk: quoteChargeInstanceTiers.recoveryAsk,
    })
    .from(quoteChargeInstanceTiers)
    .where(
      and(
        eq(quoteChargeInstanceTiers.chargeInstanceId, chargeInstanceId),
        eq(quoteChargeInstanceTiers.tierId, tierId),
      ),
    )
    .limit(1);

  return { quote, charge, tier, existing: existing ?? null };
}

/**
 * What DPS pays for this charge at this tier.
 *
 * `cost === null` (a cleared field) removes the amount. Anything else must be a
 * positive money string: an explicit `0.00` is refused for the same reason a
 * blank is not zero — it is the obvious way round the blank check, and it would
 * encode "this charge does not apply at this tier" as an amount. If charges
 * ever need to apply to only some tiers, that is an applicability model with
 * its own storage and its own meaning.
 */
export async function updateComponentChargeCostAs(
  userId: string,
  input: {
    quoteId: string;
    chargeInstanceId: string;
    tierId: string;
    cost: string | null;
  },
): Promise<ActionResult<{ chargeInstanceId: string; tierId: string; cost: string | null }>> {
  return runAction(async () => {
    const { quote, charge, tier, existing } = await loadTarget(
      input.quoteId,
      input.chargeInstanceId,
      input.tierId,
    );

    const next = money(input.cost, `Cost for ${tier.label}`);
    if (next !== null && Number(next) === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `A cost of 0.00 for ${tier.label} is not a cost. Enter what DPS pays, ` +
          "or clear the field to say it has not been decided yet.",
      );
    }

    const before = existing?.costAmount ?? null;
    if (before === next) {
      return { chargeInstanceId: input.chargeInstanceId, tierId: input.tierId, cost: next };
    }

    await db.transaction(async (tx) => {
      if (next === null) {
        // Absence represented by absence — see the header. The ask goes with
        // it, because an ask is what DPS intends to recover for a cost.
        await tx
          .delete(quoteChargeInstanceTiers)
          .where(
            and(
              eq(quoteChargeInstanceTiers.chargeInstanceId, input.chargeInstanceId),
              eq(quoteChargeInstanceTiers.tierId, input.tierId),
            ),
          );
      } else {
        await tx
          .insert(quoteChargeInstanceTiers)
          .values({
            chargeInstanceId: input.chargeInstanceId,
            tierId: input.tierId,
            costAmount: next,
            // Preserved across a cost edit. Re-pricing what DPS pays is not a
            // statement about what DPS asks for.
            recoveryAsk: existing?.recoveryAsk ?? null,
          })
          .onConflictDoUpdate({
            target: [
              quoteChargeInstanceTiers.chargeInstanceId,
              quoteChargeInstanceTiers.tierId,
            ],
            set: { costAmount: next, updatedAt: new Date() },
          });
      }

      await writeAuditEntry(
        {
          userId,
          entityType: "quote",
          entityId: input.quoteId,
          // Named for the transition, not the mechanism: the charge's cost
          // changed. Whether that was an insert, an update or a delete is the
          // mechanism, and it is legible from `from`/`to`.
          action: "component_charge_cost_updated",
          diffJson: {
            charge_instance_id: input.chargeInstanceId,
            charge_key: charge.chargeKey,
            owner_quote_leaf_id: charge.ownerQuoteLeafId,
            label: charge.label,
            tier_id: input.tierId,
            tier_label: tier.label,
            // `to: null` is a clear; `from: null` is a first-time entry. The
            // variant is legible from the pair, so there is no source flag —
            // that is reserved for distinguishing ORIGIN, not action variant.
            cost: { from: before, to: next },
            ...(next === null && existing?.recoveryAsk
              ? // Said, not silent. The ask was removed as a consequence of the
                // cost being withdrawn, and the record has to carry that or the
                // ask appears to have vanished on its own.
                { recovery_ask_cleared_with_cost: existing.recoveryAsk }
              : {}),
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(quote.projectId, input.quoteId);
    return { chargeInstanceId: input.chargeInstanceId, tierId: input.tierId, cost: next };
  });
}

/**
 * What DPS intends to recover for this charge at this tier.
 *
 * NULL is not zero. Zero says the charge recovers nothing; NULL says nothing
 * governs what it recovers yet (BV-013), and the two reach the customer
 * document differently.
 *
 * Moved here from Setup UNCHANGED — still nullable, still manual, still no
 * derivation rule. Whether it should be operator-entered at all, or derived
 * from a governed markup category the way every other charge's recovery is, is
 * a real question and a separate disposition. It is not decided by moving the
 * field to the surface that owns economics.
 *
 * ── THAT DISPOSITION HAPPENED. THIS IS NO LONGER AN OPERATOR PATH ───────
 *
 * Edward, 2026-08-29: "Costs owns governed cost; Pricing derives recovery from
 * charge-type authority." The question above is answered — derived, from the
 * charge TYPE's governed markup category, never typed.
 *
 * So `updateComponentChargeAsk` (the server action) is GONE and the Costs
 * recovery field with it. What this writer still does is write a column the
 * engine no longer reads: `componentChargeEconomics` derives recovery from
 * cost and rate and never looks at `recovery_ask`.
 *
 * It survives for ONE reason: the OD-032 gate scripts
 * (`od-032-costs-economics-proof`, `od-032-document-invariant`) call it, and
 * they are certification evidence for phases already closed. Rewriting a
 * passed gate to suit a later change would falsify the record it exists to
 * keep. They are untouched; this writer is the fixture tool they use.
 *
 * DO NOT wire this to a surface. A value written here has no commercial effect
 * and would read to an operator as though it did — which is the failure this
 * disposition removed, not one to reintroduce behind a different door.
 */
export async function updateComponentChargeAskAs(
  userId: string,
  input: {
    quoteId: string;
    chargeInstanceId: string;
    tierId: string;
    ask: string | null;
  },
): Promise<ActionResult<{ chargeInstanceId: string; tierId: string; ask: string | null }>> {
  return runAction(async () => {
    const { quote, charge, tier, existing } = await loadTarget(
      input.quoteId,
      input.chargeInstanceId,
      input.tierId,
    );

    if (!existing) {
      // ── COST FIRST ────────────────────────────────────────────────────
      //
      // Creating the row here would mint an economics row whose cost nobody
      // stated, which the readiness invariant forbids: a row exists iff a
      // positive cost was entered. And commercially it is the wrong order —
      // an ask is what DPS intends to recover for a cost, so there has to be
      // one.
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Enter what DPS pays at ${tier.label} before what it recovers.`,
      );
    }

    const next = money(input.ask, `Recovery ask for ${tier.label}`);
    const before = existing.recoveryAsk ?? null;
    if (before === next) {
      return { chargeInstanceId: input.chargeInstanceId, tierId: input.tierId, ask: next };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(quoteChargeInstanceTiers)
        .set({ recoveryAsk: next, updatedAt: new Date() })
        .where(
          and(
            eq(quoteChargeInstanceTiers.chargeInstanceId, input.chargeInstanceId),
            eq(quoteChargeInstanceTiers.tierId, input.tierId),
          ),
        );

      await writeAuditEntry(
        {
          userId,
          entityType: "quote",
          entityId: input.quoteId,
          action: "component_charge_recovery_ask_updated",
          diffJson: {
            charge_instance_id: input.chargeInstanceId,
            charge_key: charge.chargeKey,
            owner_quote_leaf_id: charge.ownerQuoteLeafId,
            label: charge.label,
            tier_id: input.tierId,
            tier_label: tier.label,
            recovery_ask: { from: before, to: next },
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(quote.projectId, input.quoteId);
    return { chargeInstanceId: input.chargeInstanceId, tierId: input.tierId, ask: next };
  });
}

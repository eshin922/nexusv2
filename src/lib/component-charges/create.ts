/**
 * Component-owned one-time charges — authoring CORE.
 *
 * ── WHY THIS IS NOT THE SERVER ACTION ────────────────────────────────────
 *
 * The action is a thin wrapper in `app/actions/component-charges.ts` that
 * resolves the operator and calls in here. The split exists so a governed gate
 * script can exercise the REAL write path: the script resolver deliberately
 * refuses to stub authentication for write paths — "a stubbed guard is a guard
 * that passes" — so a `"use server"` export calling `ensureUser()` cannot run
 * outside a request, and a proof that skipped it would be proving a different
 * function from the one operators use.
 *
 * The guard is not weakened. `ensureUser()` still runs on the only door the UI
 * can reach, and this module is NOT a server action, so nothing here is exposed
 * as an endpoint.
 *
 * The phase-4 sheet's write path. It creates charge INSTANCES against a
 * packaging component and their per-tier economics, and it deliberately does
 * NOT elect a recovery mode: charges arrive `unplaced`, and the send checklist
 * holds until each has a placement.
 *
 * ── WHY PLACEMENT IS NOT ASKED HERE ─────────────────────────────────────
 *
 * Asking for it would fuse the two decisions the model keeps apart. What was
 * caused and what it cost is a Setup question; who pays for it is a Commercial
 * Recovery one. An operator entering a die cost has not yet decided whether the
 * customer sees it, and a sheet that made them decide would collect an answer
 * to a question they were not asked.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteLeaves,
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
import { ensureChargeInstance } from "@/lib/commercial-recovery/charge-instance";
import {
  COMPONENT_CHARGE_LABELS,
  isComponentChargeKey,
  labelRequiredFor,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";

export type ComponentChargeDraft = {
  chargeKey: string;
  /** Required for `other`; an optional override otherwise. */
  label?: string | null;
  /** Operator-entered, per tier. Nothing is derived from anything. */
  amounts: { tierId: string; cost: string; recoveryAsk?: string | null }[];
};

export type CreateComponentChargesResult = {
  quoteLeafId: string;
  /** The instances now stored, read back. */
  created: { chargeInstanceId: string; chargeKey: string; label: string | null }[];
};

/**
 * A money string as the operator typed it.
 *
 * Rejected rather than coerced: `Number("")` is 0 and `Number("abc")` is NaN,
 * and both would enter the quote as a cost fact nobody stated. An amount that
 * cannot be read is a refusal, not a zero.
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

/**
 * Create one or more charges against a packaging component.
 *
 * The whole set, or none of it. A sheet is one operator gesture: half its
 * charges landing is a state nobody chose, and the operator cannot tell which
 * half.
 */
export async function createComponentChargesAs(
  userId: string,
  input: {
    quoteId: string;
    quoteLeafId: string;
    charges: ComponentChargeDraft[];
  },
): Promise<ActionResult<CreateComponentChargesResult>> {
  return runAction(async () => {
    const user = { id: userId };
    const quoteId = input.quoteId.trim();
    const quoteLeafId = input.quoteLeafId.trim();
    if (!quoteId || !quoteLeafId) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId and quoteLeafId are required.");
    }
    if (input.charges.length === 0) {
      throw new ActionGuardError(ERR.VALIDATION, "No charges were submitted.");
    }

    const quote = await quoteByIdDraft(quoteId);
    // Pattern 52: charges are frozen-list state, so the grep for this writer
    // finds it here.
    assertNotFrozen(quote);

    // ── THE COMPONENT MUST BE ON THIS QUOTE ──────────────────────────────
    //
    // Not merely present somewhere. A leaf id from another quote would satisfy
    // the foreign key and attribute this quote's charge to a component it does
    // not contain.
    const [leaf] = await db
      .select({ id: quoteLeaves.id })
      .from(quoteLeaves)
      .where(and(eq(quoteLeaves.id, quoteLeafId), eq(quoteLeaves.quoteId, quoteId)))
      .limit(1);
    if (!leaf) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "That component is not on this quote.",
      );
    }

    const tiers = await db
      .select({ id: quoteTiers.id, label: quoteTiers.label })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quoteId));
    if (tiers.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "This quote has no tiers, so there is nothing to price a charge against.",
      );
    }
    const tierIds = new Set(tiers.map((t) => t.id));

    // ── VALIDATE THE WHOLE SET BEFORE WRITING ANY OF IT ──────────────────
    //
    // Same discipline as the recovery writer, for the same reason: refusing the
    // third charge mid-write leaves the first two stored, and the operator gets
    // a partial sheet with an error explaining none of it.
    const validated = input.charges.map((c) => {
      if (!isComponentChargeKey(c.chargeKey)) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `"${c.chargeKey}" is not a charge a component can own.`,
        );
      }
      const key = c.chargeKey as ComponentChargeKey;
      const label = c.label?.trim() || null;
      if (labelRequiredFor(key) && !label) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Other requires a label saying what the charge is for.",
        );
      }
      const byTier = new Map(c.amounts.map((a) => [a.tierId, a]));
      for (const a of c.amounts) {
        if (!tierIds.has(a.tierId)) {
          throw new ActionGuardError(
            ERR.VALIDATION,
            "A charge was priced against a tier that is not on this quote.",
          );
        }
      }

      // ── EVERY QUOTED TIER NEEDS AN EXPLICIT POSITIVE COST ────────────────
      //
      // A BLANK IS NOT ZERO. It means the operator has not supplied the
      // economic fact, and defaulting it would put a cost of nothing into the
      // quote on their behalf — a number nobody stated, indistinguishable
      // afterwards from one they did.
      //
      // AN EXPLICIT 0.00 IS ALSO REFUSED, and that is not pedantry: it is the
      // obvious way round the blank check, and it would encode "this charge
      // does not apply at this tier" as an amount. If charges ever need to
      // apply to only some tiers, that is an applicability model with its own
      // storage and its own meaning — not a zero that every reader downstream
      // has to guess the intent of.
      const missing: string[] = [];
      const zeroed: string[] = [];
      const amounts = tiers.map((t) => {
        const a = byTier.get(t.id);
        const raw = money(a?.cost, `Cost for ${t.label}`);
        if (raw === null) {
          missing.push(t.label);
          return { tierId: t.id, cost: "0", recoveryAsk: null };
        }
        if (Number(raw) === 0) {
          zeroed.push(t.label);
        }
        return {
          tierId: t.id,
          cost: raw,
          // NULL is not zero. Zero says the charge recovers nothing; NULL says
          // nothing governs what it recovers yet (BV-013). It stays optional
          // because it is a different question with a different answer.
          recoveryAsk: money(a?.recoveryAsk, `Recovery ask for ${t.label}`),
        };
      });

      // NAMED, so the operator can go and fix them. A refusal that says only
      // "a cost is missing" on a five-tier quote leaves them checking all five.
      if (missing.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${COMPONENT_CHARGE_LABELS[key]} has no cost for ` +
            `${missing.join(", ")}. Enter what DPS pays at ` +
            `${missing.length === 1 ? "that tier" : "those tiers"}, or remove the charge.`,
        );
      }
      if (zeroed.length > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${COMPONENT_CHARGE_LABELS[key]} has a cost of 0.00 for ` +
            `${zeroed.join(", ")}. A charge that costs nothing is not a charge — ` +
            "enter what DPS pays, or remove it.",
        );
      }

      return { key, label, amounts };
    });

    const created: CreateComponentChargesResult["created"] = [];

    await db.transaction(async (tx) => {
      for (const c of validated) {
        // The instance carries the CAUSAL owner. `ensureChargeInstance` derives
        // `owner_quote_leaf_id` from it and writes both columns, so the
        // owner-agreement CHECK holds by construction.
        //
        // Idempotent by the business-uniqueness constraint: re-submitting the
        // same (type, component, label) resolves the existing charge rather
        // than minting a rival identity for one commercial fact. Two charges of
        // one type on one component are distinguished by their LABELS, which is
        // what the sheet requires when it offers a second.
        const chargeInstanceId = await ensureChargeInstance(tx, {
          quoteId,
          chargeKey: c.key,
          ownerRef: quoteLeafId,
          label: c.label,
        });

        for (const a of c.amounts) {
          await tx
            .insert(quoteChargeInstanceTiers)
            .values({
              chargeInstanceId,
              tierId: a.tierId,
              costAmount: a.cost,
              recoveryAsk: a.recoveryAsk,
            })
            .onConflictDoUpdate({
              target: [
                quoteChargeInstanceTiers.chargeInstanceId,
                quoteChargeInstanceTiers.tierId,
              ],
              set: {
                costAmount: a.cost,
                recoveryAsk: a.recoveryAsk,
                updatedAt: new Date(),
              },
            });
        }

        await writeAuditEntry(
          {
            userId: user.id,
            entityType: "quote",
            entityId: quoteId,
            action: "component_charge_created",
            diffJson: {
              charge_key: c.key,
              charge_instance_id: chargeInstanceId,
              // The CAUSAL owner, recorded as the cause it is.
              owner_quote_leaf_id: quoteLeafId,
              label: c.label,
              amounts: c.amounts,
              // NOT elected here, and the record says so rather than leaving a
              // reader to infer it from an absent field.
              recovery: "unplaced",
            },
          },
          tx,
        );

        created.push({
          chargeInstanceId,
          chargeKey: c.key,
          label: c.label,
        });
      }
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { quoteLeafId, created };
  });
}

/**
 * Remove a component-owned charge.
 *
 * Its per-tier economics cascade; any recovery election on it cascades through
 * the instance's own foreign key. The frozen record does NOT — a sent quote's
 * instruction is what Accounting was told, and its pointer is `ON DELETE SET
 * NULL` precisely so removing a draft charge cannot rewrite history.
 */
export async function deleteComponentChargeAs(
  userId: string,
  input: { quoteId: string; chargeInstanceId: string },
): Promise<ActionResult<{ chargeInstanceId: string }>> {
  return runAction(async () => {
    const user = { id: userId };
    const quote = await quoteByIdDraft(input.quoteId);
    assertNotFrozen(quote);

    const [row] = await db
      .select({
        id: quoteChargeInstances.id,
        chargeKey: quoteChargeInstances.chargeKey,
        label: quoteChargeInstances.label,
        ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
      })
      .from(quoteChargeInstances)
      .where(
        and(
          eq(quoteChargeInstances.id, input.chargeInstanceId),
          eq(quoteChargeInstances.quoteId, input.quoteId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new ActionGuardError(ERR.NOT_FOUND, "That charge is not on this quote.");
    }
    // A legacy `'@quote'` instance is not this action's to delete: it stands for
    // a production column, and removing it would orphan an election the column
    // still resolves.
    if (row.ownerQuoteLeafId === null) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "That charge is not component-owned and cannot be removed here.",
      );
    }

    await db.transaction(async (tx) => {
      const amounts = await tx
        .select({
          tierId: quoteChargeInstanceTiers.tierId,
          costAmount: quoteChargeInstanceTiers.costAmount,
          recoveryAsk: quoteChargeInstanceTiers.recoveryAsk,
        })
        .from(quoteChargeInstanceTiers)
        .where(inArray(quoteChargeInstanceTiers.chargeInstanceId, [row.id]));

      await tx
        .delete(quoteChargeInstances)
        .where(eq(quoteChargeInstances.id, row.id));

      await writeAuditEntry(
        {
          userId: user.id,
          entityType: "quote",
          entityId: input.quoteId,
          action: "component_charge_deleted",
          // The full pre-delete snapshot, because after this the row is gone
          // and the audit is the only account of what it held.
          diffJson: {
            charge_key: row.chargeKey,
            charge_instance_id: row.id,
            owner_quote_leaf_id: row.ownerQuoteLeafId,
            label: row.label,
            amounts,
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(quote.projectId, input.quoteId);
    return { chargeInstanceId: input.chargeInstanceId };
  });
}

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
 * The Setup sheet's write path. It creates charge INSTANCES against a packaging
 * component — type, causal owner, label — and NOTHING ELSE.
 *
 * ── THE THREE SURFACES, AND WHY THIS ONE STOPS HERE ─────────────────────
 *
 *   Setup    what does this component require?   ← this writer
 *   Costs    what does DPS pay?
 *   Recovery how does DPS recover it?
 *
 * It used to write per-tier economics too. That put what DPS pays on the
 * surface that defines structure, and the two are different questions answered
 * by an operator with different things in front of them.
 *
 * So a charge is created with NO economics and NO election. Both absences are
 * expected intermediate states rather than errors:
 *
 *   no economics   readiness reports it, Costs is where it is completed, and
 *                  send refuses the quote until every quoted tier has a cost
 *   no election    Commercial Recovery is where it is placed, and send refuses
 *                  the quote until each charge has a placement
 *
 * Setup is not blocked for producing either. It is blocked from RESOLVING
 * either, which is a different thing and is the boundary.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteLeaves,
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
  /**
   * Required for `other_service`; an optional override otherwise, and what
   * tells two charges of one type on one component apart.
   *
   * The ONLY free text this writer accepts. There is deliberately no `amounts`
   * field: a shape that could carry economics would let a caller send them,
   * and the boundary would be held by every caller remembering not to.
   */
  label?: string | null;
};

export type CreateComponentChargesResult = {
  quoteLeafId: string;
  /** The instances now stored, read back. */
  created: { chargeInstanceId: string; chargeKey: string; label: string | null }[];
};

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

    // ── WHAT THIS COMPONENT ALREADY OWNS ──────────────────────────────────
    //
    // Read before validating, because a second charge of a type is only legal
    // if it is DISTINGUISHABLE from the first — and a label is what
    // distinguishes them.
    const owned = await db
      .select({
        chargeKey: quoteChargeInstances.chargeKey,
        label: quoteChargeInstances.label,
      })
      .from(quoteChargeInstances)
      .where(
        and(
          eq(quoteChargeInstances.quoteId, quoteId),
          eq(quoteChargeInstances.ownerQuoteLeafId, quoteLeafId),
        ),
      );
    const ownedKey = (k: string, l: string | null) => `${k}\u0000${l ?? ""}`;
    const taken = new Set(owned.map((o) => ownedKey(o.chargeKey, o.label)));
    const labelsFor = (k: string) =>
      owned.filter((o) => o.chargeKey === k).map((o) => o.label);

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

      // ── A SECOND OF A TYPE MUST BE TOLD APART FROM THE FIRST ────────────
      //
      // `ensureChargeInstance` is idempotent on (quote, type, owner, label),
      // and rightly so — re-submitting one commercial fact must not mint a
      // rival identity for it. But that made this path report SUCCESS for a
      // write it did not perform: an operator adding a second Print plates
      // with no label silently got the first one back.
      //
      // Measured on production 2026-08-28: three submissions, two charges, no
      // error shown. Nothing was corrupted and nothing was created, which is
      // the worst combination to hand an operator — the surface said it worked.
      //
      // So the collision is REFUSED and named. The idempotency stays where it
      // belongs, on `ensureChargeInstance`, which the copy path still relies on.
      // ── A SECOND OF A TYPE NEEDS A LABEL AT ALL ────────────────────────
      //
      // Checked BEFORE the exact-duplicate test, because it is the wider rule
      // and the narrow one cannot stand in for it: `(print_plates, null)` does
      // not collide with `(print_plates, "Front panel")`, so an unlabelled
      // second charge slipped straight past a duplicate check and minted a
      // third identity nothing could tell from the first two.
      //
      // Caught by the runtime proof, not by the source assertions — they could
      // see that a collision was refused and not that this was not one.
      if (label === null && labelsFor(key).length > 0) {
        const existing = labelsFor(key).filter((l) => l !== null) as string[];
        throw new ActionGuardError(
          ERR.VALIDATION,
          `This component already has a ${COMPONENT_CHARGE_LABELS[key]} charge. ` +
            "A second one needs a label saying what tells it apart from the first" +
            (existing.length > 0 ? ` (already used: ${existing.join(", ")}).` : "."),
        );
      }
      if (taken.has(ownedKey(key, label))) {
        const existing = labelsFor(key).filter((l) => l !== null) as string[];
        throw new ActionGuardError(
          ERR.VALIDATION,
          label === null
            ? `This component already has a ${COMPONENT_CHARGE_LABELS[key]} charge. ` +
              "A second one needs a label saying what tells it apart from the first" +
              (existing.length > 0 ? ` (already used: ${existing.join(", ")}).` : ".")
            : `This component already has a ${COMPONENT_CHARGE_LABELS[key]} charge ` +
              `labelled "${label}". Give the new one a different label.`,
        );
      }
      // Two drafts in ONE submission colliding with each other, which the
      // stored set cannot see. The sheet offers one row per type so this needs
      // a caller to construct it, but a refusal is cheaper than the alternative.
      taken.add(ownedKey(key, label));

      return { key, label };
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
              // BOTH absences recorded, rather than left for a reader to infer
              // from missing fields. A charge is created structurally complete
              // and commercially unfinished, and the audit says which.
              economics: "none",
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

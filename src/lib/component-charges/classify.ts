/**
 * THE ACCOUNTING CLASSIFICATION OF A TOOLING CHARGE — the Costs write path.
 *
 * ── WHY THIS IS ITS OWN MODULE ──────────────────────────────────────────
 *
 * `update.ts` states its boundary exactly: it writes `cost_amount` and
 * `recovery_ask` "and nothing else ... cannot change its type." That sentence
 * is load-bearing, so this writer lives beside it rather than inside it. A
 * classification is not a cost and not a type; it is a third fact, and folding
 * it into a file that says it holds two would make that statement a convention.
 *
 * ── WHY AN OPERATOR STATES IT, AND NOTHING INFERS IT ────────────────────
 *
 * BV-011 governs a cutting die and a mould as DIFFERENT accounting
 * destinations, and "Tooling & dies" is authored as one charge type covering
 * both — "cutting dies, moulds, collars specific to this component's geometry"
 * (OD-032 §V1 charge vocabulary). Nothing on the charge distinguishes them: not
 * the owner, the SKU, the component type, the label or the amount. A bottle's
 * tooling is USUALLY a mould, and "usually" is not an accounting authority —
 * the one case where it is wrong posts to the wrong account with nothing
 * saying so.
 *
 * So the operator states it. This is the only writer, and it accepts only the
 * two governed values or `null`.
 *
 * ── WHY IT IS CLEARABLE ─────────────────────────────────────────────────
 *
 * `null` is a real state: "no accounting classification has been stated." It is
 * what every existing Tooling instance carries, because no historical row can
 * be backfilled without inventing a fact nobody authored. Clearing returns to
 * it honestly, and the send gate refuses on it — which is the correct refusal,
 * not a defect to route around.
 *
 * ── AND IT DECIDES NOTHING ABOUT RECOVERY ───────────────────────────────
 *
 * Two authorities. `included` / `separate` decides whether a separate line
 * EXISTS; this decides what identity that line uses when it does. Classifying a
 * charge does not make an Included one emit, and an Included charge is sendable
 * with no classification at all.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { quoteChargeInstances } from "@/db/schema";
import { ActionGuardError, ERR, assertNotFrozen, runAction } from "@/lib/action-result";
import { writeAuditEntry } from "@/lib/audit";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  TOOLING_CLASSIFICATIONS,
  type ToolingClassification,
} from "@/lib/netsuite/component-charge-destination";

export async function updateToolingClassificationAs(
  userId: string,
  input: {
    quoteId: string;
    chargeInstanceId: string;
    /** `null` clears it, back to "not stated". */
    classification: ToolingClassification | null;
  },
) {
  return runAction(async () => {
    const quote = await quoteByIdDraft(input.quoteId);
    // Pattern 52: the classification decides an accounting identity a sent
    // quote has already committed to, so it is freeze-list state. `requireDraft`
    // inside the loader is already stricter than this, and the explicit call is
    // what a grep for a writer of freeze-list state finds — the same reason
    // `update.ts` states it rather than relying on the loader.
    assertNotFrozen(quote);

    if (
      input.classification !== null &&
      !(TOOLING_CLASSIFICATIONS as readonly string[]).includes(input.classification)
    ) {
      // The closed set, checked here as well as by the DB enum. A third value
      // is a new accounting destination — a BV-011 decision, not a code change.
      throw new ActionGuardError(ERR.VALIDATION, "That is not a tooling classification.");
    }

    const [charge] = await db
      .select({
        id: quoteChargeInstances.id,
        chargeKey: quoteChargeInstances.chargeKey,
        label: quoteChargeInstances.label,
        ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
        before: quoteChargeInstances.toolingClassification,
      })
      .from(quoteChargeInstances)
      .where(
        and(
          eq(quoteChargeInstances.id, input.chargeInstanceId),
          // Scoped to the quote, not merely to the id. An instance id from
          // another quote would satisfy the primary key and let this surface
          // classify a different quote's charge.
          eq(quoteChargeInstances.quoteId, input.quoteId),
        ),
      )
      .limit(1);
    if (!charge) {
      throw new ActionGuardError(ERR.NOT_FOUND, "That charge is not on this quote.");
    }
    if (charge.chargeKey !== "tooling") {
      // Also a CHECK constraint. A classification on a Print plates instance
      // would be a fact about nothing, and would read as authority to whoever
      // found it next.
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Only a Tooling & dies charge carries an accounting classification.",
      );
    }

    if (charge.before === input.classification) return;

    await db.transaction(async (tx) => {
      await tx
        .update(quoteChargeInstances)
        .set({ toolingClassification: input.classification })
        .where(eq(quoteChargeInstances.id, input.chargeInstanceId));

      await writeAuditEntry(
        {
          userId,
          entityType: "quote",
          entityId: input.quoteId,
          action: "component_charge_tooling_classification_updated",
          diffJson: {
            charge_instance_id: input.chargeInstanceId,
            charge_key: charge.chargeKey,
            owner_quote_leaf_id: charge.ownerQuoteLeafId,
            label: charge.label,
            tooling_classification: { from: charge.before, to: input.classification },
          },
        },
        tx,
      );
    });

    revalidateQuoteTree(quote.projectId, input.quoteId);
  });
}

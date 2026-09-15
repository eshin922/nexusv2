"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionCompletions, users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidatePath } from "next/cache";

/**
 * Production's completion state.
 *
 * ── WHAT IT RECORDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────
 *
 * Who completed the module, and when. That is the whole of it. Nothing here
 * inspects whether the production tiers are costed, and the control is never
 * disabled on that basis: completion is an OPERATOR DECISION, and what is
 * stored is that someone made it. Deriving it from populated fields would be
 * a different claim — that the data looks finished — which is not the same
 * thing and is nobody's decision.
 *
 * ── WHY THIS FILE EXISTS WHEN PACKAGING AND FREIGHT HAVE NO EQUIVALENT ───
 *
 * Packaging completion and Freight completion are the two ends of ONE fact,
 * and `freight-handoff.ts` already owns it. Marking Packaging complete IS
 * requesting freight; marking Freight complete IS closing that request.
 * Adding state here for either would be a second source of truth for
 * something that already has one.
 *
 * Production hands nothing to anyone. It has no handoff to borrow, which is
 * why it — and only it — needed state of its own.
 *
 * ── REOPENING KEEPS THE HISTORY ──────────────────────────────────────────
 *
 * A reopen marks the row `reopened` rather than deleting it, and completing
 * again mints a NEW row. What was claimed, by whom, and that it was pulled
 * back stays readable. That is also why the unique index is on
 * `status = 'completed'` rather than on the quote.
 */

export type ProductionCompletionState = {
  completionId: string;
  quoteId: string;
  completedByUserId: string;
  completedByEmail: string | null;
  completedAt: Date;
};

/** The standing completion for a quote, if there is one. */
export async function getProductionCompletion(
  quoteId: string,
): Promise<ActionResult<ProductionCompletionState | null>> {
  return runAction(async () => {
    await ensureUser();
    const [row] = await db
      .select()
      .from(productionCompletions)
      .where(
        and(
          eq(productionCompletions.quoteId, quoteId),
          eq(productionCompletions.status, "completed"),
        ),
      )
      .orderBy(desc(productionCompletions.completedAt))
      .limit(1);
    if (!row) return null;
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.completedByUserId))
      .limit(1);
    return {
      completionId: row.id,
      quoteId: row.quoteId,
      completedByUserId: row.completedByUserId,
      completedByEmail: u?.email ?? null,
      completedAt: row.completedAt,
    };
  });
}

/**
 * Mark Production complete.
 *
 * Clicking it twice does nothing the second time. The partial unique index
 * permits one standing completion per quote, so the second insert cannot
 * land — enforced by the database rather than by a read-then-write in here,
 * which two clicks can interleave through.
 */
export async function markProductionComplete(
  formData: FormData,
): Promise<ActionResult<ProductionCompletionState>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId is required.");

    // The SAME permission that governs editing this quote, and the same one
    // marking packaging ready carries. The Costs surface hides the control on
    // a non-draft quote; the action has to enforce it, because a hidden
    // control is not an absent endpoint.
    await quoteByIdDraft(quoteId);

    // The completion and its audit entry COMMIT TOGETHER. Written as two
    // statements, an audit failure left a completion with no record of who made
    // it — and who completed it and when is the entire content of this record,
    // so one without an audit row says a module was finished by nobody.
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(productionCompletions)
        .values({
          quoteId,
          completedByUserId: user.id,
          status: "completed",
        })
        // The second click of a double-click. Nothing is created; the standing
        // completion is returned as-is.
        .onConflictDoNothing()
        .returning({
          id: productionCompletions.id,
          completedAt: productionCompletions.completedAt,
        });

      if (inserted.length === 0) return null;

      await writeAuditEntry(
        {
          userId: user.id,
          entityType: "quote",
          entityId: quoteId,
          action: "production_completed",
          diffJson: {
            completion_id: inserted[0].id,
            basis: "operator marked production complete",
          },
        },
        tx,
      );

      return inserted[0];
    });

    if (created === null) {
      const existing = await getProductionCompletion(quoteId);
      if (existing.ok && existing.data) return existing.data;
      throw new ActionGuardError(
        ERR.DATA_INTEGRITY,
        "Production is already marked complete on this quote, but that record " +
          "could not be read back.",
      );
    }

    revalidatePath("/");
    return {
      completionId: created.id,
      quoteId,
      completedByUserId: user.id,
      completedByEmail: user.email ?? null,
      completedAt: created.completedAt,
    };
  });
}

/**
 * Reopen Production.
 *
 * Conditioned on THIS completion still standing. A screen opened before
 * someone else reopened and re-completed holds the OLD id, and reopening
 * "whatever is standing on this quote" would let it pull back a completion it
 * never displayed.
 */
export async function reopenProduction(
  formData: FormData,
): Promise<ActionResult<{ completionId: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const completionId = String(formData.get("completionId") ?? "").trim();
    if (!completionId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "completionId is required: a reopen has to name the completion it pulls back.",
      );
    }

    const [completion] = await db
      .select()
      .from(productionCompletions)
      .where(eq(productionCompletions.id, completionId))
      .limit(1);
    if (!completion) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        "That production completion no longer exists.",
      );
    }

    // Reopening is the quote side taking its own claim back, so it carries the
    // quote's edit permission — the same one that governs claiming.
    await quoteByIdDraft(completion.quoteId);

    // ── WHY NO REVISION COLUMN HERE ──────────────────────────────────────
    //
    // `freight_handoffs` needed one because completion and reopening move ONE
    // row back and forth, so `(id, status)` cannot tell an earlier completed
    // state from a later one. This table never reuses a row: reopening marks
    // the record `reopened` — terminal for that row — and completing again
    // INSERTS a new one. Each completion therefore has an id no later
    // completion can hold, and the id IS the revision. A column here would be
    // ceremony around a guarantee the shape already gives.
    const pulled = await db.transaction(async (tx) => {
      const rows = await tx
        .update(productionCompletions)
        .set({
          status: "reopened",
          reopenedByUserId: user.id,
          reopenedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productionCompletions.id, completionId),
            eq(productionCompletions.status, "completed"),
          ),
        )
        .returning({ id: productionCompletions.id });

      if (rows.length === 0) return null;

      // In the SAME transaction, for the same reason completing is: a reopen
      // with no record of who reopened it undoes someone's decision anonymously.
      await writeAuditEntry(
        {
          userId: user.id,
          entityType: "quote",
          entityId: completion.quoteId,
          action: "production_reopened",
          diffJson: { completion_id: rows[0].id, basis: "production reopened" },
        },
        tx,
      );

      return rows[0];
    });

    if (pulled === null) {
      throw new ActionGuardError(
        ERR.STALE_WRITE,
        "Production is no longer marked complete — it was reopened elsewhere, " +
          "and may have been completed again since. Reload before acting.",
      );
    }

    revalidatePath("/");
    return { completionId: pulled.id };
  });
}

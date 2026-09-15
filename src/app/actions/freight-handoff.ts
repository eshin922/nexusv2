"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings, freightHandoffs, quotes, users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidatePath } from "next/cache";
import { deliverFreightHandoff } from "@/lib/slack/deliver-freight-handoff";

/**
 * The packaging → logistics handoff.
 *
 * ── WHAT MAKES IT A HANDOFF AND NOT A STATUS ─────────────────────────────
 *
 * "Ready for freight" is an OPERATOR DECISION. Nothing here inspects whether
 * every packaging tier is costed: a person looked at the packaging and judged
 * it ready, and what is recorded is that they did, and when. Deriving it from
 * populated fields would be a different claim -- that the data looks finished
 * -- which is not the same thing and is not anyone's decision.
 *
 * ── OWNERSHIP MOVES; THE QUOTE DOES NOT ──────────────────────────────────
 *
 * The freight task belongs to the CONFIGURED logistics recipient, snapshotted
 * at request time so a later settings edit cannot move work out from under the
 * person holding it. `quotes.created_by_user_id` is neither read nor written
 * anywhere in this file. Logistics is a notified participant; the quote keeps
 * its owner.
 *
 * ── THE NOTIFICATION IS NOT THE HANDOFF ──────────────────────────────────
 *
 * The task is created whether or not Slack accepts the message, and the
 * delivery outcome is recorded as what it was. A handoff that exists only if a
 * third-party API answered is a handoff that silently does not exist when it
 * does not -- and the operator who clicked would have no way to tell.
 */

export type FreightHandoffState = {
  handoffId: string;
  quoteId: string;
  status: "open" | "completed" | "withdrawn";
  assignedToUserId: string;
  assignedToEmail: string | null;
  requestedAt: Date;
  notificationStatus: "pending" | "delivered" | "failed" | "not_configured";
  notificationError: string | null;
};

/**
 * The latest handoff on a quote, whatever became of it. What the Packaging and
 * Freight modules render their completion state from.
 */
export type LatestFreightHandoff = FreightHandoffState & {
  completedAt: Date | null;
  completedByEmail: string | null;
  /**
   * Set when the QUOTE side marked Packaging incomplete after logistics had
   * finished. The freight completion still stands; this says Packaging is no
   * longer claiming to be finished, which is a thing the status alone cannot
   * express.
   */
  packagingReopenedAt: Date | null;
};

async function loadRecipient(): Promise<{ userId: string; email: string | null }> {
  const [settings] = await db
    .select({ recipient: firmSettings.logisticsRecipientUserId })
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);

  if (!settings?.recipient) {
    // Refused, not guessed. Inferring the recipient from whoever holds the
    // `logistics` role would make a role assignment into a work assignment,
    // and the person it landed on would never have been told they were the
    // one. Configuring it is a decision; someone has to make it.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "No logistics recipient is configured, so there is nobody to hand this to. " +
        "An admin sets one in firm settings.",
    );
  }

  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, settings.recipient))
    .limit(1);
  if (!u) {
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "The configured logistics recipient is not a current user. An admin needs " +
        "to set one that is.",
    );
  }
  return { userId: u.id, email: u.email };
}

/** The open handoff for a quote, if there is one. */
export async function getFreightHandoff(
  quoteId: string,
): Promise<ActionResult<FreightHandoffState | null>> {
  return runAction(async () => {
    await ensureUser();
    const [row] = await db
      .select()
      .from(freightHandoffs)
      .where(and(eq(freightHandoffs.quoteId, quoteId), eq(freightHandoffs.status, "open")))
      .limit(1);
    if (!row) return null;
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.assignedToUserId))
      .limit(1);
    return {
      handoffId: row.id,
      quoteId: row.quoteId,
      status: row.status as FreightHandoffState["status"],
      assignedToUserId: row.assignedToUserId,
      assignedToEmail: u?.email ?? null,
      requestedAt: row.requestedAt,
      notificationStatus:
        row.notificationStatus as FreightHandoffState["notificationStatus"],
      notificationError: row.notificationError,
    };
  });
}

/**
 * The LATEST handoff for a quote whatever its status, which is what the two
 * modules render from.
 *
 * `getFreightHandoff` above returns the OPEN one and is deliberately left
 * alone: it is what `markReadyForFreight` reads back on a double-click, and
 * it must keep meaning "the request that is live right now".
 *
 * The modules need more than that. A handoff that logistics has COMPLETED is
 * gone from the open read, so a surface built on it would show Packaging as
 * not-complete the moment Freight finished -- reporting that the work had
 * never been handed over because it had been handed over and finished. The
 * closed row is the evidence of both, so it is read.
 *
 * A `withdrawn` row is not evidence of either: withdrawing IS reopening
 * packaging, and the modules read it as the un-completed state it is.
 */
export async function getLatestFreightHandoff(
  quoteId: string,
): Promise<ActionResult<LatestFreightHandoff | null>> {
  return runAction(async () => {
    await ensureUser();
    const [row] = await db
      .select()
      .from(freightHandoffs)
      .where(eq(freightHandoffs.quoteId, quoteId))
      .orderBy(desc(freightHandoffs.requestedAt))
      .limit(1);
    if (!row) return null;

    const ids = [row.assignedToUserId, row.completedByUserId].filter(
      (id): id is string => Boolean(id),
    );
    const people = ids.length
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    const emailOf = (id: string | null) =>
      id ? people.find((p) => p.id === id)?.email ?? null : null;

    return {
      handoffId: row.id,
      quoteId: row.quoteId,
      status: row.status as LatestFreightHandoff["status"],
      assignedToUserId: row.assignedToUserId,
      assignedToEmail: emailOf(row.assignedToUserId),
      requestedAt: row.requestedAt,
      completedAt: row.completedAt,
      completedByEmail: emailOf(row.completedByUserId),
      packagingReopenedAt: row.packagingReopenedAt,
      notificationStatus:
        row.notificationStatus as LatestFreightHandoff["notificationStatus"],
      notificationError: row.notificationError,
    };
  });
}

/**
 * Mark packaging ready and hand the freight work to logistics.
 *
 * Clicking it twice does nothing the second time. The partial unique index
 * permits one open handoff per quote, so the second insert cannot land -- and
 * because the insert is what triggers the notification, there is no second
 * message either. Enforced by the database rather than by a read-then-write in
 * here, which two clicks can interleave through.
 */
export async function markReadyForFreight(
  formData: FormData,
): Promise<ActionResult<FreightHandoffState>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    if (!quoteId) throw new ActionGuardError(ERR.VALIDATION, "quoteId is required.");

    // The SAME permission that governs editing this quote. The Costs surface
    // hides the control on a non-draft quote; the action has to enforce it,
    // because a hidden control is not an absent endpoint.
    await quoteByIdDraft(quoteId);

    const recipient = await loadRecipient();

    const inserted = await db
      .insert(freightHandoffs)
      .values({
        quoteId,
        requestedByUserId: user.id,
        assignedToUserId: recipient.userId,
        status: "open",
        notificationStatus: "pending",
      })
      // The second click of a double-click. Nothing is created and nothing is
      // sent; the existing handoff is returned as-is.
      .onConflictDoNothing()
      .returning({ id: freightHandoffs.id, requestedAt: freightHandoffs.requestedAt });

    if (inserted.length === 0) {
      const existing = await getFreightHandoff(quoteId);
      if (existing.ok && existing.data) return existing.data;
      throw new ActionGuardError(
        ERR.DATA_INTEGRITY,
        "This quote already has an open freight request that could not be read back.",
      );
    }

    const handoffId = inserted[0].id;

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "freight_requested",
      diffJson: {
        handoff_id: handoffId,
        assigned_to_user_id: recipient.userId,
        assigned_to_email: recipient.email,
        basis: "operator marked packaging ready for freight",
      },
    });

    // Delivery is attempted AFTER the handoff exists and never gates it.
    const delivery = await deliverFreightHandoff(handoffId);

    revalidatePath("/");
    return {
      handoffId,
      quoteId,
      status: "open" as const,
      assignedToUserId: recipient.userId,
      assignedToEmail: recipient.email,
      requestedAt: inserted[0].requestedAt,
      notificationStatus: delivery.status,
      notificationError: delivery.error,
    };
  });
}

/**
 * Logistics says the freight work is done.
 *
 * The ONLY thing that completes a handoff. Not the first shipment appearing,
 * not the quote reaching a status -- a shipment is work in progress and a
 * status is someone else's milestone. Neither is logistics saying they have
 * finished, and treating either as the finish would close a task on the
 * holder's behalf.
 */
export async function completeFreightHandoff(
  formData: FormData,
): Promise<ActionResult<{ handoffId: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const handoffId = String(formData.get("handoffId") ?? "").trim();
    if (!handoffId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "handoffId is required: a completion has to name the handoff it closes.",
      );
    }

    // Deliberately NOT draft-gated. Freight work continues after a quote is
    // sent, so requiring draft here would make the task uncompletable in
    // exactly the state it is most often worked in.
    const [handoff] = await db
      .select()
      .from(freightHandoffs)
      .where(eq(freightHandoffs.id, handoffId))
      .limit(1);
    if (!handoff) {
      throw new ActionGuardError(ERR.NOT_FOUND, "That freight request no longer exists.");
    }

    // The holder, or an admin. The strip hides the control from everyone else;
    // that is an affordance, and this is the boundary.
    if (handoff.assignedToUserId !== user.id && user.role !== "admin") {
      throw new ActionGuardError(
        ERR.FORBIDDEN,
        "This freight request belongs to someone else. Only the person it was " +
          "assigned to can mark it complete.",
      );
    }

    const closed = await db
      .update(freightHandoffs)
      .set({
        status: "completed",
        completedByUserId: user.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      // Conditioned on THIS handoff being the open one. A screen opened before
      // a withdraw-and-re-request holds the OLD id, and closing "whatever is
      // open on this quote" would let it complete a request it never saw.
      .where(and(eq(freightHandoffs.id, handoffId), eq(freightHandoffs.status, "open")))
      .returning({ id: freightHandoffs.id });

    if (closed.length === 0) {
      throw new ActionGuardError(
        ERR.STALE_WRITE,
        "This freight request is no longer open — it was completed or withdrawn " +
          "elsewhere, and may have been replaced by a newer one. Reload before acting.",
      );
    }
    const quoteId = handoff.quoteId;

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "freight_completed",
      diffJson: { handoff_id: closed[0].id, basis: "logistics marked freight complete" },
    });

    revalidatePath("/");
    return { handoffId: closed[0].id };
  });
}

/**
 * Mark Packaging incomplete.
 *
 * ── ONE ACTION, TWO CASES, DECIDED ON THE SERVER ─────────────────────────
 *
 * What "incomplete" means for Packaging depends on what happened to the
 * request it made, and the screen asking may be looking at an older answer
 * than the database has. So the branch is taken HERE, from the row as it
 * actually is, and each update is conditioned on the state it was chosen for:
 *
 *   open       logistics still has it — the request is WITHDRAWN. The row is
 *              kept and marked withdrawn rather than deleted: what was asked
 *              for, by whom, and that it was called off is the history, and a
 *              re-request later is a NEW handoff rather than a revival of this
 *              one. That is also why the unique index is on `status = 'open'`
 *              and not on the quote.
 *
 *   completed  logistics FINISHED it. That really happened, so the row is not
 *              touched — its status, its completer and its completion time all
 *              stand. Only the packaging end is pulled back. Marking Packaging
 *              complete again then inserts a fresh handoff, which notifies
 *              logistics through the same path as the first one.
 *
 * Deciding this on the client would let a screen opened before logistics
 * finished send "withdraw" against a completed handoff — which the WHERE
 * clause would refuse, correctly, but as a confusing failure rather than as
 * the reopen the operator actually asked for.
 */
export async function markPackagingIncomplete(
  formData: FormData,
): Promise<ActionResult<{ handoffId: string; outcome: "withdrawn" | "packaging_reopened" }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const handoffId = String(formData.get("handoffId") ?? "").trim();
    if (!handoffId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "handoffId is required: marking Packaging incomplete has to name the " +
          "handoff it pulls back.",
      );
    }

    const [handoff] = await db
      .select()
      .from(freightHandoffs)
      .where(eq(freightHandoffs.id, handoffId))
      .limit(1);
    if (!handoff) {
      throw new ActionGuardError(ERR.NOT_FOUND, "That freight request no longer exists.");
    }

    // UNCHANGED PERMISSION. Marking Packaging incomplete is the quote side
    // taking its own claim back, so it carries the quote's edit permission —
    // the same one that governs making the claim, and the same one withdrawing
    // has always carried.
    await quoteByIdDraft(handoff.quoteId);

    if (handoff.status === "open") {
      const pulled = await db
        .update(freightHandoffs)
        .set({
          status: "withdrawn",
          withdrawnByUserId: user.id,
          withdrawnAt: new Date(),
          updatedAt: new Date(),
        })
        // Conditioned on THIS handoff still being open: a stale screen must
        // not withdraw the request that replaced the one it is showing, and
        // must not withdraw one logistics completed while it was open.
        .where(and(eq(freightHandoffs.id, handoffId), eq(freightHandoffs.status, "open")))
        .returning({ id: freightHandoffs.id });

      if (pulled.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This freight request is no longer open — it was completed or withdrawn " +
            "elsewhere, and may have been replaced by a newer one. Reload before acting.",
        );
      }

      await writeAuditEntry({
        userId: user.id,
        entityType: "quote",
        entityId: handoff.quoteId,
        action: "freight_request_withdrawn",
        diffJson: { handoff_id: pulled[0].id, basis: "packaging reopened" },
      });

      revalidatePath("/");
      return { handoffId: pulled[0].id, outcome: "withdrawn" as const };
    }

    if (handoff.status === "completed") {
      const reopened = await db
        .update(freightHandoffs)
        .set({
          packagingReopenedByUserId: user.id,
          packagingReopenedAt: new Date(),
          updatedAt: new Date(),
        })
        // `status` is deliberately NOT in the SET list: the freight work was
        // finished, and saying otherwise would rewrite someone else's completed
        // task. The IS NULL keeps a double-click to one record of who pulled it
        // back and when.
        .where(
          and(
            eq(freightHandoffs.id, handoffId),
            eq(freightHandoffs.status, "completed"),
            isNull(freightHandoffs.packagingReopenedAt),
          ),
        )
        .returning({ id: freightHandoffs.id });

      if (reopened.length === 0) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "Packaging has already been marked incomplete on this handoff, or the " +
            "handoff changed elsewhere. Reload before acting.",
        );
      }

      await writeAuditEntry({
        userId: user.id,
        entityType: "quote",
        entityId: handoff.quoteId,
        action: "packaging_reopened",
        diffJson: {
          handoff_id: reopened[0].id,
          // The completion this does NOT undo, named so the timeline shows
          // both facts standing together.
          freight_completed_at: handoff.completedAt?.toISOString() ?? null,
          freight_completed_by_user_id: handoff.completedByUserId,
          basis: "operator marked packaging incomplete after freight completed",
        },
      });

      revalidatePath("/");
      return { handoffId: reopened[0].id, outcome: "packaging_reopened" as const };
    }

    throw new ActionGuardError(
      ERR.STALE_WRITE,
      "This freight request was already withdrawn, so Packaging is not marked " +
        "complete. Reload before acting.",
    );
  });
}

/**
 * Logistics reopens the freight task it had marked complete.
 *
 * The row goes back to `open` and is the live request again. `completedAt` and
 * `completedByUserId` are CLEARED as it does: an open row still carrying a
 * completion would read as both at once, and the next completion would
 * overwrite the value anyway. The completion is not lost — `audit_log` keeps
 * the `freight_completed` entry that recorded it, and the `freight_reopened`
 * entry written here names exactly what it undid.
 *
 * ── SAME PERMISSION AS COMPLETING IT ─────────────────────────────────────
 *
 * The assignee, or an admin. Unchanged from `completeFreightHandoff`, and not
 * draft-gated for the same reason: freight work continues after a quote is
 * sent, and gating it on draft would make the task unreopenable in the state
 * it is most often worked in.
 */
export async function markFreightIncomplete(
  formData: FormData,
): Promise<ActionResult<{ handoffId: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const handoffId = String(formData.get("handoffId") ?? "").trim();
    if (!handoffId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "handoffId is required: a reopen has to name the handoff it reopens.",
      );
    }

    const [handoff] = await db
      .select()
      .from(freightHandoffs)
      .where(eq(freightHandoffs.id, handoffId))
      .limit(1);
    if (!handoff) {
      throw new ActionGuardError(ERR.NOT_FOUND, "That freight request no longer exists.");
    }

    if (handoff.assignedToUserId !== user.id && user.role !== "admin") {
      throw new ActionGuardError(
        ERR.FORBIDDEN,
        "This freight request belongs to someone else. Only the person it was " +
          "assigned to can reopen it.",
      );
    }

    let reopened: { id: string }[];
    try {
      reopened = await db
        .update(freightHandoffs)
        .set({
          status: "open",
          reopenedByUserId: user.id,
          reopenedAt: new Date(),
          completedByUserId: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(freightHandoffs.id, handoffId),
            eq(freightHandoffs.status, "completed"),
            // Refused once the quote side has pulled its request back: the task
            // belonged to a request that is no longer being made, and reopening
            // it would resurrect a handoff Packaging has already replaced, or
            // is about to.
            isNull(freightHandoffs.packagingReopenedAt),
          ),
        )
        .returning({ id: freightHandoffs.id });
    } catch (error) {
      // The partial unique index permits one OPEN handoff per quote. Returning
      // a row to `open` while another is open is refused by the database, and
      // is reported as the ordinary conflict it is rather than as a crash.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new ActionGuardError(
          ERR.STALE_WRITE,
          "This quote already has a newer open freight request, so the finished " +
            "one cannot be reopened. Reload before acting.",
        );
      }
      throw error;
    }

    if (reopened.length === 0) {
      throw new ActionGuardError(
        ERR.STALE_WRITE,
        "This freight request is not a completed one any more — it was reopened " +
          "elsewhere, or Packaging was marked incomplete. Reload before acting.",
      );
    }

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: handoff.quoteId,
      action: "freight_reopened",
      diffJson: {
        handoff_id: reopened[0].id,
        // What was undone, kept where the history lives.
        undone_completed_at: handoff.completedAt?.toISOString() ?? null,
        undone_completed_by_user_id: handoff.completedByUserId,
        basis: "logistics reopened the freight task",
      },
    });

    revalidatePath("/");
    return { handoffId: reopened[0].id };
  });
}

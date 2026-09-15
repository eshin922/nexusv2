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
 * Pull the request back because packaging reopened.
 *
 * The row is kept and marked withdrawn rather than deleted: what was asked
 * for, by whom, and that it was called off is the history, and a re-request
 * later is a NEW handoff rather than a revival of this one. That is also why
 * the unique index is on `status = 'open'` and not on the quote.
 */
export async function withdrawFreightRequest(
  formData: FormData,
): Promise<ActionResult<{ handoffId: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const handoffId = String(formData.get("handoffId") ?? "").trim();
    if (!handoffId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "handoffId is required: a withdrawal has to name the handoff it pulls back.",
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

    // Withdrawing is the quote side taking its request back, so it carries the
    // quote's own edit permission — the same one that governs asking.
    await quoteByIdDraft(handoff.quoteId);

    const pulled = await db
      .update(freightHandoffs)
      .set({
        status: "withdrawn",
        withdrawnByUserId: user.id,
        withdrawnAt: new Date(),
        updatedAt: new Date(),
      })
      // Conditioned on THIS handoff, for the same reason completion is: a
      // stale screen must not withdraw the request that replaced the one it
      // is showing.
      .where(and(eq(freightHandoffs.id, handoffId), eq(freightHandoffs.status, "open")))
      .returning({ id: freightHandoffs.id });

    if (pulled.length === 0) {
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
      action: "freight_request_withdrawn",
      diffJson: { handoff_id: pulled[0].id, basis: "packaging reopened" },
    });

    revalidatePath("/");
    return { handoffId: pulled[0].id };
  });
}

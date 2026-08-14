// Delivery of an approval request to the governed Slack channel, and re-sync of
// the message after a decision.
//
// DELIVERY IS A PROJECTION. Nothing in this file may create, satisfy or imply
// authorization. Every failure path returns false or logs and continues; the
// request stays in whatever governed state it was already in.

import "server-only";

import { desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  belowFloorApprovalRequests,
  firmSettings,
  projects,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { loadSlackConfig, postMessage, updateMessage } from "./client";
import {
  approvalFallbackText,
  buildApprovalBlocks,
  buildDecidedBlocks,
  type ApprovalMessageContext,
} from "./approval-message";

function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base}${path}`;
}

/** Everything the message needs, assembled from governed rows. */
async function loadContext(requestId: string): Promise<
  | { ok: true; context: ApprovalMessageContext; channelId: string | null; request: typeof belowFloorApprovalRequests.$inferSelect }
  | { ok: false }
> {
  const [row] = await db
    .select({
      request: belowFloorApprovalRequests,
      quoteNumber: quotes.quoteNumber,
      scenarioLabel: quotes.scenarioLabel,
      projectId: quotes.projectId,
      dealName: projects.dealName,
      clientName: projects.clientName,
      tierLabel: quoteTiers.label,
      tierQty: quoteTiers.qty,
      requesterName: users.name,
      requesterEmail: users.email,
    })
    .from(belowFloorApprovalRequests)
    .innerJoin(quotes, eq(quotes.id, belowFloorApprovalRequests.quoteId))
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .innerJoin(quoteTiers, eq(quoteTiers.id, belowFloorApprovalRequests.tierId))
    .innerJoin(users, eq(users.id, belowFloorApprovalRequests.requestedByUserId))
    .where(eq(belowFloorApprovalRequests.id, requestId))
    .limit(1);
  if (!row) return { ok: false };

  const [firm] = await db
    .select({ slackApprovalChannelId: firmSettings.slackApprovalChannelId })
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);

  return {
    ok: true,
    channelId: firm?.slackApprovalChannelId ?? null,
    request: row.request,
    context: {
      requestId: row.request.id,
      customerName: row.clientName ?? row.dealName,
      dealName: row.dealName,
      quoteNumber: row.quoteNumber,
      scenarioLabel: row.scenarioLabel ?? "—",
      tierLabel: row.tierLabel,
      tierQty: row.tierQty,
      marginPct: Number(row.request.marginAtRequest),
      floorPct: Number(row.request.floorAtRequest),
      // Revenue is not stored on the request; the reviewer needs magnitude, and
      // margin × floor already carry the decision. Derived from the tier's
      // recorded qty only as a scale hint.
      tierRevenue: 0,
      requesterName: row.requesterName ?? row.requesterEmail,
      justification: row.request.justification,
      nexusUrl: appUrl(`/projects/${row.projectId}/quotes/${row.request.quoteId}/pricing`),
    },
  };
}

/**
 * Post a pending request. Returns whether Slack accepted it.
 *
 * Unconfigured token or channel is a DELIVERY failure, recorded as such — not
 * an error that unwinds the governed request, and not a silent success.
 */
export async function deliverBelowFloorRequest(requestId: string): Promise<boolean> {
  const loaded = await loadContext(requestId);
  if (!loaded.ok) return false;

  const config = loadSlackConfig();
  const fail = async (reason: string) => {
    await db
      .update(belowFloorApprovalRequests)
      .set({ deliveryStatus: "failed", deliveryError: reason, updatedAt: new Date() })
      .where(eq(belowFloorApprovalRequests.id, requestId));
    return false;
  };

  if (!config) return fail("SLACK_BOT_TOKEN is not configured.");
  if (!loaded.channelId) {
    return fail("No Slack approval channel is configured in firm settings.");
  }

  try {
    const posted = await postMessage(
      {
        channel: loaded.channelId,
        text: approvalFallbackText(loaded.context),
        blocks: buildApprovalBlocks(loaded.context),
      },
      config,
    );
    await db
      .update(belowFloorApprovalRequests)
      .set({
        slackChannelId: posted.channel,
        slackMessageTs: posted.ts,
        deliveryStatus: "delivered",
        deliveryError: null,
        updatedAt: new Date(),
      })
      .where(eq(belowFloorApprovalRequests.id, requestId));
    return true;
  } catch (e) {
    return fail((e as Error).message.slice(0, 400));
  }
}

/**
 * Re-render a decided or superseded request so it stops looking actionable.
 *
 * Best-effort BY DESIGN. If Slack refuses, the decision still stands: Nexus is
 * authoritative and the message is merely stale. Throwing here would unwind a
 * governed decision because a chat surface was unavailable.
 */
export async function syncDecidedMessage(requestId: string): Promise<void> {
  const loaded = await loadContext(requestId);
  if (!loaded.ok) return;
  const { request } = loaded;
  if (!request.slackChannelId || !request.slackMessageTs) return;

  const config = loadSlackConfig();
  if (!config) return;

  const status = request.status as "approved" | "rejected" | "superseded" | "cancelled";
  let reviewerName: string | null = null;
  if (request.decidedByUserId) {
    const [reviewer] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, request.decidedByUserId))
      .limit(1);
    reviewerName = reviewer?.name ?? reviewer?.email ?? null;
  }

  try {
    await updateMessage(
      {
        channel: request.slackChannelId,
        ts: request.slackMessageTs,
        text: `Below-floor approval — ${status}`,
        blocks: buildDecidedBlocks({
          context: loaded.context,
          status,
          reviewerName,
          decidedAt: request.decidedAt,
          reason: request.decisionReason,
        }),
      },
      config,
    );
  } catch (e) {
    console.error(
      `[slack] chat.update failed for request ${requestId}; Nexus state stands: ${(e as Error).message}`,
    );
  }
}

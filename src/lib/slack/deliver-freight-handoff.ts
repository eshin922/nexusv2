import "server-only";
import { eq } from "drizzle-orm";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { firmSettings, freightHandoffs, projects, quotes, users } from "@/db/schema";
import { loadSlackConfig, postMessage } from "./client";
import { slackLink } from "./app-url";

/**
 * Tell the logistics channel that packaging is ready.
 *
 * ── THE NOTIFICATION NEVER DECIDES WHETHER THE HANDOFF EXISTS ────────────
 *
 * This runs after the handoff row is committed and returns an outcome rather
 * than throwing. Every failure resolves to a recorded state -- `failed` with
 * the reason, or `not_configured` when there is no token or no channel -- and
 * the task in Nexus stands either way.
 *
 * The three states are kept apart on purpose. "Slack refused it",
 * "Slack was never set up", and "it was delivered" are different facts, and an
 * operator deciding whether to go and find Cally in person needs to know which
 * one happened.
 */
export type FreightDeliveryOutcome = {
  status: "delivered" | "failed" | "not_configured";
  error: string | null;
};

async function record(
  handoffId: string,
  outcome: FreightDeliveryOutcome,
  posted?: { channel: string; ts: string },
): Promise<FreightDeliveryOutcome> {
  await db
    .update(freightHandoffs)
    .set({
      notificationStatus: outcome.status,
      notificationError: outcome.error,
      slackChannelId: posted?.channel ?? null,
      slackMessageTs: posted?.ts ?? null,
      updatedAt: new Date(),
    })
    .where(eq(freightHandoffs.id, handoffId));
  return outcome;
}

export async function deliverFreightHandoff(
  handoffId: string,
): Promise<FreightDeliveryOutcome> {
  const [row] = await db
    .select({
      id: freightHandoffs.id,
      quoteId: freightHandoffs.quoteId,
      assignedToUserId: freightHandoffs.assignedToUserId,
      requestedByUserId: freightHandoffs.requestedByUserId,
    })
    .from(freightHandoffs)
    .where(eq(freightHandoffs.id, handoffId))
    .limit(1);
  if (!row) {
    return { status: "failed", error: "The handoff row could not be read back." };
  }

  const config = loadSlackConfig();
  if (!config) {
    return record(handoffId, {
      status: "not_configured",
      error: "SLACK_BOT_TOKEN is not configured.",
    });
  }

  const [settings] = await db
    .select({ channel: firmSettings.slackLogisticsChannelId })
    .from(firmSettings)
    .where(isNull(firmSettings.effectiveUntil))
    .orderBy(desc(firmSettings.effectiveFrom))
    .limit(1);
  if (!settings?.channel) {
    // Deliberately NOT falling back to the approval channel. That channel has
    // a different audience, and freight requests landing among approvals is
    // both noise there and an invisible handoff here.
    return record(handoffId, {
      status: "not_configured",
      error: "No logistics Slack channel is configured in firm settings.",
    });
  }

  const [ctx] = await db
    .select({
      scenarioLabel: quotes.scenarioLabel,
      projectId: quotes.projectId,
      dealName: projects.dealName,
      clientName: projects.clientName,
    })
    .from(quotes)
    .innerJoin(projects, eq(projects.id, quotes.projectId))
    .where(eq(quotes.id, row.quoteId))
    .limit(1);

  const [requester] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.requestedByUserId))
    .limit(1);

  // The production origin, always — see `./app-url`. Read from the environment
  // this sent two notifications carrying `http://localhost:3000` links, which
  // arrived looking correct and went nowhere.
  const href = slackLink(`/projects/${ctx?.projectId ?? ""}/quotes/${row.quoteId}/costs`);

  const headline = `Packaging ready — freight needed`;
  const deal = ctx?.dealName ?? "a quote";
  const customer = ctx?.clientName ? ` · ${ctx.clientName}` : "";
  const scenario = ctx?.scenarioLabel ? ` · ${ctx.scenarioLabel}` : "";

  try {
    const posted = await postMessage(
      {
        channel: settings.channel,
        // The fallback text is what a notification preview shows, so it says
        // the whole thing rather than teasing it.
        text: `${headline} — ${deal}${customer}${scenario}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${headline}*\n${deal}${customer}${scenario}` },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Marked ready by ${requester?.email ?? "a PM"}. It is also in your Needs you list.`,
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open freight" },
                url: href,
              },
            ],
          },
        ],
      },
      config,
    );
    return record(handoffId, { status: "delivered", error: null }, posted);
  } catch (e) {
    return record(handoffId, {
      status: "failed",
      error: (e as Error).message.slice(0, 400),
    });
  }
}

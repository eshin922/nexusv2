/**
 * Slack interactivity callback — Approve / Reject for below-floor requests.
 *
 * THIS ROUTE IS PUBLIC. Slack carries no Clerk session, so it is on the
 * `isPublicRoute` allowlist and its authentication is Slack request signing,
 * nothing else. Every early return below exists because this endpoint is
 * reachable from the open internet.
 *
 * The route establishes IDENTITY and delegates every DECISION:
 *   signature → Slack user id → durable binding → governed Nexus user
 *   → `decideBelowFloorApproval`, which re-reads authority itself.
 *
 * Slack decides nothing. It is an interaction surface over a Nexus decision.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { decideBelowFloorApproval } from "@/app/actions/below-floor-approval-request";
import { resolveSlackIdentity } from "@/lib/below-floor-approval-request";
import { verifySlackSignature } from "@/lib/slack/signature";
import { loadSlackConfig, lookupUser, openView } from "@/lib/slack/client";
import {
  APPROVE_ACTION_ID,
  REJECT_ACTION_ID,
  REASON_VIEW_CALLBACK_ID,
  buildReasonView,
} from "@/lib/slack/approval-message";
import { syncDecidedMessage } from "@/lib/slack/deliver-approval";

export const runtime = "nodejs";

/** Ephemeral, visible only to the reviewer who acted. */
function ephemeral(text: string) {
  return Response.json({ response_type: "ephemeral", replace_original: false, text });
}

export async function POST(req: Request): Promise<Response> {
  // 1 · RAW BODY FIRST. Parsing and re-serialising changes byte order and the
  //     signature will not match — the body must be verified as sent.
  const rawBody = await req.text();

  const verdict = verifySlackSignature({
    rawBody,
    timestampHeader: req.headers.get("x-slack-request-timestamp"),
    signatureHeader: req.headers.get("x-slack-signature"),
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });
  // 2 · REJECT BEFORE PARSING. Nothing is read from the database and nothing is
  //     written for a request that has not proven it came from Slack.
  if (!verdict.ok) {
    return new Response("unauthorized", { status: 401 });
  }

  // 3 · Only now is the payload trustworthy enough to parse.
  const form = new URLSearchParams(rawBody);
  const payloadRaw = form.get("payload");
  if (!payloadRaw) return new Response("bad request", { status: 400 });

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadRaw) as SlackInteractionPayload;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const slackUserId = payload.user?.id;
  if (!slackUserId) return new Response("bad request", { status: 400 });

  if (payload.type === "block_actions") return handleButton(payload, slackUserId);
  if (payload.type === "view_submission") return handleSubmit(payload, slackUserId);
  // Anything else is not part of this integration; acknowledge and ignore.
  return new Response(null, { status: 200 });
}

/**
 * Button press → open the reason modal.
 *
 * No decision is taken here. Identity is resolved first so an unmapped or
 * conflicted Slack account is told immediately rather than after typing a
 * reason into a modal that was never going to be accepted.
 */
async function handleButton(
  payload: SlackInteractionPayload,
  slackUserId: string,
): Promise<Response> {
  const action = payload.actions?.[0];
  if (!action) return new Response(null, { status: 200 });

  const decision =
    action.action_id === APPROVE_ACTION_ID
      ? "approve"
      : action.action_id === REJECT_ACTION_ID
        ? "reject"
        : null;
  if (!decision) return new Response(null, { status: 200 }); // e.g. the URL button

  const identity = await resolveActor(slackUserId);
  if (!identity.ok) return ephemeral(identity.message);

  const config = loadSlackConfig();
  if (!config || !payload.trigger_id) {
    return ephemeral("Slack is not fully configured for approvals in this environment.");
  }

  try {
    await openView(
      {
        triggerId: payload.trigger_id,
        view: buildReasonView({
          requestId: action.value ?? "",
          action: decision,
          prefill: null,
        }),
      },
      config,
    );
  } catch {
    return ephemeral("Could not open the decision dialog. Please try again.");
  }
  // Must answer within Slack's 3-second window.
  return new Response(null, { status: 200 });
}

/** Modal submitted → take the governed decision. */
async function handleSubmit(
  payload: SlackInteractionPayload,
  slackUserId: string,
): Promise<Response> {
  if (payload.view?.callback_id !== REASON_VIEW_CALLBACK_ID) {
    return new Response(null, { status: 200 });
  }

  let meta: { requestId: string; action: "approve" | "reject" };
  try {
    meta = JSON.parse(payload.view.private_metadata ?? "{}");
  } catch {
    return new Response(null, { status: 200 });
  }
  if (!meta.requestId) return new Response(null, { status: 200 });

  const identity = await resolveActor(slackUserId);
  if (!identity.ok) {
    return Response.json({
      response_action: "errors",
      errors: { reason_block: identity.message },
    });
  }

  const reason =
    payload.view.state?.values?.reason_block?.reason_input?.value ?? null;

  const outcome = await decideBelowFloorApproval({
    requestId: meta.requestId,
    action: meta.action,
    reason,
    actorUserId: identity.userId,
    // Provenance only. Authority came from the binding resolution above.
    actingSlackUserId: slackUserId,
  });

  if (outcome.kind === "refused") {
    return Response.json({
      response_action: "errors",
      errors: { reason_block: outcome.message },
    });
  }

  // Decided, superseded, or a duplicate that changed nothing — in every case
  // re-sync the message so it stops presenting itself as actionable. A failure
  // here does not unwind the decision.
  await syncDecidedMessage(meta.requestId);
  return new Response(null, { status: 200 });
}

/**
 * Slack actor → governed Nexus user, binding first.
 *
 * The email lookup happens ONLY for an unbound Slack account, and the resulting
 * binding is persisted so it is never repeated. Every disagreement fails closed
 * — see `resolveSlackIdentity`.
 */
async function resolveActor(
  slackUserId: string,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const [bound] = await db
    .select({ id: users.id, slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.slackUserId, slackUserId))
    .limit(1);

  let emailUser: { id: string; slackUserId: string | null } | null = null;
  const config = loadSlackConfig();
  if (config) {
    try {
      const slackUser = await lookupUser(slackUserId, config);
      if (slackUser.email) {
        const [byEmail] = await db
          .select({ id: users.id, slackUserId: users.slackUserId })
          .from(users)
          .where(eq(users.email, slackUser.email.toLowerCase()))
          .limit(1);
        emailUser = byEmail ?? null;
      }
    } catch {
      // An unavailable lookup is not evidence about identity. A BOUND account
      // still resolves; an unbound one fails closed below.
      emailUser = null;
    }
  }

  const resolution = resolveSlackIdentity({
    boundUser: bound ?? null,
    emailUser,
  });
  if (!resolution.ok) return { ok: false, message: resolution.message };

  if (resolution.bindNow) {
    await db
      .update(users)
      .set({ slackUserId })
      .where(eq(users.id, resolution.userId));
  }
  return { ok: true, userId: resolution.userId };
}

// Only the fields this route reads.
interface SlackInteractionPayload {
  type?: string;
  trigger_id?: string;
  user?: { id?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { value?: string | null }>>;
    };
  };
}

// Minimal Slack Web API client — exactly the four calls V1 approvals need.
//
// No SDK. `@slack/web-api` carries a large surface for four endpoints, and the
// scope discipline agreed for this integration is easier to hold when the
// call sites are visible.
//
// Scopes this file requires, and no more:
//   chat:write        postApprovalMessage · updateMessage
//   users:read        lookupUser
//   users:read.email  lookupUser (the email is the identity bootstrap)
//
// `views.open` needs no scope beyond the bot token when responding to an
// interaction's `trigger_id`.

import "server-only";

const SLACK_API = "https://slack.com/api";

export interface SlackConfig {
  botToken: string;
}

/**
 * Reads the bot token. Absent ⇒ null, and every caller treats that as
 * "delivery unavailable" rather than throwing: a missing token must degrade to
 * an undelivered request, never to an authorization.
 */
export function loadSlackConfig(): SlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return null;
  return { botToken };
}

async function slackPost<T>(
  method: string,
  body: unknown,
  config: SlackConfig,
): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  // Slack answers 200 with `ok:false` for application errors, so HTTP status
  // alone never establishes success.
  return (await res.json()) as T & { ok: boolean; error?: string };
}

export interface PostedMessage {
  channel: string;
  ts: string;
}

export async function postMessage(
  args: { channel: string; text: string; blocks: unknown[] },
  config: SlackConfig,
): Promise<PostedMessage> {
  const res = await slackPost<{ channel?: string; ts?: string }>(
    "chat.postMessage",
    args,
    config,
  );
  if (!res.ok || !res.ts || !res.channel) {
    throw new Error(`slack chat.postMessage failed: ${res.error ?? "unknown"}`);
  }
  return { channel: res.channel, ts: res.ts };
}

/**
 * Re-render a decided request.
 *
 * A PROJECTION. If this fails the decision still stands — Nexus is
 * authoritative and the message is merely stale, so callers log and continue
 * rather than unwinding a governed decision because a chat surface refused.
 */
export async function updateMessage(
  args: { channel: string; ts: string; text: string; blocks: unknown[] },
  config: SlackConfig,
): Promise<void> {
  const res = await slackPost<Record<string, never>>(
    "chat.update",
    { channel: args.channel, ts: args.ts, text: args.text, blocks: args.blocks },
    config,
  );
  if (!res.ok) {
    throw new Error(`slack chat.update failed: ${res.error ?? "unknown"}`);
  }
}

export async function openView(
  args: { triggerId: string; view: unknown },
  config: SlackConfig,
): Promise<void> {
  const res = await slackPost<Record<string, never>>(
    "views.open",
    { trigger_id: args.triggerId, view: args.view },
    config,
  );
  if (!res.ok) {
    throw new Error(`slack views.open failed: ${res.error ?? "unknown"}`);
  }
}

export interface SlackUser {
  id: string;
  email: string | null;
}

/**
 * The identity bootstrap, and only that.
 *
 * The email is used ONCE, to establish a durable binding for a Slack account
 * Nexus has not seen before. Afterwards `users.slack_user_id` decides and this
 * call is not consulted — see `resolveSlackIdentity`.
 */
export async function lookupUser(
  slackUserId: string,
  config: SlackConfig,
): Promise<SlackUser> {
  const res = await slackPost<{
    user?: { id: string; profile?: { email?: string } };
  }>("users.info", { user: slackUserId }, config);
  if (!res.ok || !res.user) {
    throw new Error(`slack users.info failed: ${res.error ?? "unknown"}`);
  }
  return { id: res.user.id, email: res.user.profile?.email ?? null };
}

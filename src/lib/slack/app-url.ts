import "server-only";

/**
 * The origin every Slack link points at.
 *
 * ── WHY THIS IS A CONSTANT AND NOT AN ENVIRONMENT VARIABLE ───────────────
 *
 * A Slack message goes to the firm's real workspace and asks a real person to
 * go and do something. Wherever the code that sent it happened to be running,
 * the place they have to go is production. So the origin is a property of the
 * DESTINATION, not of the sender's environment — and reading it from the
 * environment made it a property of the sender.
 *
 * That is not hypothetical. Two freight-handoff notifications reached Cally
 * carrying `http://localhost:3000` links, because the delivery ran from a
 * machine whose `.env.local` sets `NEXT_PUBLIC_APP_URL` to localhost. Nothing
 * failed: the message arrived, looked right, and its button went nowhere. The
 * env var had exactly the effect it was configured to have.
 *
 * The approvals sender had a worse version of the same shape — falling back to
 * `VERCEL_URL`, so a preview deployment posting to the real approvals channel
 * would send reviewers to a preview of itself.
 *
 * A configurable origin buys nothing here. There is one production Nexus, and
 * no environment that legitimately sends real Slack messages about a different
 * one: in the isolated harness there is no token, so delivery records
 * `not_configured` and no message is composed at all. Changing domain is a
 * one-line code change, which is both rarer and more visible than an env var
 * nobody remembers is load-bearing.
 */
const SLACK_LINK_ORIGIN = "https://nexus.thedps.co";

/**
 * Absolute URL for a Slack message's link.
 *
 * @param path an app-absolute path, e.g. `/projects/123/quotes/456/costs`
 */
export function slackLink(path: string): string {
  return `${SLACK_LINK_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

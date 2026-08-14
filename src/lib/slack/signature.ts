// Slack request signing — the ENTIRE authentication boundary for the
// interactivity endpoint.
//
// That route sits outside Clerk (Slack carries no session), so nothing else
// stands between the public internet and a governed approval decision. Every
// check here is load-bearing.
//
// Deliberately dependency-free: `node:crypto` only. A signature verifier is the
// last place to take a transitive dependency.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack's own recommendation. Older requests are replays. */
export const REPLAY_WINDOW_SECONDS = 60 * 5;

export type SignatureVerdict =
  | { ok: true }
  | {
      ok: false;
      code: "missing_headers" | "stale_timestamp" | "bad_signature" | "not_configured";
      message: string;
    };

/**
 * Verify that a request genuinely came from Slack.
 *
 * `rawBody` must be the EXACT bytes Slack sent. Parsing first and
 * re-serialising changes key order and whitespace, and the signature will not
 * match — which is why the route reads `await req.text()` and parses only after
 * this returns ok.
 *
 * Fails closed when unconfigured: with no signing secret there is no way to
 * establish the caller is Slack, and an endpoint that cannot authenticate its
 * caller must refuse rather than assume.
 */
export function verifySlackSignature(input: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  signingSecret: string | undefined;
  /** Injectable for tests. Seconds since epoch. */
  nowSeconds?: number;
}): SignatureVerdict {
  const { rawBody, timestampHeader, signatureHeader, signingSecret } = input;

  if (!signingSecret) {
    return {
      ok: false,
      code: "not_configured",
      message: "Slack signing secret is not configured; refusing the request.",
    };
  }
  if (!timestampHeader || !signatureHeader) {
    return {
      ok: false,
      code: "missing_headers",
      message: "Missing Slack signature headers.",
    };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, code: "missing_headers", message: "Malformed Slack timestamp." };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Absolute difference — a timestamp far in the FUTURE is as suspicious as a
  // stale one, and a one-sided check accepts it.
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    return {
      ok: false,
      code: "stale_timestamp",
      message: "Slack request timestamp is outside the replay window.",
    };
  }

  const expected =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  // `timingSafeEqual` throws on length mismatch, which would itself leak length
  // through the error path — so length is checked first and both branches
  // return the same verdict.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, code: "bad_signature", message: "Slack signature mismatch." };
  }

  return { ok: true };
}

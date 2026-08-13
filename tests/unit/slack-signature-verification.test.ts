/**
 * Slack request signing — the entire authentication boundary for the public
 * interactivity endpoint.
 *
 * There is no Clerk session behind this route, so every test here stands
 * between the open internet and a governed below-floor approval.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  REPLAY_WINDOW_SECONDS,
  verifySlackSignature,
} from "../../src/lib/slack/signature.ts";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = "payload=%7B%22type%22%3A%22block_actions%22%7D";
const NOW = 1_700_000_000;

const sign = (body: string, ts: number, secret = SECRET) =>
  "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

const verify = (over: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) =>
  verifySlackSignature({
    rawBody: BODY,
    timestampHeader: String(NOW),
    signatureHeader: sign(BODY, NOW),
    signingSecret: SECRET,
    nowSeconds: NOW,
    ...over,
  });

test("a genuine Slack request verifies", () => {
  assert.deepEqual(verify(), { ok: true });
});

test("a tampered body is rejected", () => {
  // The signature is valid for BODY; the request carries something else.
  const v = verify({ rawBody: BODY + "&injected=1" });
  assert.equal(v.ok === false && v.code, "bad_signature");
});

test("a wrong signing secret is rejected", () => {
  const v = verify({ signatureHeader: sign(BODY, NOW, "attacker-secret") });
  assert.equal(v.ok === false && v.code, "bad_signature");
});

test("an expired timestamp is rejected — the replay window is enforced", () => {
  const old = NOW - REPLAY_WINDOW_SECONDS - 1;
  const v = verify({ timestampHeader: String(old), signatureHeader: sign(BODY, old) });
  assert.equal(v.ok === false && v.code, "stale_timestamp");
});

test("a request just inside the window is accepted", () => {
  const edge = NOW - REPLAY_WINDOW_SECONDS + 1;
  const v = verify({ timestampHeader: String(edge), signatureHeader: sign(BODY, edge) });
  assert.equal(v.ok, true);
});

test("a FUTURE timestamp outside the window is rejected", () => {
  // A one-sided check would accept this. Replay protection has to be absolute.
  const future = NOW + REPLAY_WINDOW_SECONDS + 60;
  const v = verify({ timestampHeader: String(future), signatureHeader: sign(BODY, future) });
  assert.equal(v.ok === false && v.code, "stale_timestamp");
});

test("missing headers are rejected", () => {
  assert.equal(verify({ timestampHeader: null }).ok, false);
  assert.equal(verify({ signatureHeader: null }).ok, false);
});

test("a malformed timestamp is rejected rather than coerced", () => {
  const v = verify({ timestampHeader: "not-a-number" });
  assert.equal(v.ok === false && v.code, "missing_headers");
});

test("an unconfigured signing secret FAILS CLOSED", () => {
  // An endpoint that cannot authenticate its caller must refuse, never assume.
  const v = verify({ signingSecret: undefined });
  assert.equal(v.ok === false && v.code, "not_configured");
});

test("a signature of the wrong length is rejected without throwing", () => {
  // timingSafeEqual throws on length mismatch; the length guard must come
  // first, or the error path itself leaks length.
  assert.doesNotThrow(() => verify({ signatureHeader: "v0=short" }));
  assert.equal(verify({ signatureHeader: "v0=short" }).ok, false);
});

test("the signed string is v0:timestamp:rawBody — not a re-serialised payload", () => {
  // Pins the construction. Parsing and re-serialising the body changes key
  // order and whitespace, and every genuine Slack request would then fail.
  const manual =
    "v0=" + createHmac("sha256", SECRET).update(`v0:${NOW}:${BODY}`).digest("hex");
  assert.equal(verify({ signatureHeader: manual }).ok, true);
});

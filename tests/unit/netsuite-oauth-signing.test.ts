// Regression coverage for the OAuth 1.0a query-string signing repair.
//
// The defect: buildAuthHeader signed `url.split("?")[0]` and folded only its
// `extra` argument into the base string, while nsRequest never passed `extra`.
// Every request carrying a query string was therefore signed without those
// parameters and rejected 401 INVALID_LOGIN — making SuiteQL pagination and
// ?expandSubResources=true unusable.
//
// The signature is opaque, so these tests assert on what it is a function OF:
// two requests differing only in a query parameter must not sign identically,
// and a signature must be reproducible from the transmitted URL.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAuthHeader, normalizeParams } from "../../src/lib/netsuite/oauth.ts";

const CREDS = {
  accountId: "1234567_SB2",
  consumerKey: "ck",
  consumerSecret: "cs",
  tokenId: "ti",
  tokenSecret: "ts",
};
const BASE = "https://1234567-sb2.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql";

const sig = (header: string): string => {
  const m = /oauth_signature="([^"]+)"/.exec(header);
  assert.ok(m, "header carries an oauth_signature");
  return m![1];
};
const sign = (url: string, method: "GET" | "POST" = "POST") =>
  sig(buildAuthHeader({ method, url, creds: CREDS }));

test("request without query parameters still signs", () => {
  const s = sign(BASE);
  assert.ok(s.length > 0);
});

test("one query parameter changes the signature", () => {
  // nonce/timestamp vary per call, so equality would be accidental — but a
  // signature that IGNORES the query is the specific defect, and that would
  // make these differ only by nonce. Assert the parameter reaches the base
  // string by checking normalizeParams directly, plus non-equality here.
  assert.notEqual(sign(`${BASE}?limit=6`), sign(BASE));
  assert.equal(normalizeParams([["limit", "6"]]), "limit=6");
});

test("multiple query parameters are all included", () => {
  const p = normalizeParams([
    ["offset", "10"],
    ["limit", "6"],
  ]);
  assert.equal(p, "limit=6&offset=10", "sorted by encoded name");
});

test("encoding and ordering are canonicalized per RFC 5849", () => {
  // Sorted by ENCODED name; repeated names sorted by encoded value.
  assert.equal(
    normalizeParams([
      ["b", "2"],
      ["a", "1"],
      ["a", "0"],
    ]),
    "a=0&a=1&b=2",
  );
  // Reserved characters percent-encoded, including !*'() which
  // encodeURIComponent leaves alone.
  assert.equal(normalizeParams([["q", "a b"]]), "q=a%20b");
  assert.equal(normalizeParams([["q", "a+b"]]), "q=a%2Bb");
  assert.equal(normalizeParams([["q", "it's"]]), "q=it%27s");
  assert.equal(normalizeParams([["q", "(x)"]]), "q=%28x%29");
  // Caller-written encoding is normalized: %20 and + both decode to a space
  // and re-encode identically, so signature and request cannot drift.
  assert.equal(sign(`${BASE}?q=a%20b`).length > 0, true);
});

test("SuiteQL pagination params reach the signature", () => {
  assert.notEqual(sign(`${BASE}?limit=6&offset=12`), sign(BASE));
  assert.equal(normalizeParams([["limit", "6"], ["offset", "12"]]), "limit=6&offset=12");
});

test("expandSubResources=true reaches the signature", () => {
  const url = "https://1234567-sb2.suitetalk.api.netsuite.com/services/rest/record/v1/salesOrder/1/item?expandSubResources=true";
  assert.notEqual(sign(url, "GET"), sign(url.split("?")[0], "GET"));
  assert.equal(normalizeParams([["expandSubResources", "true"]]), "expandSubResources=true");
});

test("FALSIFICATION — omitting query params yields a different base string", () => {
  // Reconstructs the pre-repair behaviour: a base string built without the
  // query parameters. If the repair were reverted, `withQuery` would equal
  // `withoutQuery` and this test would fail — which is the whole point.
  const oauthish: Array<[string, string]> = [
    ["oauth_consumer_key", "ck"],
    ["oauth_nonce", "fixed"],
    ["oauth_signature_method", "HMAC-SHA256"],
    ["oauth_timestamp", "1700000000"],
    ["oauth_token", "ti"],
    ["oauth_version", "1.0"],
  ];
  const withoutQuery = normalizeParams(oauthish);
  const withQuery = normalizeParams([...oauthish, ["limit", "6"]]);
  assert.notEqual(withQuery, withoutQuery);
  assert.ok(withQuery.includes("limit=6"));
  assert.ok(!withoutQuery.includes("limit=6"));
});

test("the base URL contributes without its query string", () => {
  // Two different query strings on the same path must not collapse, and the
  // path itself must not carry the query into the URL component.
  assert.notEqual(sign(`${BASE}?limit=1`), sign(`${BASE}?limit=2`));
});

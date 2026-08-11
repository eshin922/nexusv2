import "server-only";
import { createHmac, randomBytes } from "node:crypto";

// Slice 12 Step 8c-1 — NetSuite TBA (OAuth 1.0a) request signing.
//
// NetSuite REST + SuiteQL use OAuth 1.0a with HMAC-SHA256. The signature
// base string is: METHOD & percent-encoded URL & percent-encoded sorted
// params. The signing key is: percent-encoded consumer_secret & percent-
// encoded token_secret. Authorization header format:
//   OAuth realm="<ACCOUNT_ID>", oauth_consumer_key="…", oauth_token="…",
//   oauth_signature_method="HMAC-SHA256", oauth_timestamp="…",
//   oauth_nonce="…", oauth_version="1.0", oauth_signature="…"
//
// NOTE: nonce/timestamp must be fresh per request; timestamp is UNIX
// seconds; nonce is any unique-per-timestamp string (crypto random hex).

export interface OAuthCredentials {
  accountId: string;         // e.g. "1234567_SB2"
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

/**
 * Percent-encode per RFC 5849 §3.6 (stricter than JS's default
 * encodeURIComponent — must escape !*'() too).
 */
function pctEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * RFC 5849 §3.4.1.3.2 parameter normalisation: sort by encoded name, then by
 * encoded value for repeated names. Exported for regression coverage.
 */
export function normalizeParams(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, v]) => [pctEncode(k), pctEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/**
 * Build the OAuth 1.0a HMAC-SHA256 Authorization header for a NetSuite
 * REST request.
 *
 * QUERY PARAMETERS ARE PART OF THE SIGNATURE (RFC 5849 §3.4.1.3.1). They are
 * parsed off `url` and merged with the oauth_* params into the base string,
 * while the base URL contributes without its query. Omitting them produces a
 * signature NetSuite rejects as `401 INVALID_LOGIN` — which is what happened
 * before this was fixed: `buildAuthHeader` stripped the query and relied on an
 * `extra` argument that no caller ever passed, so `?limit=`, `?offset=` and
 * `?expandSubResources=true` were all unauthenticable.
 *
 * Signing from the transmitted URL (rather than a caller-supplied duplicate of
 * its parameters) is what keeps signature and request from drifting apart. No
 * endpoint is special-cased.
 */
export function buildAuthHeader(args: {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  creds: OAuthCredentials;
  /** Additional params to fold into the base string. Rarely needed — query
   *  parameters present on `url` are included automatically. */
  extra?: Record<string, string>;
}): string {
  const { method, url, creds, extra } = args;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenId,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };

  // Parse the query exactly as transmitted. URLSearchParams decodes percent
  // escapes, and pctEncode re-encodes canonically — so a value arrives at the
  // base string in RFC form regardless of how the caller wrote it.
  const qIndex = url.indexOf("?");
  const baseUrl = qIndex === -1 ? url : url.slice(0, qIndex);
  const queryPairs: Array<[string, string]> =
    qIndex === -1 ? [] : [...new URLSearchParams(url.slice(qIndex + 1))];

  const pairs: Array<[string, string]> = [
    ...Object.entries(oauthParams),
    ...Object.entries(extra ?? {}),
    ...queryPairs,
  ];
  const paramString = normalizeParams(pairs);

  const baseString = [method, pctEncode(baseUrl), pctEncode(paramString)].join(
    "&",
  );
  const signingKey = `${pctEncode(creds.consumerSecret)}&${pctEncode(creds.tokenSecret)}`;
  const signature = createHmac("sha256", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  const headerParams = Object.keys(oauthParams)
    .sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth realm="${creds.accountId}", ${headerParams}`;
}

/**
 * Base URL for the SuiteTalk REST API for a given account. NetSuite
 * uses lowercase-with-hyphens (accountId `1234567_SB2` →
 * `1234567-sb2`). Sandbox and production share this URL pattern —
 * the environment is baked into the accountId itself (SB2 = sandbox 2,
 * absent = production).
 */
export function suiteTalkBaseUrl(accountId: string): string {
  const host = accountId.toLowerCase().replace(/_/g, "-");
  return `https://${host}.suitetalk.api.netsuite.com/services/rest`;
}

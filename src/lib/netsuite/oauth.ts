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
 * Build the OAuth 1.0a HMAC-SHA256 Authorization header for a NetSuite
 * REST request. `url` MUST NOT include a query string — pass path-only
 * URLs. Query params (if any) contribute to the base string via `extra`
 * but the standard SuiteTalk pattern is POST-with-JSON-body so this is
 * rare.
 */
export function buildAuthHeader(args: {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  creds: OAuthCredentials;
  /** Extra query params to include in the signature base string. */
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

  const allParams = { ...oauthParams, ...(extra ?? {}) };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join("&");

  const baseUrl = url.split("?")[0];
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

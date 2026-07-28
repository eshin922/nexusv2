import "server-only";
import {
  buildAuthHeader,
  suiteTalkBaseUrl,
  type OAuthCredentials,
} from "./oauth";
import {
  classifyNetworkError,
  classifyResponse,
  NetsuiteError,
} from "./errors";

// Slice 12 Step 8c-1 — NetSuite HTTP client.
//
// Env vars (all required; loaded lazily per call so tests can override):
//   NETSUITE_ACCOUNT_ID       e.g. "1234567_SB2"
//   NETSUITE_CONSUMER_KEY     TBA integration record's consumer key
//   NETSUITE_CONSUMER_SECRET
//   NETSUITE_TOKEN_ID         TBA access token id
//   NETSUITE_TOKEN_SECRET
//   NETSUITE_ENV              "sandbox" | "production"  (advisory tag;
//                             actual env is baked into accountId — SB2 = sandbox)
//
// SANDBOX-FIRST GUARDRAIL: if NETSUITE_ENV is unset or !=="production"
// AND the accountId doesn't end with `_SBn`, the client refuses to
// make any request. This prevents accidental prod writes from a local
// misconfiguration.

export interface NetsuiteConfig extends OAuthCredentials {
  env: "sandbox" | "production";
  /** Explicitly opt in to production writes. Belt over env-var check. */
  allowProduction?: boolean;
}

let cachedConfig: NetsuiteConfig | null = null;

/** Read from env; caches for the process lifetime. Throws if any required var is missing. */
export function loadNetsuiteConfig(): NetsuiteConfig {
  if (cachedConfig) return cachedConfig;
  const accountId = requireEnv("NETSUITE_ACCOUNT_ID");
  const env = (process.env.NETSUITE_ENV as "sandbox" | "production" | undefined) ?? inferEnv(accountId);
  cachedConfig = {
    accountId,
    consumerKey: requireEnv("NETSUITE_CONSUMER_KEY"),
    consumerSecret: requireEnv("NETSUITE_CONSUMER_SECRET"),
    tokenId: requireEnv("NETSUITE_TOKEN_ID"),
    tokenSecret: requireEnv("NETSUITE_TOKEN_SECRET"),
    env,
  };
  return cachedConfig;
}

/** Reset the cached config — testing hook. */
export function _resetNetsuiteConfigForTests(): void {
  cachedConfig = null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (NetSuite adapter requires it)`);
  return v;
}

function inferEnv(accountId: string): "sandbox" | "production" {
  // NetSuite convention: sandbox accounts end with _SB1 / _SB2 / etc.
  return /_SB\d+$/i.test(accountId) ? "sandbox" : "production";
}

/** Guardrail: refuse production writes without explicit opt-in. */
function assertWriteAuthorized(config: NetsuiteConfig, method: string) {
  if (method === "GET") return;
  if (config.env === "production" && !config.allowProduction) {
    throw new Error(
      `[netsuite] Production write attempted (${method}) without allowProduction=true. ` +
        `Set NETSUITE_ENV=sandbox for dev, or pass allowProduction:true explicitly.`,
    );
  }
}

// ---------- request primitives ----------

export type NetsuiteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface RequestArgs {
  method: NetsuiteMethod;
  path: string;                      // e.g. "/record/v1/salesOrder/2646"
  body?: unknown;                    // JSON-serializable; null/undefined → no body
  extraHeaders?: Record<string, string>;
  /** Override config for tests / one-off calls. */
  config?: NetsuiteConfig;
  /** Retry budget for transient failures. Default 3; excludes non-retryable. */
  maxRetries?: number;
}

/**
 * Low-level authenticated request. Auto-classifies errors, retries
 * retryable classes with exponential backoff.
 */
export async function nsRequest<T = unknown>(args: RequestArgs): Promise<T> {
  const config = args.config ?? loadNetsuiteConfig();
  assertWriteAuthorized(config, args.method);

  const url = suiteTalkBaseUrl(config.accountId) + args.path;
  const maxRetries = args.maxRetries ?? 3;
  const payloadPreview = args.body ? JSON.stringify(args.body).slice(0, 200) : undefined;

  let lastErr: NetsuiteError | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const authHeader = buildAuthHeader({
      method: args.method,
      url,
      creds: config,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: args.method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Prefer: "transient",
          ...(args.extraHeaders ?? {}),
        },
        body: args.body ? JSON.stringify(args.body) : undefined,
      });
    } catch (cause) {
      lastErr = classifyNetworkError({ cause, url, method: args.method });
      if (!lastErr.isRetryable()) throw lastErr;
      await sleep(backoffMs(attempt));
      continue;
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (response.ok) return body as T;

    lastErr = classifyResponse({
      status: response.status,
      body,
      url,
      method: args.method,
      payloadPreview,
    });
    if (!lastErr.isRetryable()) throw lastErr;
    await sleep(backoffMs(attempt));
  }

  throw lastErr ?? new Error("[netsuite] Request failed with no captured error");
}

// ---------- SuiteQL helper ----------

/**
 * Run a SuiteQL SELECT statement. Enforces SELECT prefix (belt against
 * accidental DML — SuiteQL doesn't support DML anyway, but the assertion
 * catches typos before they hit the wire).
 */
export async function suiteQL<T = Record<string, unknown>>(
  q: string,
  args?: { config?: NetsuiteConfig; limit?: number; offset?: number },
): Promise<{ items: T[]; hasMore: boolean; totalResults?: number }> {
  const trimmed = q.trim();
  if (!/^SELECT\b/i.test(trimmed))
    throw new Error(`[netsuite] SuiteQL must begin with SELECT (got: ${trimmed.slice(0, 30)}…)`);

  const params = new URLSearchParams();
  if (args?.limit) params.set("limit", String(args.limit));
  if (args?.offset) params.set("offset", String(args.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";

  const result = await nsRequest<{
    items: T[];
    hasMore: boolean;
    totalResults?: number;
  }>({
    method: "POST",
    path: `/query/v1/suiteql${qs}`,
    body: { q: trimmed },
    config: args?.config,
  });

  return {
    items: result.items ?? [],
    hasMore: result.hasMore ?? false,
    totalResults: result.totalResults,
  };
}

// ---------- REST record helpers ----------

export async function getRecord<T = Record<string, unknown>>(
  recordType: string,
  id: string,
  opts?: { config?: NetsuiteConfig },
): Promise<T> {
  return nsRequest<T>({
    method: "GET",
    path: `/record/v1/${recordType}/${encodeURIComponent(id)}`,
    config: opts?.config,
  });
}

/**
 * Create a record. Returns the Location header's internal id (NetSuite
 * returns the new record id in the response's Location header, not
 * body). If the platform ever adds bodies, extend here.
 */
export async function createRecord(args: {
  recordType: string;
  body: Record<string, unknown>;
  config?: NetsuiteConfig;
  idempotencyKey?: string;
}): Promise<{ internalId: string }> {
  const url =
    suiteTalkBaseUrl((args.config ?? loadNetsuiteConfig()).accountId) +
    `/record/v1/${args.recordType}`;
  const config = args.config ?? loadNetsuiteConfig();
  assertWriteAuthorized(config, "POST");

  const authHeader = buildAuthHeader({
    method: "POST",
    url,
    creds: config,
  });

  const headers: Record<string, string> = {
    Authorization: authHeader,
    "Content-Type": "application/json",
    Prefer: "transient",
  };
  if (args.idempotencyKey) headers["X-NetSuite-Idempotency-Key"] = args.idempotencyKey;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args.body),
  });

  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep string */
    }
    throw classifyResponse({
      status: response.status,
      body,
      url,
      method: "POST",
      payloadPreview: JSON.stringify(args.body).slice(0, 200),
    });
  }

  // NetSuite returns the created record's internal id via Location header.
  // Format: .../record/v1/<recordType>/<id>
  const location = response.headers.get("Location") ?? "";
  const match = /\/([^\/]+)\/?$/.exec(location);
  if (!match) {
    throw new Error(
      `[netsuite] createRecord succeeded but Location header missing id: ${location}`,
    );
  }
  return { internalId: match[1] };
}

// ---------- helpers ----------

function backoffMs(attempt: number): number {
  // 500ms, 1500ms, 4500ms — bounded, no jitter overhead for MVP
  return 500 * Math.pow(3, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

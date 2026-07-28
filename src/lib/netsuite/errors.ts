// Pure function tree — no server-only import. See composition-hash.ts
// for the rationale + boundary discipline.

// Slice 12 Step 8c-1 — NetSuite error taxonomy.
//
// The adapter distinguishes:
//
//   - AuthError: 401 from NetSuite (bad TBA signature, expired token,
//     rotated consumer key). Retry is pointless; escalate to admin.
//   - ForbiddenError: 403 (role missing a permission — often "Lists →
//     Projects", "REST Web Services", or a class-specific gate).
//     Also unrecoverable at push time; needs admin role adjustment.
//   - NotFoundError: 404 (record id doesn't exist). Legitimate outcome
//     for the "does this Item Group already exist by externalId?" probe;
//     callers translate to "cache miss" not "fatal error".
//   - RateLimitError: 429 or "Concurrency Limit Exceeded". Retry with
//     backoff; not a bug.
//   - ValidationError: 400 with body indicating field-level rejection
//     (missing required field, invalid enum value, ID mismatch). Push
//     blocks; PM fixes the data.
//   - ServerError: 5xx. Retry-with-backoff; if persistent, surface as
//     failed-tab so PM can retry manually.
//   - NetworkError: fetch itself failed (DNS, TCP, TLS). Retryable.
//   - UnknownError: anything else. Log full context; treat as retryable
//     but surface prominently.
//
// Every error carries {status?, code?, detail, requestId?, url} so
// audit + logs can reconstruct the failure.

export type NetsuiteErrorClass =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "validation"
  | "server"
  | "network"
  | "unknown";

export interface NetsuiteErrorContext {
  status?: number;
  code?: string;
  detail: string;
  requestId?: string;
  url?: string;
  method?: string;
  payloadPreview?: string;
}

export class NetsuiteError extends Error {
  readonly className: NetsuiteErrorClass;
  readonly context: NetsuiteErrorContext;

  constructor(className: NetsuiteErrorClass, context: NetsuiteErrorContext) {
    super(`[netsuite:${className}] ${context.detail}`);
    this.name = "NetsuiteError";
    this.className = className;
    this.context = context;
  }

  /** True for classes where retrying might succeed without human intervention. */
  isRetryable(): boolean {
    return (
      this.className === "rate_limit" ||
      this.className === "server" ||
      this.className === "network"
    );
  }

  /** True for classes where PM sees a blocking-tab failure and must act. */
  isBlocking(): boolean {
    return (
      this.className === "auth" ||
      this.className === "forbidden" ||
      this.className === "validation"
    );
  }
}

/**
 * Classify a failed fetch/response into a NetsuiteError. Uses status
 * code + response body shape (RFC 9110 problem+json is what SuiteTalk
 * returns for most errors).
 */
export function classifyResponse(args: {
  status: number;
  body: unknown;
  url: string;
  method: string;
  payloadPreview?: string;
}): NetsuiteError {
  const { status, body, url, method, payloadPreview } = args;
  const detail = extractDetail(body);
  const code = extractCode(body);
  const requestId = extractRequestId(body);
  const context: NetsuiteErrorContext = {
    status,
    code,
    detail,
    requestId,
    url,
    method,
    payloadPreview,
  };

  if (status === 401) return new NetsuiteError("auth", context);
  if (status === 403) return new NetsuiteError("forbidden", context);
  if (status === 404) return new NetsuiteError("not_found", context);
  if (status === 429) return new NetsuiteError("rate_limit", context);
  if (status >= 400 && status < 500) {
    // Rate-limit sometimes surfaces as 400 with a specific message.
    if (detail.toLowerCase().includes("concurrency"))
      return new NetsuiteError("rate_limit", context);
    return new NetsuiteError("validation", context);
  }
  if (status >= 500) return new NetsuiteError("server", context);
  return new NetsuiteError("unknown", context);
}

/** Wrap a fetch-thrown error (network layer) as a NetsuiteError. */
export function classifyNetworkError(args: {
  cause: unknown;
  url: string;
  method: string;
}): NetsuiteError {
  const { cause, url, method } = args;
  const detail =
    cause instanceof Error ? cause.message : "Unknown network failure";
  return new NetsuiteError("network", { detail, url, method });
}

function extractDetail(body: unknown): string {
  if (!body || typeof body !== "object") return String(body ?? "");
  const b = body as Record<string, unknown>;
  const details = b["o:errorDetails"];
  if (Array.isArray(details) && details[0] && typeof details[0] === "object") {
    const d = details[0] as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
  }
  if (typeof b.title === "string") return b.title;
  if (typeof b.message === "string") return b.message;
  return JSON.stringify(body).slice(0, 400);
}

function extractCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const details = b["o:errorDetails"];
  if (Array.isArray(details) && details[0] && typeof details[0] === "object") {
    const d = details[0] as Record<string, unknown>;
    if (typeof d["o:errorCode"] === "string")
      return d["o:errorCode"] as string;
  }
  return undefined;
}

function extractRequestId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b["o:requestId"] === "string")
    return b["o:requestId"] as string;
  return undefined;
}

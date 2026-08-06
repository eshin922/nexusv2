/**
 * Correlated eight-point trace for the stale-calculation investigation.
 *
 * TEMPORARY — environment-gated, removed once the Costs Functional
 * Certification verdict is recorded. Sibling of costs-timing.ts: that one
 * measures DURATION, this one follows a VALUE.
 *
 * ---------------------------------------------------------------------------
 * The question this exists to settle
 * ---------------------------------------------------------------------------
 *
 * A stale field has several possible causes that look identical on screen:
 *
 *   · the calculation was never triggered
 *   · it ran against stale inputs
 *   · it persisted correctly but the read model stayed stale
 *   · reconciliation applied an older snapshot over a newer one
 *   · the value is correct and merely arrives after the full round-trip
 *
 * Only a trace that follows ONE value across the write, the read, the
 * calculation and the return can tell them apart. Each stage logs the value it
 * saw, so the first stage where it is wrong, missing, or late is the answer.
 *
 * ---------------------------------------------------------------------------
 * Correlation
 * ---------------------------------------------------------------------------
 *
 * The write and the subsequent read are SEPARATE requests — the RSC render
 * that reloads the bundle has no access to the action's correlation id. The
 * chain is therefore joined in two hops:
 *
 *   traceId  ──(action)──>  commitRevision  ──(bundle)──>  rendered value
 *
 * The action emits its traceId together with the post-commit revision; every
 * read-side event carries the revision it observed. Joining on revision closes
 * the chain without threading an id through the RSC boundary. The client logs
 * traceId alongside the revision it finally applies, which links the server
 * chain to what the operator actually saw.
 *
 * ---------------------------------------------------------------------------
 * Scope discipline
 * ---------------------------------------------------------------------------
 *
 * Only the fields named in the investigation are emitted: ids, the freight and
 * customs numbers under test, revisions, and which authority supplied the
 * value. No bundle dumps, no operator identity, no commercial data beyond the
 * figures being traced.
 */

const ENABLED = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

/** Which model supplied the value — the shadowing question, made explicit. */
export type FreightAuthority = "worksheet" | "legacy" | "none";

export type CostsTraceEvent = {
  /** One of the eight trace points. */
  point:
    | "action received"
    | "action normalized"
    | "action persisted"
    | "worksheet read"
    | "calc input"
    | "calc output"
    | "bundle returned";
  traceId?: string;
  quoteId: string;
  action?: string;
  destinationId?: string;
  breakId?: string;
  tierId?: string;
  /** Revision the client believed it was working from, when it sent one. */
  clientRevision?: number | string | null;
  /** Revision minted server-side — the reconciliation ordering authority. */
  serverRevision?: number | string | null;
  authority?: FreightAuthority;
  /** The figures under test. Numbers and nulls only. */
  values?: Record<string, number | string | null | undefined>;
};

/**
 * Emit one trace event as a single greppable line.
 *
 * `[costs-trace]` collects the whole investigation from one log filter, and
 * the JSON payload keeps it machine-joinable on traceId and revision rather
 * than requiring the reader to parse prose.
 */
export function traceCosts(event: CostsTraceEvent): void {
  if (!ENABLED) return;
  console.log(`[costs-trace] ${JSON.stringify({ ...event, at: new Date().toISOString() })}`);
}

/** Stable-ish id for one operator action. Not security-sensitive. */
export function newTraceId(): string {
  return `t${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

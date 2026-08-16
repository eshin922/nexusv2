/**
 * Server actions return structured results. Never throw on expected
 * failure modes (state violations, validation, not-found). Reserve
 * `throw` for genuine bugs and Next.js intrinsics like redirect().
 *
 * See CLAUDE.md "Action result pattern" for the project convention.
 */

import { UnresolvedQuoteCostsError } from "./quote-cost-completeness-contract";

export type ActionError = {
  code: string;
  message: string;
  field?: string;
  /**
   * Structured payload for refusals the UI must RENDER rather than merely
   * report. Present only for codes that document it — today
   * `UNRESOLVED_COSTS`, whose payload is the unresolved cost rows.
   *
   * It exists so a caller never has to parse the human-readable `message`.
   * Message text is written for a person and changes freely; anything that
   * branched on it would break the first time the copy improved.
   */
  details?: unknown;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

// Error codes used by both client (for branching on specific failure
// modes like QUOTE_NOT_DRAFT) and server (for tagging the cause).
export const ERR = {
  QUOTE_NOT_DRAFT: "QUOTE_NOT_DRAFT",
  /**
   * The quote carries costs the operator has not resolved. A BUSINESS REFUSAL,
   * not a fault: the guard is working, and the send is correctly declined.
   *
   * It has its own code because it is the one refusal the UI must render as a
   * work list rather than a sentence — `error.details` carries the rows.
   */
  UNRESOLVED_COSTS: "UNRESOLVED_COSTS",
  /**
   * A staged pricing decision was made against a state that has since moved.
   *
   * TWO CODES, not one, because the operator's remedy differs and a single
   * "something changed" tells them nothing about where to look:
   *
   *   PRICING_STALE — a lever moved. Someone else's pricing decision landed on
   *   this quote; reload Pricing and decide again.
   *   COSTS_STALE — the economic basis moved. The prices were calculated
   *   against figures that are no longer current; re-check Costs.
   *
   * Business refusals, not faults. The guard working is the guard refusing.
   */
  PRICING_STALE: "PRICING_STALE",
  COSTS_STALE: "COSTS_STALE",
  // Slice 12 Step 10 §0.5 RECOMMEND 1 — the "quote is frozen"
  // signal for writes that must not touch accepted/complete quotes
  // outside the sanctioned reopen path. See assertRevisable().
  QUOTE_FROZEN: "QUOTE_FROZEN",
  QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION_ERROR",
  PERMISSION: "PERMISSION_DENIED",
  // Distinct from PERMISSION_DENIED: FORBIDDEN signals "you are
  // authenticated but lack the role" specifically. Used by
  // requireAdminAction so admin-gated action POST replays return
  // a stable, recognizable code clients can branch on.
  FORBIDDEN: "FORBIDDEN",
  // Deliberately NOT VALIDATION_ERROR. Validation means the operator
  // supplied something the system can reject and they can correct.
  // DATA_INTEGRITY means the stored structure itself could not be
  // resolved: nothing the operator typed was wrong, nothing they can
  // retype will help, and no write was attempted. Collapsing the two
  // would tell an operator to fix input that is already correct, and
  // would hide a structural fault behind routine form noise.
  //
  // The write boundary converts the resolver's hard exception into
  // this code so the workspace survives; the resolver itself keeps
  // throwing, so migrations and jobs still fail closed.
  DATA_INTEGRITY: "DATA_INTEGRITY",
  HUBSPOT: "HUBSPOT_ERROR",
} as const;

export function actionOk(): ActionResult<void>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data: data as T };
}

export function actionError(
  code: string,
  message: string,
  field?: string,
  details?: unknown,
): ActionResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(field ? { field } : {}),
      ...(details === undefined ? {} : { details }),
    },
  };
}

/**
 * Thrown by guard helpers (assertDraft, loadOrThrow). Caught by
 * runAction and converted into a structured ActionResult. Anything
 * else thrown propagates — including next/navigation's redirect()
 * sentinel, which Next.js needs to intercept.
 */
export class ActionGuardError extends Error {
  public readonly code: string;
  public readonly field?: string;

  constructor(
    code: string,
    message: string,
    field?: string,
  ) {
    super(message);
    this.code = code;
    this.field = field;
    this.name = "ActionGuardError";
  }
}

/**
 * Postgres SQL state codes that represent user-facing validation issues
 * rather than bugs. We translate these to ActionResult VALIDATION_ERROR
 * so the UI can surface a friendly inline message instead of a 500.
 *
 * Scope deliberately narrow: only data-format violations that map 1:1 to
 * "the value the user typed is out of range / too long for this field."
 * Other codes (FK violation 23503, unique 23505, NOT NULL 23502, check
 * constraint 23514) are NOT auto-translated — they could indicate genuine
 * data bugs that should propagate as crashes for investigation.
 *
 * Caught Slice 8 sub-step 5: typing 3025 into a markup_pct field
 * (numeric(5,4), max 9.9999) overflowed Postgres and crashed the page.
 */
function pgValidationError(
  e: unknown,
): { code: string; message: string } | null {
  if (!e || typeof e !== "object" || !("code" in e)) return null;
  const code = (e as { code: unknown }).code;
  if (code === "22003") {
    // numeric_field_overflow — value exceeds column precision
    return {
      code: ERR.VALIDATION,
      message:
        "Value out of allowed range. Percent fields must be between -999% and 999%.",
    };
  }
  if (code === "22001") {
    // string_data_right_truncation — value too long for varchar column
    return {
      code: ERR.VALIDATION,
      message: "Value too long for this field.",
    };
  }
  return null;
}

/**
 * Wraps an action body. Catches ActionGuardError and converts to a
 * structured ActionResult; translates known-validation Postgres errors
 * (numeric overflow, string truncation) similarly. Re-throws anything
 * else (so redirect() sentinels and real bugs surface as crashes, not
 * silent failures).
 */
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return actionOk(data);
  } catch (e) {
    if (e instanceof ActionGuardError)
      return actionError(e.code, e.message, e.field);
    // A BUSINESS REFUSAL, not a fault. The cost guard is authoritative and
    // stays exactly as it is; what was wrong is that its exception was not in
    // the vocabulary this function translates, so it fell through to the
    // rethrow below and Next rendered it as a server-side application error.
    // The operator got a 500 where they should have got a work list.
    //
    // The structured `unresolved` payload is passed through verbatim. Nothing
    // parses the message string — that text is written for a person.
    if (e instanceof UnresolvedQuoteCostsError)
      return actionError(
        ERR.UNRESOLVED_COSTS,
        "Resolve costs before sending.",
        undefined,
        e.unresolved,
      );
    const pg = pgValidationError(e);
    if (pg) return actionError(pg.code, pg.message);
    throw e;
  }
}

// ---------- common guard messages ----------

export function quoteNotDraftMessage(status: string): string {
  return `This quote is in '${status}' status. Editing is disabled. To make changes, create a new draft version from the project page.`;
}

export function quoteFrozenMessage(status: string): string {
  return `This quote is in '${status}' status and has been frozen. Post-freeze edits require the reopen flow (revise, or explicit admin unmark).`;
}

// ---------- shared quote-status guards ----------

/**
 * Draft-only guard. Historically duplicated as a private helper in
 * src/app/actions/quotes.ts and src/app/actions/assemblies.ts;
 * consolidated here Slice 12 Step 10 §0.5.
 *
 * Use for any write path where the write must only happen while the
 * quote is still being drafted (freezes at send). The overwhelming
 * majority of Nexus write actions fall into this bucket.
 */
export function assertDraft(quote: { status: string }): void {
  if (quote.status !== "draft") {
    throw new ActionGuardError(ERR.QUOTE_NOT_DRAFT, quoteNotDraftMessage(quote.status));
  }
}

/**
 * Pattern 52 enforcement — rejects writes on frozen quotes.
 *
 * Fails on status IN ('accepted', 'complete'). Passes on 'draft' +
 * 'sent'. Use this guard whenever a NEW writer touches a column
 * that carries a Pattern 52 commitment (see docs/pattern-52-freeze-list.md).
 *
 * Why this exists (Slice 12 Step 10 §0.5 RECOMMEND 1): Pattern 52
 * held reproducibility guarantees by CONVENTION — the discipline was
 * "don't add writers that don't check status." Convention doesn't
 * fail when a future writer skips the check. This helper does.
 *
 * Sanctioned reopen paths (unmarkAccepted, reviseFromAccepted) do
 * NOT call this guard — they handle their own state transitions
 * with explicit intent (bumping version_number, downgrading status
 * back to sent, etc.). Everything else goes through here.
 *
 * Slice 13 §0.5 checklist item: "does this write any Pattern 52
 * column?" If yes, the action MUST call assertNotFrozen at the top,
 * or CC surfaces the gap before implementation.
 *
 * Naming note: `requireRevisable` in src/lib/quote-guards.ts has
 * INVERTED semantics (asserts sent-or-accepted, used to gate the
 * Revise-in-place transition). Do not conflate the two. This guard
 * says "the write is not touching frozen state"; the other says
 * "this quote can be reopened for edits."
 */
export function assertNotFrozen(quote: { status: string }): void {
  if (quote.status === "accepted" || quote.status === "complete") {
    throw new ActionGuardError(ERR.QUOTE_FROZEN, quoteFrozenMessage(quote.status));
  }
}

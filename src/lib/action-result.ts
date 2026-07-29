/**
 * Server actions return structured results. Never throw on expected
 * failure modes (state violations, validation, not-found). Reserve
 * `throw` for genuine bugs and Next.js intrinsics like redirect().
 *
 * See CLAUDE.md "Action result pattern" for the project convention.
 */

export type ActionError = { code: string; message: string };

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

// Error codes used by both client (for branching on specific failure
// modes like QUOTE_NOT_DRAFT) and server (for tagging the cause).
export const ERR = {
  QUOTE_NOT_DRAFT: "QUOTE_NOT_DRAFT",
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
  HUBSPOT: "HUBSPOT_ERROR",
} as const;

export function actionOk(): ActionResult<void>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data: data as T };
}

export function actionError(code: string, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/**
 * Thrown by guard helpers (assertDraft, loadOrThrow). Caught by
 * runAction and converted into a structured ActionResult. Anything
 * else thrown propagates — including next/navigation's redirect()
 * sentinel, which Next.js needs to intercept.
 */
export class ActionGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
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
    if (e instanceof ActionGuardError) return actionError(e.code, e.message);
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

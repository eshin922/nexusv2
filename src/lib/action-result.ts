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
  QUOTE_NOT_FOUND: "QUOTE_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION_ERROR",
  PERMISSION: "PERMISSION_DENIED",
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
 * Wraps an action body. Catches ActionGuardError and converts to a
 * structured ActionResult; re-throws anything else (so redirect()
 * sentinels and real bugs surface as crashes, not silent failures).
 */
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return actionOk(data);
  } catch (e) {
    if (e instanceof ActionGuardError) return actionError(e.code, e.message);
    throw e;
  }
}

// ---------- common guard messages ----------

export function quoteNotDraftMessage(status: string): string {
  return `This quote is in '${status}' status. Editing is disabled. To make changes, create a new draft version from the project page.`;
}

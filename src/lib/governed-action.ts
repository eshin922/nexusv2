/**
 * The failure contract for governed server actions, client side.
 *
 * `ActionResult` already covers everything the server can SAY. This covers the
 * case where it says nothing at all — the function crashed, the deploy was
 * mid-swap, the network dropped. Then the promise rejects, and a call site
 * written as
 *
 *     const r = await someAction(fd);
 *     if (!r.ok) setError(r.error.message);
 *
 * never reaches either branch. Nothing sets an error, `pending` clears, and the
 * control returns to looking exactly as it did. The operator's only evidence
 * that a governed act failed is that the page did not change — which is
 * indistinguishable from not having clicked.
 *
 * Soak run 5 measured this on Finalize: `POST .../quote 503`, quote left in
 * `draft`, nothing on screen. See `docs/validation/soak/run-05.md`.
 *
 * THREE OUTCOMES, NOT TWO, and the third is the point. Folding "could not
 * reach the server" into "the server refused" would put words in the server's
 * mouth; folding it into success is the defect above. This is the same
 * discipline as CLAUDE.md Pattern 60 — a control that cannot distinguish
 * absence from failure reports the same value for both.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: render anything, or decide what success
 * means. Those differ per call site — an alert paragraph, a status line, a
 * dirty flag, a rolled-back draft — and collapsing them would be an
 * abstraction that makes call sites look alike without removing anything real.
 */

import type { ActionResult } from "./action-result";

export type GovernedOutcome<T> =
  /** The server answered and did the thing. */
  | { kind: "ok"; data: T }
  /**
   * The server answered and declined. `message` is the boundary's own words
   * and is authoritative — render it verbatim, never a paraphrase.
   */
  | { kind: "refused"; code: string; message: string; details?: unknown }
  /**
   * The server never answered. Whether the write happened is UNKNOWN, and the
   * message must not claim otherwise.
   */
  | { kind: "unreachable"; message: string; cause: unknown };

/**
 * Deliberately does not say "nothing was saved".
 *
 * A 503 can be a function that failed before its transaction, or after it. The
 * client cannot tell, so the honest instruction is to look rather than to
 * assume. Every governed write in this tree is guarded server-side
 * (`assertDraft`, `assertNotFrozen`, sequence checks), so a retry that turns
 * out to be a duplicate refuses structurally rather than acting twice — which
 * is why "try again" is safe advice here and would not be everywhere.
 */
export const UNREACHABLE_MESSAGE =
  "Couldn't reach the server, so this may or may not have gone through. " +
  "Reload to see the current state, then try again.";

/**
 * Run a governed action and always resolve — never reject.
 *
 * The returned outcome is exhaustive, so a call site that switches on `kind`
 * cannot silently omit the failure path the way `if (!r.ok)` can.
 */
export async function runGoverned<T>(
  call: () => Promise<ActionResult<T>>,
): Promise<GovernedOutcome<T>> {
  let result: ActionResult<T>;
  try {
    result = await call();
  } catch (cause) {
    return { kind: "unreachable", message: UNREACHABLE_MESSAGE, cause };
  }
  // A malformed result is a transport failure in disguise: something answered,
  // but not the action. Treating it as `ok` would imply a success nothing
  // asserted.
  if (!result || typeof result !== "object" || !("ok" in result)) {
    return { kind: "unreachable", message: UNREACHABLE_MESSAGE, cause: result };
  }
  if (result.ok) return { kind: "ok", data: result.data };
  return {
    kind: "refused",
    code: result.error.code,
    message: result.error.message,
    details: result.error.details,
  };
}

/**
 * The same guarantee for a call that reports refusal some other way — today
 * the recovery draft's `propose`, which returns the engine's sentence or
 * `null` because it also performs a rollback the caller must not duplicate.
 *
 * `onOk` runs ONLY when the call resolves, so bookkeeping that means "this
 * landed" cannot execute on a rejection.
 */
export async function runGovernedRaw<T>(
  call: () => Promise<T>,
): Promise<{ kind: "settled"; value: T } | { kind: "unreachable"; message: string; cause: unknown }> {
  try {
    return { kind: "settled", value: await call() };
  } catch (cause) {
    return { kind: "unreachable", message: UNREACHABLE_MESSAGE, cause };
  }
}

/** The operator-facing sentence for any non-ok outcome. */
export function failureMessage(outcome: GovernedOutcome<unknown>): string | null {
  return outcome.kind === "ok" ? null : outcome.message;
}

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { quotes } from "@/db/schema";
import type { db as Db } from "@/db";

type Executor = typeof Db | Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * How long a claim survives without being released.
 *
 * THIS IS A BACKSTOP FOR A HARD CRASH, NOT THE NORMAL PATH. Every failure
 * path in `sendQuote` releases its own claim explicitly; the lease only
 * matters when the function dies without running any of them — an OOM, a
 * platform kill, a lost instance.
 *
 * Chosen from the ceiling rather than from taste, so "a live publisher cannot
 * be overtaken" is provable rather than hoped:
 *
 *   observed publication   7.7s   (production Finalize of DPS-1072, server-side;
 *                                  the failed attempts were 4.8s, and other
 *                                  actions on that route 0.5-3.5s)
 *   platform ceiling      <=300s  (no Vercel plan permits a function to run
 *                                  longer; this project sets no higher
 *                                  maxDuration anywhere)
 *   lease                  900s
 *
 * A publisher is killed by the platform at least three times over before its
 * claim can expire, so expiry can only ever collect a claim whose owner is
 * already dead. Raising the lease costs an operator a longer wait after a
 * crash; lowering it toward the ceiling is what would make overtaking
 * possible, and that is the property being protected.
 */
export const PUBLICATION_CLAIM_LEASE_SECONDS = 900;

export type PublicationClaim =
  /** This caller owns publication. `quoteNumber` is governed and is theirs to render. */
  | { kind: "acquired"; quoteNumber: string; token: string }
  /** Another caller owns publication right now. Render nothing; reload. */
  | { kind: "held" }
  /** Not a draft — already published, or otherwise not in a publishable state. */
  | { kind: "not_publishable" };

/**
 * Elect one publisher for a quote, and give it the governed number.
 *
 * ── WHY ALLOCATION AND ELECTION ARE ONE STATEMENT ───────────────────────
 *
 * They are the same decision. Splitting them would leave a window in which a
 * number exists with no owner, or an owner exists with no number, and both
 * windows are reachable by the second caller. One `UPDATE` makes the row lock
 * the election: whoever wins the row wins the number.
 *
 * ── WHY `COALESCE` AND NOT A BRANCH ─────────────────────────────────────
 *
 * `COALESCE` short-circuits in PostgreSQL, so `nextval` is not evaluated when
 * a number is already set. That is what makes retry and revise-in-place reuse
 * the governed number rather than burn a new one, and it is verified rather
 * than assumed (see the unit proofs). A branch in application code could not
 * do this atomically: reading the number and then deciding whether to allocate
 * is two statements with a race between them.
 */
export async function claimPublication(
  exec: Executor,
  args: { quoteId: string; quoteNumberPrefix: string },
): Promise<PublicationClaim> {
  const token = randomUUID();

  const rows = (await exec.execute(sql`
    UPDATE ${quotes}
       SET quote_number = COALESCE(
             ${quotes.quoteNumber},
             ${args.quoteNumberPrefix} || '-' || nextval('quote_number_seq')
           ),
           publication_claim_token = ${token},
           publication_claimed_at = now()
     WHERE ${quotes.id} = ${args.quoteId}
       AND ${quotes.status} = 'draft'
       AND (
             ${quotes.publicationClaimToken} IS NULL
             OR ${quotes.publicationClaimedAt}
                  < now() - make_interval(secs => ${PUBLICATION_CLAIM_LEASE_SECONDS})
           )
    RETURNING quote_number
  `)) as unknown as Array<{ quote_number: string }>;

  if (rows.length === 1) {
    return { kind: "acquired", quoteNumber: rows[0].quote_number, token };
  }

  // Zero rows means the WHERE did not match, and the two reasons are different
  // facts the caller must tell apart: a live claim is a transient conflict the
  // operator should retry, a non-draft quote is a finished lifecycle.
  const [current] = await exec
    .select({
      status: quotes.status,
      claim: quotes.publicationClaimToken,
    })
    .from(quotes)
    .where(eq(quotes.id, args.quoteId))
    .limit(1);

  if (current && current.status === "draft" && current.claim !== null) {
    return { kind: "held" };
  }
  return { kind: "not_publishable" };
}

/**
 * Release a claim — but only if it is still ours.
 *
 * The `token` predicate is the whole point. A publisher that fails slowly can
 * reach this line after a newer publisher has legitimately acquired the claim,
 * and an unscoped release would clear the live one, letting a third caller in
 * while the second is mid-render. Scoped, a late finisher can only ever clear
 * a claim it still owns, and clearing nothing is the correct outcome.
 *
 * Never throws: this runs on the failure path, where the original error is the
 * one that matters and a release problem must not replace it.
 */
export async function releasePublicationClaim(
  exec: Executor,
  args: { quoteId: string; token: string },
): Promise<void> {
  try {
    await exec
      .update(quotes)
      .set({ publicationClaimToken: null, publicationClaimedAt: null })
      .where(
        and(
          eq(quotes.id, args.quoteId),
          eq(quotes.publicationClaimToken, args.token),
        ),
      );
  } catch {
    // Deliberately swallowed. The lease collects a claim this could not clear.
  }
}

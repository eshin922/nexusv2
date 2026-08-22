import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { quotes } from "@/db/schema";
import type { QuoteOperator } from "@/lib/below-floor-authorization";

/**
 * Who is commercially responsible for THIS quote version's economics.
 *
 * One reader, four gates. The separation-of-duties predicate is only as good as
 * the agreement between the places that evaluate it, and four call sites each
 * doing their own `select created_by_user_id` is four chances to read a
 * different column, join a different row, or coalesce a null differently. This
 * exists so "who is the operator" has exactly one answer.
 *
 * ── WHY `created_by_user_id` AND NOTHING ELSE ────────────────────────────
 *
 * Measured across the estate: `quotes.created_by_user_id` is populated on 79 of
 * 89 quotes and written by every creation path — `createQuote`,
 * `createScenario`, and both copy actions. `projects.pm_user_id` is populated
 * on 3 of 34 and no UI writes it at all (`project-import` hardcodes null);
 * `projects.sales_rep_user_id` on 5 of 34, and it records a HubSpot
 * relationship rather than authorship of the pricing.
 *
 * It is also the right GRANULARITY. A revision writes a fresh quote row with
 * its own `created_by`, so responsibility follows the version — which is what
 * an authorization is already bound to, alongside the tier and the fingerprint.
 *
 * ── NULL IS A DISPOSITION, NOT A DEFAULT ─────────────────────────────────
 *
 * Ten quotes carry no creator. This returns `null` for them and every gate
 * refuses. It does NOT fall back to the PM, the sales rep, the importer or the
 * requester: each would be a guess about responsibility, and a guess that
 * resolves to somebody is indistinguishable — at the gate — from knowing.
 */
export async function loadQuoteOperator(quoteId: string): Promise<QuoteOperator> {
  const [row] = await db
    .select({ createdByUserId: quotes.createdByUserId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row?.createdByUserId ?? null;
}

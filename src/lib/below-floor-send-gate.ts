import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { belowFloorAuthorizations } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { ActionGuardError, ERR } from "@/lib/action-result";
import { projectBelowFloorAuthorization } from "@/lib/below-floor-projection";

/**
 * The floor gate at SEND. Refuses before any external artifact exists.
 *
 * ── WHY THIS DID NOT EXIST, AND WHY THAT WAS THE REAL DEFECT ─────────────
 *
 * `markAccepted` and `markComplete` both enforced the floor. `sendQuote` did
 * not: across its whole body it pins `floorMarginPct` into the snapshot and
 * never reads it. The only thing standing between a below-floor quote and a
 * customer was the Pricing surface withholding a link — and the inner rail
 * links to `/quote` unconditionally, so it stood between nobody.
 *
 * A UI affordance was being used as an enforcement boundary it cannot enforce.
 * Moving the rule here is the point of the slice; the surface predicate
 * (`pricing-progression.ts`) now PREDICTS this gate rather than substituting
 * for it.
 *
 * ── EVERY TIER, NOT THE ACCEPTED ONE ─────────────────────────────────────
 *
 * The acceptance gate checks the tier being accepted, because by then one has
 * been chosen. A send offers the customer EVERY tier, any of which they may
 * take. Checking one would leave the others sendable below floor and refuse
 * them only at acceptance — after the customer has seen the price, which is the
 * expensive moment to discover it.
 *
 * ── WHAT IT CHECKS, AND WHAT IT NO LONGER DOES ───────────────────────────
 *
 * That a valid authorization exists for every below-floor tier: right version,
 * right tier, current fingerprint, not invalidated. It does NOT ask who is
 * sending — policy places no independence requirement on approval, so the
 * sender's identity is not part of the question.
 *
 * The same function, the same verdict, at a second commitment point. No second
 * implementation, and specifically no relaxed variant for send.
 */
export async function requireBelowFloorAuthorizedToSend(input: {
  quoteId: string;
  quoteVersionNumber: number;
}): Promise<void> {
  const bundle = await getCostingBundle(input.quoteId);
  if (!bundle.ok) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Could not read the quote's costing to check it against the margin floor.",
    );
  }

  const belowFloor = bundle.data.costing.quoteRollup.filter(
    (r) => r.blendedMarginStatus === "BELOW_FLOOR",
  );
  // The ordinary path costs one bundle read and no authorization query.
  if (belowFloor.length === 0) return;

  const authorizations = await db
    .select({
      id: belowFloorAuthorizations.id,
      quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
      tierId: belowFloorAuthorizations.tierId,
      approvedByUserId: belowFloorAuthorizations.approvedByUserId,
      stateFingerprint: belowFloorAuthorizations.stateFingerprint,
      invalidatedAt: belowFloorAuthorizations.invalidatedAt,
    })
    .from(belowFloorAuthorizations)
    .where(eq(belowFloorAuthorizations.quoteId, input.quoteId));

  // The SAME evaluation the Customer View footer shows the operator. It used
  // to live here alone, and the footer answered the identical question with a
  // hand-rolled margin comparison that read no authorizations at all — so a
  // properly authorized quote was told to seek approval it already held, for a
  // send this gate would have allowed. One authority now; see
  // `below-floor-projection`.
  const projection = projectBelowFloorAuthorization({
    rollups: bundle.data.costing.quoteRollup,
    authorizations,
    quoteVersionNumber: input.quoteVersionNumber,
  });
  const refusals = projection.tiers
    .filter((t) => !t.ok)
    .map((t) => `${t.label} — ${t.message}`);

  if (refusals.length > 0) {
    // Every failing tier, not the first. An operator who fixes one and is then
    // refused for the next has been made to discover the work one item at a
    // time.
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Cannot send this quote below the firm's margin floor:\n${refusals.join("\n")}`,
    );
  }
}

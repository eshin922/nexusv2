import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { belowFloorAuthorizations } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { ActionGuardError, ERR } from "@/lib/action-result";
import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
} from "@/lib/below-floor-authorization";

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
 * ── SELF-APPROVAL IS CHECKED HERE TOO ────────────────────────────────────
 *
 * `actingUserId` is the person sending. `evaluateBelowFloorAuthorization`
 * measures independence against whoever commits the below-floor outcome, and
 * sending a below-floor price to a customer is committing it — an approver who
 * authorized the tier may not then be the one who puts it in front of the
 * client on their own authority.
 *
 * The same function, the same verdict, at a second commitment point. No second
 * implementation, and specifically no relaxed variant for send.
 */
export async function requireBelowFloorAuthorizedToSend(input: {
  quoteId: string;
  quoteVersionNumber: number;
  actingUserId: string;
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

  const refusals: string[] = [];
  for (const tier of belowFloor) {
    const verdict = evaluateBelowFloorAuthorization({
      authorizations,
      scope: {
        quoteVersionNumber: input.quoteVersionNumber,
        tierId: tier.tierId,
      },
      // Fingerprinted from THIS read, so an authorization is current against
      // the economics being sent rather than against some other snapshot.
      currentFingerprint: fingerprintCommercialState({
        totalRevenue: tier.totalRevenue,
        totalCost: tier.totalCost,
        blendedMarginPct: tier.blendedMarginPct,
      }),
      actingUserId: input.actingUserId,
    });
    if (!verdict.ok) refusals.push(`${tier.label} — ${verdict.message}`);
  }

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

import "server-only";

/**
 * The recovery workspace's server-side supersession read.
 *
 * ── THIS PREDICTS; IT DOES NOT INVALIDATE ───────────────────────────────
 *
 * BV-005's mechanism already works: an authorization is bound to one
 * fingerprint of the commercial state, and the send gate refuses once it
 * moves. Nothing here writes. This tells the operator BEFORE they commit what
 * that mechanism will do AFTER — because discovering it at the send gate is
 * discovering it too late to decide differently.
 *
 * ── AND IT COMPARES FINGERPRINTS, NEVER MODES ───────────────────────────
 *
 * The cheap version is a rule about modes: "warn when absorbed is involved".
 * It would be right nearly always, and being right nearly always is the
 * failure — a second definition of material change sitting beside the real one,
 * free to drift. `fingerprintCommercialState` says what material means once.
 *
 * That is why a revenue-neutral election produces no warning WITHOUT anyone
 * writing a rule that says included <-> separate is safe: the terms the
 * fingerprint is built from simply do not move.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { belowFloorAuthorizations } from "@/db/schema";
import { fingerprintCommercialState } from "@/lib/below-floor-authorization";
import {
  evaluateRecoverySupersession,
  supersessionMessage,
  type AuthorizationForWarning,
} from "./supersession";

/**
 * The warning to show on the recovery workspace, or null.
 *
 * `quoteRollup` must come from the SAME costing read the surface renders from.
 * A second read would be a second opinion about the economics, which is the
 * error this whole seam exists to remove.
 */
export async function loadRecoverySupersessionWarning(input: {
  quoteId: string;
  quoteVersionNumber: number;
  quoteRollup: readonly {
    tierId: string;
    totalRevenue: number;
    totalCost: number;
    blendedMarginPct: number | null;
  }[];
}): Promise<string | null> {
  const authorizations: AuthorizationForWarning[] = await db
    .select({
      tierId: belowFloorAuthorizations.tierId,
      quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
      stateFingerprint: belowFloorAuthorizations.stateFingerprint,
      invalidatedAt: belowFloorAuthorizations.invalidatedAt,
    })
    .from(belowFloorAuthorizations)
    .where(eq(belowFloorAuthorizations.quoteId, input.quoteId));

  // The ordinary path costs one query and stops.
  if (authorizations.length === 0) return null;

  // The CURRENT economics, fingerprinted the one governed way. An election
  // that moves them will move this; one that does not, will not.
  const projected = new Map(
    input.quoteRollup.map((t) => [
      t.tierId,
      fingerprintCommercialState({
        totalRevenue: t.totalRevenue,
        totalCost: t.totalCost,
        blendedMarginPct: t.blendedMarginPct,
      }),
    ]),
  );

  return supersessionMessage(
    evaluateRecoverySupersession({
      authorizations,
      quoteVersionNumber: input.quoteVersionNumber,
      projectedFingerprintByTier: projected,
    }),
  );
}

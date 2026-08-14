"use server";

/**
 * BV-005 1c — recording a governed below-floor authorization.
 *
 * Edward's Track A disposition, 2026-08-10. This is the ONLY writer of
 * `below_floor_authorizations`, and it is deliberately small: there is no
 * request, no routing, no Slack and no quorum. An authorized Commercial
 * Approver records a decision; `markAccepted` and `markComplete` consult it.
 *
 * The independence rule is NOT enforced here, and that is on purpose. Who ends
 * up recording acceptance is not known at authorization time — an approver may
 * legitimately authorize a deal someone else goes on to accept. Independence is
 * therefore a property of the GATE, evaluated against the acting user at the
 * moment the below-floor outcome is committed. See
 * `evaluateBelowFloorAuthorization`.
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  belowFloorAuthorizations,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import {
  fingerprintCommercialState,
  mayAuthorizeBelowFloor,
} from "@/lib/below-floor-authorization";

export interface AuthorizeBelowFloorInput {
  quoteId: string;
  tierId: string;
  reason: string;
}

/**
 * Record a below-floor authorization for one quote version and tier.
 *
 * Fails closed at every step: unknown quote or tier, missing authority, a tier
 * that is not actually below floor, or an empty reason all refuse. Authority is
 * read from the database at decision time rather than from anything the caller
 * supplies — a permission checked against a value the caller controls is not a
 * permission.
 */
export async function authorizeBelowFloor(
  input: AuthorizeBelowFloorInput,
): Promise<ActionResult<{ authorizationId: string }>> {
  return runAction(async () => {
    // THE NEXUS-UI BOUNDARY. A Clerk session establishes the actor here and
    // only here; the core below never authenticates, it is handed an already
    // established governed identity.
    const actor = await ensureUser();
    return authorizeBelowFloorAsUser({ ...input, actorUserId: actor.id });
  });
}

/**
 * The authorization core, with the actor supplied explicitly.
 *
 * WHY THIS EXISTS. A Slack callback carries no Clerk session, so `ensureUser()`
 * cannot establish who is deciding. Rather than weaken that function, the
 * caller establishes identity at its own boundary and passes the result in.
 *
 * THE CONTRACT ON `actorUserId`. It must already be an AUTHENTICATED governed
 * identity — for Slack that means a verified request signature, a Slack user
 * id, and a durable `users.slack_user_id` binding, in that order. This function
 * must never be reachable from a path where a caller can nominate an arbitrary
 * user id.
 *
 * Authority itself is NOT delegated: `commercialApprover` is still read from
 * the database here, at decision time, exactly as before. The refactor moves
 * where IDENTITY comes from, and nothing about what that identity is allowed
 * to do.
 */
export async function authorizeBelowFloorAsUser(
  input: AuthorizeBelowFloorInput & { actorUserId: string },
): Promise<{ authorizationId: string }> {
  {
    const actor = { id: input.actorUserId };

    const reason = input.reason?.trim() ?? "";
    if (reason === "") {
      // Mandatory per Edward's disposition. An approval without a why satisfies
      // an auditor and helps nobody read the deal a year later.
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A reason is required to authorize a below-floor tier.",
      );
    }

    // AUTHORITY AT DECISION TIME, from the governed permission alone. Not the
    // session, not the role — BV-005 forbids admin conferring this, and reading
    // the row here is what makes "at decision time" true rather than claimed.
    const [approver] = await db
      .select({
        id: users.id,
        commercialApprover: users.commercialApprover,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, actor.id))
      .limit(1);

    if (!approver || !mayAuthorizeBelowFloor(approver)) {
      throw new ActionGuardError(
        ERR.FORBIDDEN,
        "Commercial Approver authority is required to authorize a below-floor tier. Administrator access does not confer it.",
      );
    }

    const [quote] = await db
      .select({ id: quotes.id, versionNumber: quotes.versionNumber })
      .from(quotes)
      .where(eq(quotes.id, input.quoteId))
      .limit(1);
    if (!quote) throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found.");

    const [tier] = await db
      .select({ id: quoteTiers.id, label: quoteTiers.label })
      .from(quoteTiers)
      .where(and(eq(quoteTiers.id, input.tierId), eq(quoteTiers.quoteId, quote.id)))
      .limit(1);
    if (!tier) throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found on this quote.");

    // The commercial state, from the governed engine — the same rollup both
    // gates read. Authorizing against a number computed here would be a second
    // implementation of the quantity the floor is expressed in.
    const bundle = await getCostingBundle(quote.id);
    if (!bundle.ok) {
      throw new ActionGuardError(ERR.VALIDATION, "Could not read the quote's costing.");
    }
    const rollup = bundle.data.costing.quoteRollup.find((r) => r.tierId === tier.id);
    if (!rollup) {
      throw new ActionGuardError(ERR.VALIDATION, "No costing rollup for this tier.");
    }

    // Refuse to authorize a tier that does not need it. An authorization on a
    // compliant tier is a live permission nobody asked for, waiting for the
    // price to drop.
    if (rollup.blendedMarginStatus !== "BELOW_FLOOR") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `${tier.label} is not below the margin floor; no authorization is needed.`,
      );
    }

    const fingerprint = fingerprintCommercialState({
      totalRevenue: rollup.totalRevenue,
      totalCost: rollup.totalCost,
      blendedMarginPct: rollup.blendedMarginPct,
    });

    const [row] = await db
      .insert(belowFloorAuthorizations)
      .values({
        quoteId: quote.id,
        quoteVersionNumber: quote.versionNumber,
        tierId: tier.id,
        marginAtDecision: String(rollup.blendedMarginPct ?? 0),
        floorAtDecision: String(bundle.data.costing.firmSettings.floorMarginPct),
        stateFingerprint: fingerprint,
        approvedByUserId: approver.id,
        reason,
      })
      .returning({ id: belowFloorAuthorizations.id });

    await writeAuditEntry({
      userId: approver.id,
      entityType: "quote",
      entityId: quote.id,
      // Named after the TRANSITION, not the mechanism — CLAUDE.md's audit
      // naming discipline. The mechanism (which table, which fingerprint) lives
      // in diff_json and can change without the action name lying.
      action: "below_floor_authorized",
      summary: `Below-floor authorization recorded for ${tier.label}`,
      diffJson: {
        authorization_id: row.id,
        tier_id: tier.id,
        tier_label: tier.label,
        quote_version_number: quote.versionNumber,
        margin_at_decision: rollup.blendedMarginPct,
        floor_at_decision: bundle.data.costing.firmSettings.floorMarginPct,
        state_fingerprint: fingerprint,
        reason,
      },
    });

    revalidatePath(`/projects`, "layout");
    return { authorizationId: row.id };
  }
}

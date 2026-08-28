"use server";

/**
 * Component-owned one-time charges — the server actions.
 *
 * Thin by design. Everything they do lives in
 * `@/lib/component-charges/create`, which a governed gate script can call
 * directly; these resolve the operator and hand off.
 *
 * The auth guard is HERE and only here, which is what keeps it a guard: the
 * core is not a server action, and is reachable only from server code that has
 * already established who is acting.
 */

import { ensureUser } from "@/lib/auth/ensure-user";
import {
  createComponentChargesAs,
  deleteComponentChargeAs,
  type ComponentChargeDraft,
  type CreateComponentChargesResult,
} from "@/lib/component-charges/create";
import {
  updateComponentChargeAskAs,
  updateComponentChargeCostAs,
} from "@/lib/component-charges/update";
import type { ActionResult } from "@/lib/action-result";

export type { ComponentChargeDraft, CreateComponentChargesResult };

export async function createComponentCharges(input: {
  quoteId: string;
  quoteLeafId: string;
  charges: ComponentChargeDraft[];
}): Promise<ActionResult<CreateComponentChargesResult>> {
  const user = await ensureUser();
  return createComponentChargesAs(user.id, input);
}

export async function deleteComponentCharge(input: {
  quoteId: string;
  chargeInstanceId: string;
}): Promise<ActionResult<{ chargeInstanceId: string }>> {
  const user = await ensureUser();
  return deleteComponentChargeAs(user.id, input);
}

/**
 * ── THE COSTS DOOR ────────────────────────────────────────────────────────
 *
 * Economics only. These cannot create a charge, change its owner or its type,
 * or elect a recovery mode — Setup owns the first three and Commercial Recovery
 * owns the last. The narrowness is the boundary.
 */
export async function updateComponentChargeCost(input: {
  quoteId: string;
  chargeInstanceId: string;
  tierId: string;
  /** `null` clears the amount. A blank is absence, never zero. */
  cost: string | null;
}) {
  const user = await ensureUser();
  return updateComponentChargeCostAs(user.id, input);
}

export async function updateComponentChargeAsk(input: {
  quoteId: string;
  chargeInstanceId: string;
  tierId: string;
  ask: string | null;
}) {
  const user = await ensureUser();
  return updateComponentChargeAskAs(user.id, input);
}

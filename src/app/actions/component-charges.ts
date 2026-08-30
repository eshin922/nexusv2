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

/*
 * `updateComponentChargeAsk` STOOD HERE.
 *
 * It was the operator path for `quote_charge_instance_tiers.recovery_ask` --
 * a number typed on Costs that the engine then consumed as the charge's
 * recovery. Removed by the charge-type pricing-authority disposition (Edward,
 * 2026-08-29): "Costs owns governed cost; Pricing derives recovery from
 * charge-type authority."
 *
 * The action is DELETED rather than left unreachable. An exported server
 * action with no caller is exactly the shape the reachability guard exists to
 * catch -- and this codebase already shipped one (the ask writer itself, for a
 * whole phase). Leaving a second would re-create the condition the guard was
 * built for, in the same file.
 *
 * `updateComponentChargeAskAs` survives in `lib/component-charges/update.ts`
 * as a GATE-FIXTURE writer only; see the note there. The column is retained
 * and holds no non-null values.
 */

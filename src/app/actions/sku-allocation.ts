"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hubspotDealsCache, projects, quotes } from "@/db/schema";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  allocateSku,
  listAllocatableBrands,
  customerBrandState,
  type AllocationRefusal,
} from "@/lib/sku/allocation";

/**
 * The Auto-generate SKU surface.
 *
 * Refusals are RETURNED, not thrown. Every reason a SKU cannot be issued right
 * now is an ordinary, explainable state -- not enabled here, customer not
 * registered, counter not seeded -- and an operator is entitled to be told
 * which one it is. Throwing would collapse them into one failure.
 */

/**
 * What the control may offer, as a CLOSED SET of situations.
 *
 * ── WHY A UNION AND NOT A LIST PLUS A HINT ───────────────────────────────
 *
 * The previous shape was `{ brands, preselected, enabled }`: every caller got
 * the whole list of allocatable brands and a suggestion. In a customer quote
 * whose customer had no registered code, `preselected` was null and the list
 * was still there -- so the control rendered a dropdown of OTHER PEOPLE'S
 * brands beside a product belonging to this one. One wrong click filed a
 * product under a namespace that was not its customer's, and nothing in the
 * shape made that hard.
 *
 * Here the list exists only in `choose`, which is only ever returned when
 * there is no customer in context at all. In a quote the answer is the
 * quote's own customer or it is a refusal; there is no third branch for a
 * caller to reach for, and no fallback to invent.
 */
export type SkuBrandContext =
  /** Generation is off, or no brand is both approved and seeded. Render nothing. */
  | { kind: "unavailable" }
  /** The quote's customer has a registered code. One click, no chooser. */
  | { kind: "ready"; token: string; customerLabel: string }
  /**
   * A code exists for this customer but its starting number has not been
   * established, so nothing can be issued under it yet. Distinct from
   * `no_code` because the remedy is different: this one is waiting on the
   * inventory check, not on somebody entering a mnemonic.
   */
  | { kind: "awaiting_setup"; token: string; customerLabel: string }
  /**
   * There is a customer and it has no code at all. Manual entry is the path.
   * Setting a code is done in Settings; this state deliberately does NOT
   * offer to do it inline, and does not imply it would finish by itself.
   */
  | { kind: "no_code"; customerLabel: string | null }
  /** No customer in context -- the standalone Library. The operator chooses. */
  | { kind: "choose"; brands: { token: string; customerLabel: string }[] };

/**
 * What the button should offer on a given surface.
 *
 * `quoteId` present = creation from a customer quote, where the customer is
 * known and settles the namespace by itself. Absent = direct Library
 * creation, which has no customer in context: the operator picks from the
 * registered customers, and there is deliberately no default.
 */
export async function getSkuBrandContext(
  quoteId: string | null,
): Promise<ActionResult<SkuBrandContext>> {
  return runAction(async () => {
    await ensureUser();
    const brands = await listAllocatableBrands();
    // Checked FIRST, so a disabled environment reports itself as disabled
    // rather than as "your customer is not registered" -- two different
    // problems with two different remedies.
    if (brands.length === 0) return { kind: "unavailable" as const };

    if (!quoteId) {
      // The Library. Every registered customer, for the operator to search.
      return { kind: "choose" as const, brands };
    }

    // Resolve the customer RECORD behind this quote: quote -> project -> the
    // cached deal's associated company. The company id is the join, never the
    // client name -- a name is a label someone can retype differently
    // tomorrow, and matching on one is how a product lands under a namespace
    // that merely reads similarly.
    const [row] = await db
      .select({
        companyId: hubspotDealsCache.associatedCompanyId,
        companyName: hubspotDealsCache.associatedCompanyName,
        clientName: projects.clientName,
      })
      .from(quotes)
      .innerJoin(projects, eq(projects.id, quotes.projectId))
      .leftJoin(
        hubspotDealsCache,
        eq(hubspotDealsCache.dealId, projects.hubspotDealId),
      )
      .where(eq(quotes.id, quoteId))
      .limit(1);

    const state = await customerBrandState(row?.companyId ?? null);
    if (state.kind === "ready") {
      // The registry's own label, not the deal cache's. The registry is what
      // the code was adjudicated against, so it is what belongs beside it.
      return {
        kind: "ready" as const,
        token: state.token,
        customerLabel: state.customerLabel,
      };
    }
    if (state.kind === "awaiting_setup") {
      return {
        kind: "awaiting_setup" as const,
        token: state.token,
        customerLabel: state.customerLabel,
      };
    }

    // Named where it can be, so the operator can act on it -- "this customer
    // has no code" is useful, "some customer has no code" is not. Null when
    // the deal carries no associated company at all, which is a different
    // fact and is said differently by the control.
    return {
      kind: "no_code" as const,
      customerLabel: row?.companyName ?? row?.clientName ?? null,
    };
  });
}

export type GenerateResult =
  | { ok: true; sku: string; allocationId: string }
  | { ok: false; refusal: AllocationRefusal };

/**
 * Generate and reserve one SKU.
 *
 * `attemptKey` is the caller's identity for ONE creation intent, and the same
 * key returns the same allocation rather than consuming a second number. That
 * is what preserves a generated SKU across save retries: the value survives
 * because it is durable in `sku_allocations`, not because a component held it.
 *
 * The token still arrives from the caller and is still validated by
 * `allocateSku` against all three conditions. The UI no longer offers a
 * choice in a quote, but this action does not trust it for that -- a token
 * that is not approved and seeded is refused here regardless of which surface
 * sent it.
 */
export async function generateSku(
  formData: FormData,
): Promise<ActionResult<GenerateResult>> {
  return runAction(async () => {
    const user = await ensureUser();
    const token = String(formData.get("brandToken") ?? "").trim();
    const attemptKey = String(formData.get("attemptKey") ?? "").trim();
    if (attemptKey === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "An attempt key is required so a retry cannot consume a second number.",
      );
    }

    const outcome = await allocateSku({ token, attemptKey, userId: user.id });
    if (!outcome.ok) return { ok: false as const, refusal: outcome.refusal };
    return { ok: true as const, sku: outcome.sku, allocationId: outcome.allocationId };
  });
}

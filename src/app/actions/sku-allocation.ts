"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hubspotDealsCache, projects, quotes } from "@/db/schema";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  allocateSku,
  listAllocatableBrands,
  preselectBrandForCompany,
  type AllocationRefusal,
} from "@/lib/sku/allocation";

/**
 * The Auto-generate SKU surface.
 *
 * Refusals are RETURNED, not thrown. Every reason a SKU cannot be issued right
 * now is an ordinary, explainable state -- not enabled here, brand not
 * approved, counter not seeded -- and an operator is entitled to be told which
 * one it is. Throwing would collapse them into one failure.
 */

export type SkuBrandContext = {
  /** Brands that can actually issue today: approved AND seeded. */
  brands: { token: string; customerLabel: string }[];
  /** Preselected from the customer RECORD, or null meaning "ask". */
  preselected: string | null;
  enabled: boolean;
};

/**
 * What the button should offer on a given surface.
 *
 * `quoteId` present = creation from a customer quote, where the customer is
 * known and its registered brand preselects. Absent = direct Library creation,
 * which has no customer in context: the operator must choose, and there is
 * deliberately no default.
 */
export async function getSkuBrandContext(
  quoteId: string | null,
): Promise<ActionResult<SkuBrandContext>> {
  return runAction(async () => {
    await ensureUser();
    const brands = await listAllocatableBrands();
    if (brands.length === 0) {
      return { brands, preselected: null, enabled: false };
    }
    if (!quoteId) {
      // Library creation. No customer, therefore no preselection -- the one
      // case where guessing would silently file a product under whichever
      // brand happened to be first.
      return { brands, preselected: null, enabled: true };
    }

    // Resolve the customer RECORD behind this quote: quote -> project -> the
    // cached deal's associated company. The company id is the join, never the
    // client name.
    const [row] = await db
      .select({ companyId: hubspotDealsCache.associatedCompanyId })
      .from(quotes)
      .innerJoin(projects, eq(projects.id, quotes.projectId))
      .leftJoin(
        hubspotDealsCache,
        eq(hubspotDealsCache.dealId, projects.hubspotDealId),
      )
      .where(eq(quotes.id, quoteId))
      .limit(1);

    const preselected = await preselectBrandForCompany(row?.companyId ?? null);
    return { brands, preselected, enabled: true };
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


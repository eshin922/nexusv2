"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { quoteProductTierQuantities, quoteTiers, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { ActionGuardError, ERR, runAction } from "@/lib/action-result";
import { writeAuditEntry } from "@/lib/audit";
import { quoteForAssembly, quoteForQuoteLeaf, requireDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { parseOrderQuantity } from "@/lib/product-structure/order-quantity";

/** Null restores tier inheritance. This action never edits composition. */
export async function setProductTierQuantity(formData: FormData) {
  return runAction(async () => {
    const user = await ensureUser();
    const kind = String(formData.get("kind"));
    const ownerId = String(formData.get("ownerId") ?? "");
    const tierId = String(formData.get("tierId") ?? "");
    if (!ownerId || !tierId || !["assembly", "leaf"].includes(kind)) {
      throw new ActionGuardError(ERR.VALIDATION, "Choose a product and pricing tier.");
    }
    const { quote } = kind === "assembly"
      ? await quoteForAssembly(ownerId)
      : await quoteForQuoteLeaf(ownerId);
    if (kind === "leaf") {
      const { quoteLeaf } = await quoteForQuoteLeaf(ownerId);
      if (quoteLeaf.commercialKind !== "product") {
        throw new ActionGuardError(ERR.VALIDATION, "Set sub-quantity on the product that owns this service.");
      }
    }
    const [tier] = await db.select().from(quoteTiers).where(eq(quoteTiers.id, tierId)).limit(1);
    if (!tier || tier.quoteId !== quote.id) throw new ActionGuardError(ERR.VALIDATION, "This tier does not belong to the product's quote.");
    const raw = String(formData.get("quantity") ?? "").trim();
    let quantity: number | null = null;
    try { quantity = raw === "" ? null : parseOrderQuantity(raw); }
    catch (error) { throw new ActionGuardError(ERR.VALIDATION, (error as Error).message); }
    const ownerWhere = kind === "assembly"
      ? eq(quoteProductTierQuantities.assemblyId, ownerId)
      : eq(quoteProductTierQuantities.quoteLeafId, ownerId);
    await db.transaction(async (tx) => {
      // Serialize quantity edits with lifecycle transitions and other edits.
      const [locked] = await tx.select().from(quotes).where(eq(quotes.id, quote.id)).for("update");
      if (!locked) throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found.");
      requireDraft(locked);
      const [before] = await tx.select().from(quoteProductTierQuantities)
        .where(and(ownerWhere, eq(quoteProductTierQuantities.tierId, tierId)));
      if ((before?.quantity ?? null) === quantity) return;
      if (quantity === null) {
        await tx.delete(quoteProductTierQuantities).where(and(ownerWhere, eq(quoteProductTierQuantities.tierId, tierId)));
      } else if (before) {
        await tx.update(quoteProductTierQuantities).set({ quantity, updatedAt: new Date() }).where(eq(quoteProductTierQuantities.id, before.id));
      } else {
        await tx.insert(quoteProductTierQuantities).values({
          quoteId: quote.id, tierId, quantity,
          assemblyId: kind === "assembly" ? ownerId : null,
          quoteLeafId: kind === "leaf" ? ownerId : null,
        });
      }
      await writeAuditEntry({
        userId: user.id, entityType: kind === "assembly" ? "assembly" : "quote_leaf",
        entityId: ownerId, action: "product_tier_quantity_updated",
        diffJson: { quote_id: quote.id, tier_id: tierId, quantity: { from: before?.quantity ?? null, to: quantity } },
      }, tx);
    });
    revalidateQuoteTree(quote.projectId, quote.id);
    return { ownerId, tierId, quantity };
  });
}

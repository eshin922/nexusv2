"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { quoteLeaves } from "@/db/schema";
import { runAction, ActionGuardError, ERR, type ActionResult } from "@/lib/action-result";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import { quoteByIdDraft } from "@/lib/quote-guards";

/** Internal instruction on one quote-specific product, never a Library default. */
export async function updateSkuAccountingNote(
  formData: FormData,
): Promise<ActionResult<{ note: string | null }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const quoteLeafId = String(formData.get("quoteLeafId") ?? "").trim();
    const raw = String(formData.get("note") ?? "");
    const note = raw.trim() || null;
    if (note && note.length > 4000) {
      throw new ActionGuardError(ERR.VALIDATION, "Keep the accounting note under 4,000 characters.");
    }
    const quote = await quoteByIdDraft(quoteId);

    const [product] = await db
      .select({
        id: quoteLeaves.id,
        commercialKind: quoteLeaves.commercialKind,
        previous: quoteLeaves.accountingNote,
      })
      .from(quoteLeaves)
      .where(and(eq(quoteLeaves.id, quoteLeafId), eq(quoteLeaves.quoteId, quoteId)))
      .limit(1);
    if (!product || product.commercialKind !== "product") {
      throw new ActionGuardError(ERR.VALIDATION, "This SKU is not a product on this quote.");
    }
    if (product.previous === note) return { note };

    await db.update(quoteLeaves)
      .set({ accountingNote: note })
      .where(and(eq(quoteLeaves.id, quoteLeafId), eq(quoteLeaves.quoteId, quoteId)));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "sku_accounting_note_updated",
      // The text is internal prose. Record provenance without duplicating it
      // into the wider-read audit log.
      diffJson: {
        quote_leaf_id: quoteLeafId,
        quote_version: quote.versionNumber,
        from_present: product.previous !== null,
        to_present: note !== null,
        length: note?.length ?? 0,
      },
    });
    revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}/costs`);
    return { note };
  });
}

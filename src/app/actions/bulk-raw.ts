"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  bulkRawSectionMeta,
  quotes,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";

// Slice RI.4 — Bulk Raw schema actions. v1 ships:
//   - setRawsMode: writes bulk_raw_section_meta.raws_mode (drives
//     Bulk Raw section visibility + cost-stack RAW row)
//   - Categories + ingredients CRUD actions: scaffolded as
//     placeholders; full implementation in RI.4 follow-up sub-slice.

export async function setRawsMode(
  formData: FormData,
): Promise<ActionResult<{ quoteId: string; rawsMode: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const rawsMode = String(formData.get("rawsMode") ?? "").trim();
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!["cm_sources", "dps_sources", "customer_supplies"].includes(rawsMode))
      throw new ActionGuardError(ERR.VALIDATION, "invalid rawsMode");

    const user = await ensureUser();
    const quote = await quoteByIdDraft(quoteId);

    // UPSERT bulk_raw_section_meta. Composite key = quote_id (the PK
    // is just quote_id; one row per quote).
    const existing = await db
      .select()
      .from(bulkRawSectionMeta)
      .where(eq(bulkRawSectionMeta.quoteId, quoteId))
      .limit(1);
    const previousMode = existing[0]?.rawsMode ?? "cm_sources";

    if (previousMode === rawsMode) {
      // No-op
      return { quoteId, rawsMode };
    }

    await db.execute(sql`
      INSERT INTO bulk_raw_section_meta (quote_id, raws_mode)
      VALUES (${quoteId}, ${rawsMode}::raws_mode)
      ON CONFLICT (quote_id) DO UPDATE
      SET raws_mode = excluded.raws_mode,
          updated_at = now()
    `);

    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "bulk_raw_section_meta",
      entityId: quoteId,
      action: "raws_mode_updated",
      diffJson: {
        raws_mode: { from: previousMode, to: rawsMode },
      },
      summary: `Raws mode changed from ${previousMode} to ${rawsMode}`,
    });

    revalidatePath(`/projects/${quote.projectId}/quotes/${quoteId}/costs`);

    return { quoteId, rawsMode };
  });
}

"use server";

/**
 * The authored instruction to Accounting — its own module, on purpose.
 *
 * ── WHY IT IS NOT IN `presentation-profile.ts` ───────────────────────────
 *
 * It started there, because it is edited on the same card and guarded the same
 * way. A test refused it: "these actions write presentation state and nothing
 * else" caught the `.update(quotes)` this needs, and it was right to.
 *
 * The presentation actions write PRESENTATION facts. This writes a QUOTE fact.
 * Housing them together made the boundary a matter of reading carefully rather
 * than of where the code lives, and the convenience that motivated it — one
 * fewer file — is not worth a boundary that has to be remembered.
 *
 * The rule the test protects is the same one that kept `customer_note` off the
 * profile and the recommendation on `quote_tiers`: one fact, one owner, and the
 * owner is visible from where the write happens.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  assertNotFrozen,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";

/**
 * It lives on the quote, because it is a quote fact: written once for this
 * commercial agreement, inherited on acceptance, and read by whoever books it.
 * The presentation profile decides what the CUSTOMER sees, and this is the one
 * field on Card 3 the customer must never see.
 *
 * ── FROZEN WITH THE QUOTE ────────────────────────────────────────────────
 *
 * `quoteByIdDraft` again. Accounting acts on this after acceptance, and an
 * instruction still editable then would let the booking instruction drift from
 * the quote it was written for — the customer note's defect, one audience over.
 * `sendQuote` copies it into the version's snapshot.
 */
export async function updateAccountingInstruction(
  formData: FormData,
): Promise<ActionResult<{ instruction: string | null }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const raw = String(formData.get("accountingInstruction") ?? "");
    // Trimmed to null rather than stored as "". An empty instruction and no
    // instruction are the same thing to a reader, and only one of them should
    // exist in the column.
    const instruction = raw.trim().length === 0 ? null : raw;

    const quote = await quoteByIdDraft(quoteId);
    assertNotFrozen(quote);

    if ((quote.accountingInstruction ?? null) === instruction) {
      return { instruction };
    }

    await db
      .update(quotes)
      .set({ accountingInstruction: instruction, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "accounting_instruction_updated",
      // The TEXT is not in the audit row. It is free-form internal prose that
      // may name people and commercial circumstances, and an audit log is a
      // wider readership than the field itself. Presence, length and the
      // transition are what a forensic reader needs.
      diffJson: {
        quote_version: quote.versionNumber,
        from_present: quote.accountingInstruction !== null,
        to_present: instruction !== null,
        length: instruction?.length ?? 0,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { instruction };
  });
}

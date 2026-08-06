"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  quoteReviewEvents,
  quoteReviewEventType,
  quotes,
} from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import { requireRevisable } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Slice 12 Step 6b — Client Review feed writes.
//
// PM adds a `responded` / `asked` / `revision_requested` entry to the
// review log. System-generated 'sent' entries are written elsewhere
// (Step 5b's sendQuote path); PMs never author them. The DB pgEnum
// carries all four values but the client-side add form only exposes
// the three PM-authored ones.
//
// Guards (v3 brief §5.1 Round 3 amendment 1 + §4.1 reversibility):
//   - requireRevisable: quote must be sent | accepted. Feed is
//     meaningful only post-send; complete quotes are locked
//     (Pattern 52); draft quotes have nothing to review yet;
//     superseded/lost are terminal off-happy-path states.
//
// Write shape (matches Step 5b system-write for consistency):
//   1. INSERT quote_review_events (versionNumber = current
//      quote.versionNumber; author = signed-in PM; system = false)
//   2. INSERT audit_log (action = 'quote_review_event_added';
//      diff_json carries the feed content + audit_source = 'pm_add'
//      per Slice 9.2 namespace convention to discriminate from
//      Step 5b's system sends). Mirror-to-audit per v3 R3 amend 1.

// Only PM-authorable event types (excludes 'sent' which is
// system-only). Runtime narrowing via the pgEnum re-export.
const PM_EVENT_TYPES = ["responded", "asked", "revision_requested"] as const;
type PmEventType = (typeof PM_EVENT_TYPES)[number];

function isPmEventType(v: unknown): v is PmEventType {
  return typeof v === "string" && PM_EVENT_TYPES.includes(v as PmEventType);
}

// Belt-and-braces: also confirm the value is a valid pgEnum member
// (guards against future enum extensions that shouldn't be PM-authored).
void quoteReviewEventType; // keep import-graph reference; type-only use

export async function addQuoteReviewEvent(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const eventTypeRaw = String(formData.get("eventType") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();

    if (!quoteId) {
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    }
    if (!isPmEventType(eventTypeRaw)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Unknown event type '${eventTypeRaw}'. PM-authorable types: ${PM_EVENT_TYPES.join(", ")}.`,
      );
    }
    if (note.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Note is required — the log needs the substance of what happened.",
      );
    }
    // Prevent runaway notes; text column is unbounded but 4000 char
    // is a soft product limit (a novel doesn't belong in a feed row).
    if (note.length > 4000) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Note too long (max 4000 characters).",
      );
    }

    const user = await ensureUser();

    // Load quote for the guard + versionNumber snapshot.
    const [quote] = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) {
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");
    }
    requireRevisable(quote); // sent | accepted only

    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(quoteReviewEvents)
        .values({
          quoteId,
          versionNumber: quote.versionNumber,
          eventType: eventTypeRaw,
          note,
          authorUserId: user.id,
          system: false,
        })
        .returning({ id: quoteReviewEvents.id });

      // Mirror to audit_log per v3 §5.1 R3 amendment 1. Slice 9.2
      // namespace convention: source='pm_add' discriminates from
      // Step 5b's system sends which omit the source key.
      await writeAuditEntry({
        userId: user.id,
        entityType: "quote_review_event",
        entityId: inserted.id,
        action: "quote_review_event_added",
        diffJson: {
          quoteId,
          versionNumber: quote.versionNumber,
          eventType: eventTypeRaw,
          system: false,
          note,
          source: "pm_add",
        },
      }, tx);

      return inserted;
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { id: result.id };
  });
}

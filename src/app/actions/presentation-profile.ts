"use server";

/**
 * The customer presentation profile — the only writer.
 *
 * ── WHAT THESE ACTIONS ARE ALLOWED TO CHANGE ─────────────────────────────
 *
 * One row in `presentation_profile`, or one in `presentation_profile_tier`,
 * for the quote's CURRENT version. Nothing else.
 *
 * In particular they do not write:
 *
 *   - `quote_tiers.recommended` — the recommendation is a QUOTE fact with its
 *     own action and its own audit trail. Card 2 edits it there.
 *   - `quotes.customer_facing_notes` — the note's CONTENT is a quote fact too.
 *     `include_note` decides whether it prints; it never decides what it says.
 *
 * Both were live questions during the disposition, and both were settled the
 * same way: a second column for either would have given one customer-facing
 * fact two owners with nothing in the schema saying which one the customer
 * receives. See docs/g4-presentation-profile-disposition.md §2 and
 * docs/g4-schema-verification.md M1.
 *
 * ── PATTERN 52 · A SENT QUOTE REFUSES ────────────────────────────────────
 *
 * `quoteByIdDraft` — STRICTER than `assertNotFrozen`, and deliberately so.
 * These fields decide what the customer document SHOWS, and they are frozen
 * into the send snapshot. If a sent quote could still edit them, the record of
 * what the customer saw would become editable after they saw it.
 *
 * `assertNotFrozen` is ALSO called, redundantly and on purpose: the Slice 13
 * §0.5 protocol is a grep for that symbol, and a writer that satisfies the
 * rule through a stronger-but-differently-named guard is invisible to the
 * check that exists to find it.
 *
 * ── VERSION ──────────────────────────────────────────────────────────────
 *
 * Every write addresses `(quote_id, quote.version_number)` — the CURRENT
 * version, read from the quote inside the same call. A revision bumps that
 * number and copies the profile forward, so edits after a revision land on the
 * new row and cannot reach the record the customer already saw.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  presentationProfile,
  presentationProfileTier,
  quoteTiers,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  assertNotFrozen,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteByIdDraft } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";

/** The include-* flags, and nothing that is not one. */
const INCLUDE_FIELDS = [
  "includeFeeLines",
  "includeTerms",
  "includeAddendum",
  "includeNote",
] as const;
type IncludeField = (typeof INCLUDE_FIELDS)[number];

export type PresentationProfileRow = typeof presentationProfile.$inferSelect;

/**
 * Read-or-create the profile for a quote's current version.
 *
 * Creation is not a decision: the row it writes is every column's default,
 * which is exactly what the surface renders for a quote with no row. It exists
 * so a first edit has something to update, and so the two paths cannot drift.
 */
async function currentProfile(
  tx: typeof db,
  quoteId: string,
  version: number,
): Promise<PresentationProfileRow> {
  const [existing] = await tx
    .select()
    .from(presentationProfile)
    .where(
      and(
        eq(presentationProfile.quoteId, quoteId),
        eq(presentationProfile.quoteVersion, version),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(presentationProfile)
    .values({ quoteId, quoteVersion: version })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a concurrent first write; the other one's row is as good
  // as this one's would have been.
  const [raced] = await tx
    .select()
    .from(presentationProfile)
    .where(
      and(
        eq(presentationProfile.quoteId, quoteId),
        eq(presentationProfile.quoteVersion, version),
      ),
    )
    .limit(1);
  if (!raced) {
    throw new ActionGuardError(
      ERR.NOT_FOUND,
      "The presentation profile could not be read or created.",
    );
  }
  return raced;
}

/** Toggle one include-* flag. */
export async function updatePresentationInclude(
  formData: FormData,
): Promise<ActionResult<{ field: IncludeField; value: boolean }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const field = String(formData.get("field") ?? "").trim() as IncludeField;
    const value = String(formData.get("value") ?? "") === "true";

    if (!INCLUDE_FIELDS.includes(field)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Unknown presentation field: ${field}`,
      );
    }

    const quote = await quoteByIdDraft(quoteId);
    assertNotFrozen(quote);

    const before = await currentProfile(db, quoteId, quote.versionNumber);
    if (before[field] === value) {
      return { field, value };
    }

    await db
      .update(presentationProfile)
      .set({ [field]: value, updatedByUserId: user.id, updatedAt: new Date() })
      .where(eq(presentationProfile.id, before.id));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "presentation_profile_updated",
      diffJson: {
        quote_version: quote.versionNumber,
        field,
        from: before[field],
        to: value,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { field, value };
  });
}

/**
 * Set layout and, when single-tier, which tier is presented.
 *
 * The two move together because the database refuses them apart: a single-tier
 * layout with no presented tier is a document with no prices on it, and the
 * CHECK says so. Passing them in one call means the surface cannot construct
 * the refused state by doing one write and then the other.
 */
export async function updatePresentationLayout(
  formData: FormData,
): Promise<ActionResult<{ layout: string; presentedTierId: string | null }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const layout = String(formData.get("layout") ?? "").trim();
    const rawTier = String(formData.get("presentedTierId") ?? "").trim();
    const presentedTierId = rawTier === "" ? null : rawTier;

    if (layout !== "tier_table" && layout !== "single_tier") {
      throw new ActionGuardError(ERR.VALIDATION, `Unknown layout: ${layout}`);
    }
    if (layout === "single_tier" && presentedTierId === null) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A single-tier document must name the tier it presents.",
      );
    }

    const quote = await quoteByIdDraft(quoteId);
    assertNotFrozen(quote);

    // The tier must belong to THIS quote. Without this a presented tier could
    // name another quote's row — the FK alone does not say whose.
    if (presentedTierId !== null) {
      const [tier] = await db
        .select({ id: quoteTiers.id })
        .from(quoteTiers)
        .where(
          and(eq(quoteTiers.id, presentedTierId), eq(quoteTiers.quoteId, quoteId)),
        )
        .limit(1);
      if (!tier) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "That tier does not belong to this quote.",
        );
      }
    }

    const before = await currentProfile(db, quoteId, quote.versionNumber);

    await db
      .update(presentationProfile)
      .set({
        layout: layout as PresentationProfileRow["layout"],
        // Cleared when returning to tier_table: a presented tier on a
        // tier-table document is a stale answer to a question nobody asked.
        presentedTierId: layout === "single_tier" ? presentedTierId : null,
        updatedByUserId: user.id,
        updatedAt: new Date(),
      })
      .where(eq(presentationProfile.id, before.id));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "presentation_profile_updated",
      diffJson: {
        quote_version: quote.versionNumber,
        field: "layout",
        from: { layout: before.layout, presented_tier_id: before.presentedTierId },
        to: { layout, presented_tier_id: layout === "single_tier" ? presentedTierId : null },
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { layout, presentedTierId };
  });
}

/** Set the document's detail level — itemized, or turnkey-only. */
export async function updatePresentationDetail(
  formData: FormData,
): Promise<ActionResult<{ detailLevel: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const detailLevel = String(formData.get("detailLevel") ?? "").trim();

    if (detailLevel !== "itemized" && detailLevel !== "turnkey_only") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Unknown detail level: ${detailLevel}`,
      );
    }

    const quote = await quoteByIdDraft(quoteId);
    assertNotFrozen(quote);

    const before = await currentProfile(db, quoteId, quote.versionNumber);
    if (before.detailLevel === detailLevel) return { detailLevel };

    await db
      .update(presentationProfile)
      .set({
        detailLevel: detailLevel as PresentationProfileRow["detailLevel"],
        updatedByUserId: user.id,
        updatedAt: new Date(),
      })
      .where(eq(presentationProfile.id, before.id));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "presentation_profile_updated",
      diffJson: {
        quote_version: quote.versionNumber,
        field: "detail_level",
        from: before.detailLevel,
        to: detailLevel,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { detailLevel };
  });
}

/**
 * Show or hide one tier on the customer document.
 *
 * ABSENCE MEANS SHOWN, so showing a tier DELETES its row rather than writing
 * `shown = true`. That keeps one representation of the default: a tier added
 * to a quote tomorrow is presented without anyone writing a row to say so, and
 * there is no way for the table to disagree with itself about what "no row"
 * means.
 */
export async function updatePresentationTierShown(
  formData: FormData,
): Promise<ActionResult<{ tierId: string; shown: boolean }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    const shown = String(formData.get("shown") ?? "") === "true";

    const quote = await quoteByIdDraft(quoteId);
    assertNotFrozen(quote);

    const [tier] = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(and(eq(quoteTiers.id, tierId), eq(quoteTiers.quoteId, quoteId)))
      .limit(1);
    if (!tier) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "That tier does not belong to this quote.",
      );
    }

    // The last visible tier cannot be hidden. A customer document with no
    // priced column is not a quote, and the operator who did it would have no
    // way to see what they had done.
    if (!shown) {
      const all = await db
        .select({ id: quoteTiers.id })
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quoteId));
      const hidden = await db
        .select({ tierId: presentationProfileTier.tierId })
        .from(presentationProfileTier)
        .where(
          and(
            eq(presentationProfileTier.quoteId, quoteId),
            eq(presentationProfileTier.quoteVersion, quote.versionNumber),
            eq(presentationProfileTier.shown, false),
          ),
        );
      const hiddenIds = new Set(hidden.map((h) => h.tierId));
      hiddenIds.add(tierId);
      if (all.every((t) => hiddenIds.has(t.id))) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          "At least one tier has to stay on the customer document.",
        );
      }
    }

    if (shown) {
      await db
        .delete(presentationProfileTier)
        .where(
          and(
            eq(presentationProfileTier.quoteId, quoteId),
            eq(presentationProfileTier.quoteVersion, quote.versionNumber),
            eq(presentationProfileTier.tierId, tierId),
          ),
        );
    } else {
      await db
        .insert(presentationProfileTier)
        .values({
          quoteId,
          quoteVersion: quote.versionNumber,
          tierId,
          shown: false,
        })
        .onConflictDoUpdate({
          target: [
            presentationProfileTier.quoteId,
            presentationProfileTier.quoteVersion,
            presentationProfileTier.tierId,
          ],
          set: { shown: false, updatedAt: new Date() },
        });
    }

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "presentation_tier_visibility_updated",
      diffJson: { quote_version: quote.versionNumber, tier_id: tierId, shown },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
    return { tierId, shown };
  });
}

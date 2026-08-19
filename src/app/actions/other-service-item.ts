"use server";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assemblies,
  quoteLeaves,
  quoteOtherServiceItems,
  quotes,
} from "@/db/schema";
import { ERR, ActionGuardError, runAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { writeAuditEntry } from "@/lib/audit";
import { revalidateQuoteTree } from "@/lib/revalidate";

/**
 * Choose the NetSuite item for an `OTC - Other Service` line.
 *
 * The one BV-011 destination with no firm-wide record. It is the catch-all, so
 * two quotes can use it for unrelated charges — which is why 0081 refuses it a
 * firm row by CHECK, and why the operator's choice here IS the governance for
 * this line.
 *
 * Consequences of that, both deliberate:
 *
 *   · the selection is DRAFT-ONLY. It is frozen at send, so changing it after
 *     send would rewrite what a sent quote posts.
 *   · the entered code is RESOLVED against NetSuite before it is stored, using
 *     the same resolver the admin mapping surface uses. Two resolvers would be
 *     two answers to "which item is this" (Pattern 58).
 */

type Owner =
  | { kind: "assembly"; id: string }
  | { kind: "quote_leaf"; id: string };

function readOwner(formData: FormData): Owner {
  const assemblyId = String(formData.get("assemblyId") ?? "").trim();
  const quoteLeafId = String(formData.get("quoteLeafId") ?? "").trim();
  if (Boolean(assemblyId) === Boolean(quoteLeafId)) {
    // Exactly one, matching the DB's XOR. Accepting both would let a caller
    // create a row whose owner is ambiguous; accepting neither would create an
    // orphan selection nothing can read.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "A selection belongs to exactly one owner — an Item Group or a Direct Service line.",
    );
  }
  return assemblyId
    ? { kind: "assembly", id: assemblyId }
    : { kind: "quote_leaf", id: quoteLeafId };
}

/** The owner's quote, and a refusal if the quote is no longer a draft. */
async function requireDraftQuoteFor(
  owner: Owner,
): Promise<{ quoteId: string; projectId: string }> {
  const [row] =
    owner.kind === "assembly"
      ? await db
          .select({
            quoteId: assemblies.quoteId,
            projectId: quotes.projectId,
            status: quotes.status,
          })
          .from(assemblies)
          .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
          .where(eq(assemblies.id, owner.id))
      : await db
          .select({
            quoteId: quoteLeaves.quoteId,
            projectId: quotes.projectId,
            status: quotes.status,
          })
          .from(quoteLeaves)
          .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId))
          .where(eq(quoteLeaves.id, owner.id));

  if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Line not found.");
  if (row.status !== "draft") {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "This quote has been sent. Its Other Service item was frozen at send — revise the quote to change it.",
    );
  }
  return { quoteId: row.quoteId, projectId: row.projectId };
}

const ownerFilter = (owner: Owner) =>
  owner.kind === "assembly"
    ? and(
        eq(quoteOtherServiceItems.assemblyId, owner.id),
        isNull(quoteOtherServiceItems.quoteLeafId),
      )
    : and(
        eq(quoteOtherServiceItems.quoteLeafId, owner.id),
        isNull(quoteOtherServiceItems.assemblyId),
      );

export async function setOtherServiceItem(
  formData: FormData,
): Promise<ActionResult<{ itemCode: string; internalId: string }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const owner = readOwner(formData);
    const { quoteId, projectId } = await requireDraftQuoteFor(owner);

    const itemCode = String(formData.get("netsuiteItemCode") ?? "").trim();
    if (!itemCode) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Enter the NetSuite item code for this Other Service charge.",
      );
    }

    const { netsuite } = await getApplicationDependencies();
    const resolution = await netsuite.resolveItem(itemCode);
    if (resolution.status === "not_found") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `No active NetSuite item has the code "${itemCode}". Nothing was saved.`,
      );
    }
    if (resolution.status === "ambiguous") {
      // Never first-match: picking one silently posts the wrong item.
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${itemCode}" matches more than one NetSuite item (${resolution.matches
          .map((c) => `${c.itemid} · id ${c.netsuiteItemId}`)
          .join("; ")}). Use a code that identifies one item — nothing was saved.`,
      );
    }

    const [prior] = await db
      .select()
      .from(quoteOtherServiceItems)
      .where(ownerFilter(owner))
      .limit(1);

    if (prior) {
      await db
        .update(quoteOtherServiceItems)
        .set({
          netsuiteItemCode: resolution.sku,
          netsuiteInternalId: resolution.netsuiteItemId,
          selectedAt: new Date(),
          selectedByUserId: user.id,
        })
        .where(eq(quoteOtherServiceItems.id, prior.id));
    } else {
      await db.insert(quoteOtherServiceItems).values({
        quoteId,
        assemblyId: owner.kind === "assembly" ? owner.id : null,
        quoteLeafId: owner.kind === "quote_leaf" ? owner.id : null,
        netsuiteItemCode: resolution.sku,
        netsuiteInternalId: resolution.netsuiteItemId,
        selectedByUserId: user.id,
      });
    }

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "other_service_item_selected",
      diffJson: {
        owner_kind: owner.kind,
        owner_id: owner.id,
        from: prior
          ? { item_code: prior.netsuiteItemCode, internal_id: prior.netsuiteInternalId }
          : null,
        to: { item_code: resolution.sku, internal_id: resolution.netsuiteItemId },
      },
    });

    revalidateQuoteTree(projectId, quoteId);
    return { itemCode: resolution.sku, internalId: resolution.netsuiteItemId };
  });
}

export async function clearOtherServiceItem(
  formData: FormData,
): Promise<ActionResult<{ cleared: boolean }>> {
  return runAction(async () => {
    const user = await ensureUser();
    const owner = readOwner(formData);
    const { quoteId, projectId } = await requireDraftQuoteFor(owner);

    const [prior] = await db
      .select()
      .from(quoteOtherServiceItems)
      .where(ownerFilter(owner))
      .limit(1);
    if (!prior) return { cleared: false };

    // Deleted rather than blanked: the absence of the row is how "not chosen"
    // is represented, and a row with empty ids would be a third state.
    await db
      .delete(quoteOtherServiceItems)
      .where(eq(quoteOtherServiceItems.id, prior.id));

    await writeAuditEntry({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "other_service_item_cleared",
      diffJson: {
        owner_kind: owner.kind,
        owner_id: owner.id,
        from: {
          item_code: prior.netsuiteItemCode,
          internal_id: prior.netsuiteInternalId,
        },
      },
    });

    revalidateQuoteTree(projectId, quoteId);
    return { cleared: true };
  });
}

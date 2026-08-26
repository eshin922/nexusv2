"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaves, quoteLeaves, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { writeAuditEntry } from "@/lib/audit";
import {
  ActionGuardError,
  ERR,
  runAction,
  assertDraft,
  type ActionResult,
} from "@/lib/action-result";
import { materializePackagingRows } from "@/lib/packaging-materialization";
import {
  loadAttachmentDependents,
  describeDependents,
  type AttachmentDependents,
} from "@/lib/product-structure/attachment-dependents";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";
import {
  attachDirectProduct as attachDirectProductRow,
  detachDirectProduct as detachDirectProductRow,
  DirectAttachmentConflictError,
} from "@/lib/product-structure/direct-attachment";

async function loadQuoteOrThrow(quoteId: string) {
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.QUOTE_NOT_FOUND, "Quote not found");
  return rows[0];
}

/**
 * Quote → Add Product. Attaches a library product DIRECTLY to the quote, with
 * no Item Group.
 *
 * The peer of `createAssembly` + `attachAssemblyLeaf`, never a step on the way
 * to them: this action creates no assembly under any circumstance, including
 * when the quote ends up with exactly one Direct Product. Wrapping it would
 * change what the customer's Sales Order says (SO2704 shows a one-product Item
 * Group printing as a named container with a nested line), so the operator's
 * choice is preserved literally.
 */
export async function attachQuoteProduct(
  formData: FormData,
): Promise<ActionResult<{ quoteLeafId: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const leafId = String(formData.get("leafId") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "1").trim();

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!leafId) throw new ActionGuardError(ERR.VALIDATION, "leafId required");

    const user = await ensureUser();

    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    const leafRows = await db
      .select()
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);
    if (leafRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Product not found");

    // Same predicate the grouped path uses. One gate, so the two attachment
    // routes cannot diverge on what is attachable. The destination is passed
    // explicitly because the service prohibition (BV-012 §5.c) applies to one
    // route and not the other.
    const eligibility = evaluateAttachmentEligibility(leafRows[0], "direct");
    if (!eligibility.attachable) {
      throw new ActionGuardError(ERR.VALIDATION, eligibility.message);
    }

    // Auto-position = max + 1 among this quote's Direct Products.
    const posRow = await db
      .select({
        maxPos: sql<number>`coalesce(max(${quoteLeaves.position}), -1)::int`,
      })
      .from(quoteLeaves)
      .where(
        and(eq(quoteLeaves.quoteId, quoteId), isNull(quoteLeaves.assemblyId)),
      );
    const nextPosition = (posRow[0]?.maxPos ?? -1) + 1;

    let attached;
    try {
      attached = await db.transaction(async (tx) => {
        const row = await attachDirectProductRow(tx, {
          createdBy: user.id,
          quoteId,
          leafId,
          quantity: quantityRaw === "" ? "1" : quantityRaw,
          position: nextPosition,
        });
        await writeAuditEntry(
          {
            userId: user.id,
            entityType: "quote_leaf",
            entityId: row.quoteLeafId,
            action: "quote_product_attach",
            diffJson: {
              quote_id: quoteId,
              leaf_id: leafId,
              quote_leaf_id: row.quoteLeafId,
              quantity: row.quantity,
              position: row.position,
              // Recorded explicitly rather than implied by the absence of an
              // assembly_id, so a reader of the log sees the operator's choice
              // rather than having to infer it from a missing field.
              structure: "direct",
            },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      if (error instanceof DirectAttachmentConflictError) {
        throw new ActionGuardError(ERR.VALIDATION, error.message);
      }
      throw error;
    }

    // Setup owns packaging structure, so attaching a product here is what brings
    // its priced rows into existence. Materialization enumerates `quote_leaves`
    // directly (OD-017), so a Direct Product needs no special case.
    await db.transaction(async (tx) => {
      await materializePackagingRows(tx, quoteId);
    });

    revalidateQuoteTree(quote.projectId, quoteId);

    return { quoteLeafId: attached.quoteLeafId };
  });
}

/**
 * What removing this attachment would destroy.
 *
 * Called when the operator asks to remove, BEFORE they confirm — the one
 * moment the answer can still change what they do. Reads only.
 *
 * On demand rather than per-render: a page carrying twenty attachments would
 * pay twenty of these to answer a question about the one row somebody
 * eventually clicks, and the answer is only wanted at the click.
 *
 * Failure is NOT silence. A count that could not be read must not present as
 * "nothing at risk", so the caller receives `null` for the sentence and states
 * that the check could not run — never an unqualified Confirm.
 */
export async function describeAttachmentRemoval(
  formData: FormData,
): Promise<
  ActionResult<{ sentence: string | null; dependents: AttachmentDependents }>
> {
  return runAction(async () => {
    const quoteLeafId = String(formData.get("quoteLeafId") ?? "").trim();
    if (!quoteLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteLeafId required");
    await ensureUser();
    const dependents = await loadAttachmentDependents(quoteLeafId);
    return { sentence: describeDependents(dependents), dependents };
  });
}

/** Quote → remove a Direct Product. Grouped members detach via `detachAssemblyLeaf`. */
export async function detachQuoteProduct(
  formData: FormData,
): Promise<ActionResult<{ quoteLeafId: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const quoteLeafId = String(formData.get("quoteLeafId") ?? "").trim();

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!quoteLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteLeafId required");

    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    const user = await ensureUser();

    let detached;
    try {
      detached = await db.transaction(async (tx) => {
        const row = await detachDirectProductRow(tx, { quoteId, quoteLeafId });
        if (!row) {
          throw new ActionGuardError(
            ERR.NOT_FOUND,
            "Direct Product not found on this quote.",
          );
        }
        await writeAuditEntry(
          {
            userId: user.id,
            entityType: "quote_leaf",
            entityId: row.quoteLeafId,
            action: "quote_product_detach",
            diffJson: {
              quote_id: quoteId,
              leaf_id: row.leafId,
              quote_leaf_id: row.quoteLeafId,
              quantity: row.quantity,
              position: row.position,
              structure: "direct",
            },
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      if (error instanceof DirectAttachmentConflictError) {
        throw new ActionGuardError(ERR.VALIDATION, error.message);
      }
      throw error;
    }

    revalidateQuoteTree(quote.projectId, quoteId);

    return { quoteLeafId: detached.quoteLeafId };
  });
}

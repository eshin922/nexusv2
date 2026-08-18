"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblyProductionInputs,
  leaves,
  quoteLeaves,
  quoteTiers,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteForQuoteLeaf } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  DIRECT_SERVICE_LABELS,
  DIRECT_SERVICE_PRODUCTION_INPUT,
  DIRECT_SERVICE_PRODUCTION_LABEL,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";

/**
 * Author the ONE governed Production input a Direct Service exposes.
 *
 * ── WHY THIS IS NOT A PARAMETER ON THE ITEM GROUP ACTION ──────────────────
 *
 * `upsertAssemblyProductionInputs` accepts a `changedField` naming one of
 * eight columns. Widening it to accept a leaf owner would mean a caller could
 * name `bulkRawCost` on a service — which the disposition forbids, and which
 * no amount of validation inside an eight-column action expresses as well as
 * an action that has no such parameter.
 *
 * **The client never names the column here.** It sends a value; the SERVICE
 * IDENTITY on the library leaf decides where that value lands, via
 * `DIRECT_SERVICE_PRODUCTION_INPUT`. So "a Direct Service cannot author Bulk
 * Raw" is not a rule this action enforces — it is a sentence this action
 * cannot express.
 *
 * ── THREE DEFENCES, NONE LOAD-BEARING ALONE ───────────────────────────────
 *
 *  1. the column is derived from identity here, never supplied;
 *  2. the leaf must be service-classified, asserted below for the operator
 *     sentence a constraint cannot produce;
 *  3. the database refuses a non-service owner outright, via the composite FK
 *     on (quote_leaf_id, owner_commercial_kind) — migration 0082.
 */

type ServiceLeafContext = {
  quoteId: string;
  projectId: string;
  serviceIdentity: DirectServiceIdentity;
  label: string;
};

async function requireDirectServiceLeaf(
  quoteLeafId: string,
): Promise<ServiceLeafContext> {
  // Draft-state and ownership come from the governed guard, not re-derived.
  const { quote, quoteLeaf } = await quoteForQuoteLeaf(quoteLeafId);

  const [leaf] = await db
    .select({
      commercialKind: leaves.commercialKind,
      serviceIdentity: leaves.serviceIdentity,
      name: leaves.name,
    })
    .from(leaves)
    .where(eq(leaves.id, quoteLeaf.leafId))
    .limit(1);

  if (!leaf) throw new ActionGuardError(ERR.NOT_FOUND, "Library entry not found.");

  // Gated on CLASSIFICATION, never on the presence of production rows. A
  // surface that appeared because a row existed would be #282 undone by the
  // first stray write.
  if (leaf.commercialKind !== "service" || leaf.serviceIdentity === null) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `"${leaf.name}" is a product, not a service. An Item Group owns its production costs directly — add the cost there instead.`,
    );
  }
  if (quoteLeaf.assemblyId !== null) {
    // Belt and braces: the attachment gate and a database FK both prevent a
    // service from being a member, so this should be unreachable. It stays
    // because "should be unreachable" is a claim, and this is what it costs
    // to keep it one.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "A service line cannot sit inside an Item Group.",
    );
  }

  return {
    quoteId: quote.id,
    projectId: quote.projectId,
    serviceIdentity: leaf.serviceIdentity,
    label: DIRECT_SERVICE_LABELS[leaf.serviceIdentity],
  };
}

function parseAmount(raw: FormDataEntryValue | null): string | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) {
    throw new ActionGuardError(ERR.VALIDATION, "Enter a number.", "amount");
  }
  if (n < 0) {
    throw new ActionGuardError(ERR.VALIDATION, "Amount cannot be negative.", "amount");
  }
  return n.toFixed(2);
}

export async function updateDirectServiceProduction(
  formData: FormData,
): Promise<ActionResult<{ amount: string | null; column: string }>> {
  return runAction(async () => {
    const quoteLeafId = String(formData.get("quoteLeafId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!quoteLeafId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteLeafId required");
    if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    const ctx = await requireDirectServiceLeaf(quoteLeafId);

    const [tier] = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(and(eq(quoteTiers.id, tierId), eq(quoteTiers.quoteId, ctx.quoteId)))
      .limit(1);
    if (!tier) {
      // A tier from another quote would otherwise write a row whose owner and
      // tier disagree about which quote they belong to.
      throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found on this quote.");
    }

    const amount = parseAmount(formData.get("amount"));
    const column = DIRECT_SERVICE_PRODUCTION_INPUT[ctx.serviceIdentity];

    const [existing] = await db
      .select()
      .from(assemblyProductionInputs)
      .where(
        and(
          eq(assemblyProductionInputs.quoteLeafId, quoteLeafId),
          eq(assemblyProductionInputs.tierId, tierId),
        ),
      )
      .limit(1);

    const before = existing
      ? (existing[column as keyof typeof existing] as string | null)
      : null;

    if (existing) {
      await db
        .update(assemblyProductionInputs)
        .set({ [column]: amount })
        .where(eq(assemblyProductionInputs.id, existing.id));
    } else {
      await db.insert(assemblyProductionInputs).values({
        quoteLeafId,
        tierId,
        [column]: amount,
      });
    }

    // Named for the transition, not the mechanism: a service's production
    // amount changed. Which column carried it is mechanism, and lives in the
    // diff.
    await writeAuditEntry({
      userId: user.id,
      entityType: "quote_leaf",
      entityId: quoteLeafId,
      action: "direct_service_production_updated",
      diffJson: {
        quote_id: ctx.quoteId,
        tier_id: tierId,
        service_identity: ctx.serviceIdentity,
        input: DIRECT_SERVICE_PRODUCTION_LABEL[ctx.serviceIdentity],
        column,
        from: before,
        to: amount,
      },
    });

    revalidateQuoteTree(ctx.projectId, ctx.quoteId);
    return { amount, column };
  });
}

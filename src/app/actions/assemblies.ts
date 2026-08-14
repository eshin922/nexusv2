"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  auditLog,
  leaves,
  productTypes,
  quotes,
  itemGroupCategories,
} from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  assertDraft,
  type ActionResult,
} from "@/lib/action-result";
import { materializePackagingRows } from "@/lib/packaging-materialization";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";
import {
  attachGroupedMembership,
  detachGroupedMembership,
  detachGroupedMembershipsForAssembly,
  GroupedMembershipConflictError,
  reorderGroupedMemberships,
} from "@/lib/product-structure/grouped-membership-compatibility";

// Phase A.1 v2 impl-2 — server actions for the assemblies table.
// Mirrors src/app/actions/quotes.ts patterns: runAction wrapper,
// ActionGuardError on expected failures, audit logging with
// cascade-snapshot pattern for destructive ops.
//
// Step 6 wires:
//   - deleteAssembly: cascade-aware delete (assemblies → assembly_leaves
//                     CASCADE; library leaves themselves untouched).
//                     Audit row carries pre-delete snapshot of the
//                     assembly + its junctions for forensic recovery.
//
// Step 7 wires (LEAF context menu actions):
//   - detachAssemblyLeaf: remove a junction row; library leaf stays
//   - moveAssemblyLeaf: move junction up/down (Step 9 covers drag-
//                       to-reorder; menu-driven move stays in Step 7
//                       for keyboard / a11y access)
//
// Edit product (open Add Product modal in edit mode) lands in Phase 4
// (impl-4) per brief §5.4 scope. Step 6's menu item is inert with TODO.
// Duplicate ASY similarly deferred — non-trivial design choice on
// whether to clone leaves or just the ASY shell; banked for a later
// phase or follow-up.

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
 * Phase A.1 v2 impl-4 Step 2 — create an ASY row in the target
 * quote.
 *
 * Permission: any authenticated user can add an ASY to a draft
 * quote they have access to. Permission scoping refines in v1
 * polish slice (role-affordance per CLAUDE.md "Role gating —
 * affordance, not architecture").
 *
 * Auto-assigns position = max(position) + 1 across the quote's
 * existing assemblies. SKU uniqueness per quote is enforced by
 * the `assemblies_quote_sku_idx` unique index (impl-1 schema);
 * duplicate SKU within a quote surfaces as VALIDATION_ERROR via
 * the 22001/22003 -> validation translator OR as a Drizzle
 * unique-violation error (re-thrown by runAction; client sees
 * generic error message).
 *
 * Audit: `assembly_created` on assemblies entity; diff_json
 * carries the full identity + commercial fields the modal wrote.
 * Mirrors the assembly_deleted snapshot pattern.
 */
export async function createAssembly(
  formData: FormData,
): Promise<ActionResult<{ assemblyId: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const sku = String(formData.get("sku") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    // Step 7 · the Item Group's CATEGORY. `productTypeId` is still accepted as
    // an alias so a form rendered before this deploy keeps working; the two
    // never disagree because the ids are the originals, unchanged.
    const itemGroupCategoryId =
      String(
        formData.get("itemGroupCategoryId") ??
          formData.get("productTypeId") ??
          "",
      ).trim() || null;
    const description =
      String(formData.get("description") ?? "").trim() || null;
    const unitPriceRaw = String(formData.get("unitPrice") ?? "").trim();
    const unitCostRaw = String(formData.get("unitCost") ?? "").trim();
    const markupPctRaw = String(formData.get("markupPct") ?? "").trim();
    const ownerIdRaw = String(formData.get("ownerId") ?? "").trim();

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!name)
      throw new ActionGuardError(ERR.VALIDATION, "name required");

    // Step 7 · validated against the Item Group Category registry.
    //
    // The former `scope !== 'assembly'` check is gone because it is no longer
    // expressible: the registry contains categories and nothing else, so a leaf
    // Spec Schema id simply is not found. The separation moved from a runtime
    // check that one caller could forget into the shape of the data.
    if (itemGroupCategoryId) {
      const categoryRows = await db
        .select()
        .from(itemGroupCategories)
        .where(eq(itemGroupCategories.id, itemGroupCategoryId))
        .limit(1);
      if (categoryRows.length === 0)
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Selected Item Group category not found.",
        );
    }

    const user = await ensureUser();

    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    // Auto-assign position = max existing + 1 for this quote.
    const posRow = await db
      .select({ maxPos: sql<number>`coalesce(max(${assemblies.position}), -1)::int` })
      .from(assemblies)
      .where(eq(assemblies.quoteId, quoteId));
    const nextPosition = (posRow[0]?.maxPos ?? -1) + 1;

    // Normalize numeric inputs. Empty → null; otherwise pass
    // through as string (Drizzle accepts string for numeric col
    // and Postgres handles the cast; out-of-range surfaces via
    // 22003 translator). Auto-generated SKU when blank: simple
    // "ASY-{quote-short}-{position+1}" pattern as a placeholder
    // (PMs can rename via Edit product flow once shipped). NULL
    // SKU isn't allowed (assemblies.sku is NOT NULL); use the
    // generated default to avoid surfacing this error path in
    // the modal UX.
    const skuValue =
      sku.length > 0
        ? sku
        : `ASY-${quoteId.slice(0, 8)}-${nextPosition + 1}`;

    const inserted = await db
      .insert(assemblies)
      .values({
        quoteId,
        sku: skuValue,
        name,
        itemGroupCategoryId,
        description,
        unitPrice: unitPriceRaw === "" ? null : unitPriceRaw,
        unitCost: unitCostRaw === "" ? null : unitCostRaw,
        markupPct: markupPctRaw === "" ? null : markupPctRaw,
        ownerId: ownerIdRaw === "" ? null : ownerIdRaw,
        position: nextPosition,
      })
      .returning();
    const newRow = inserted[0];

    await writeAuditEntry({
      userId: user.id,
      entityType: "assembly",
      entityId: newRow.id,
      action: "assembly_created",
      diffJson: {
        quote_id: quoteId,
        sku: newRow.sku,
        name: newRow.name,
        item_group_category_id: newRow.itemGroupCategoryId,
        description: newRow.description,
        unit_price: newRow.unitPrice,
        unit_cost: newRow.unitCost,
        markup_pct: newRow.markupPct,
        owner_id: newRow.ownerId,
        position: newRow.position,
      },
    });

    revalidateQuoteTree(quote.projectId, quoteId);

    return { assemblyId: newRow.id };
  });
}

export async function deleteAssembly(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("assemblyId") ?? "").trim();
    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "assemblyId required");

    const user = await ensureUser();

    const asmRows = await db
      .select()
      .from(assemblies)
      .where(eq(assemblies.id, assemblyId))
      .limit(1);
    if (asmRows.length === 0) return;
    const asm = asmRows[0];

    const quote = await loadQuoteOrThrow(asm.quoteId);
    assertDraft(quote);

    // Cascade-aware audit (mirrors deleteSku in quotes.ts). Snapshot
    // the assembly row + every junction row (with the dereferenced leaf
    // SKU for human readability) BEFORE the CASCADE fires. Library
    // leaves themselves don't cascade — assembly_leaves.leafId is
    // ON DELETE RESTRICT — but the junctions cascade off the assembly_id
    // FK (ON DELETE CASCADE on assemblies → assembly_leaves).
    const junctionRows = await db
      .select({
        junction: assemblyLeaves,
        leafSku: leaves.sku,
        leafName: leaves.name,
      })
      .from(assemblyLeaves)
      .innerJoin(leaves, eq(leaves.id, assemblyLeaves.leafId))
      .where(eq(assemblyLeaves.assemblyId, assemblyId));

    await db.transaction(async (tx) => {
      const detached = await detachGroupedMembershipsForAssembly(tx, assemblyId);
      await tx.delete(assemblies).where(eq(assemblies.id, assemblyId));
      await writeAuditEntry({
        userId: user.id,
        entityType: "assembly",
        entityId: assemblyId,
        action: "assembly_deleted",
        diffJson: {
          deleted_assembly: {
            id: asm.id,
            quote_id: asm.quoteId,
            sku: asm.sku,
            name: asm.name,
            pack_label: asm.packLabel,
            item_group_category_id: asm.itemGroupCategoryId,
            position: asm.position,
          },
          cascaded_junctions: junctionRows.map((r) => ({
            quote_leaf_id: detached.find(
              (membership) => membership.assemblyLeafId === r.junction.id,
            )?.quoteLeafId,
            assembly_leaf_id: r.junction.id,
            leaf_id: r.junction.leafId,
            leaf_sku: r.leafSku,
            leaf_name: r.leafName,
            quantity: r.junction.quantity,
            position: r.junction.position,
          })),
          cascaded_junction_count: junctionRows.length,
        },
      }, tx);
    });

    revalidateQuoteTree(quote.projectId, asm.quoteId);
  });
}

/**
 * Phase A.1 v2 impl-5 — attach an existing library leaf to an ASY.
 *
 * Counterpart to detachAssemblyLeaf (impl-2 Step 7). Auto-assigns
 * position = max(existing) + 1 within the assembly. Duplicate
 * attaches are rejected by the partial unique index on
 * (assembly_id, leaf_id) WHERE parent_assembly_leaf_id IS NULL
 * (impl-1 schema); friendly error surfaces via runAction's
 * 23505 translator OR generic re-throw.
 *
 * Permission: any authenticated user with access to the draft
 * quote. Library leaf doesn't need can_edit_specs (we're not
 * editing spec values; just adding a junction).
 *
 * Audit: `assembly_leaf_attach` per CLAUDE.md namespace (first
 * canonical wire of the impl-1-banked action). diff_json carries
 * {assembly_id, leaf_id, quantity, position}.
 */
export async function attachAssemblyLeaf(
  formData: FormData,
): Promise<ActionResult<{ quoteLeafId: string; junctionId: string }>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("assemblyId") ?? "").trim();
    const leafId = String(formData.get("leafId") ?? "").trim();
    const quantityRaw = String(formData.get("quantity") ?? "1").trim();

    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "assemblyId required");
    if (!leafId)
      throw new ActionGuardError(ERR.VALIDATION, "leafId required");

    const user = await ensureUser();

    const asmRows = await db
      .select()
      .from(assemblies)
      .where(eq(assemblies.id, assemblyId))
      .limit(1);
    if (asmRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Assembly not found");
    const asm = asmRows[0];

    const quote = await loadQuoteOrThrow(asm.quoteId);
    assertDraft(quote);

    // Verify leaf exists + not archived.
    const leafRows = await db
      .select()
      .from(leaves)
      .where(eq(leaves.id, leafId))
      .limit(1);
    if (leafRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Leaf not found");
    // Shared with the Direct Product path. Adds the SKU-less refusal alongside
    // the existing archived one: a product with no SKU cannot be matched by the
    // NetSuite resolver, so attaching it builds a quote that is already unable
    // to complete — and the failure would otherwise surface at the irreversible
    // commit rather than here.
    const eligibility = evaluateAttachmentEligibility(leafRows[0]);
    if (!eligibility.attachable) {
      throw new ActionGuardError(ERR.VALIDATION, eligibility.message);
    }

    // Reject duplicate attach (friendly error vs raw unique-violation).
    const existingRows = await db
      .select({ id: assemblyLeaves.id })
      .from(assemblyLeaves)
      .where(
        and(
          eq(assemblyLeaves.assemblyId, assemblyId),
          eq(assemblyLeaves.leafId, leafId),
        ),
      )
      .limit(1);
    if (existingRows.length > 0)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "This leaf is already attached to this assembly.",
      );

    // Auto-position = max + 1.
    const posRow = await db
      .select({
        maxPos: sql<number>`coalesce(max(${assemblyLeaves.position}), -1)::int`,
      })
      .from(assemblyLeaves)
      .where(eq(assemblyLeaves.assemblyId, assemblyId));
    const nextPosition = (posRow[0]?.maxPos ?? -1) + 1;

    let membership;
    try {
      membership = await db.transaction(async (tx) => {
        const attached = await attachGroupedMembership(tx, {
          createdBy: user.id,
          quoteId: asm.quoteId,
          assemblyId,
          leafId,
          quantity: quantityRaw === "" ? "1" : quantityRaw,
          position: nextPosition,
        });
        await writeAuditEntry({
          userId: user.id,
          entityType: "quote_leaf",
          entityId: attached.quoteLeafId,
          action: "assembly_leaf_attach",
          diffJson: {
            assembly_id: assemblyId,
            assembly_leaf_id: attached.assemblyLeafId,
            leaf_id: leafId,
            quote_leaf_id: attached.quoteLeafId,
            quantity: attached.quantity,
            position: attached.position,
          },
        }, tx);
        return attached;
      });
    } catch (error) {
      if (error instanceof GroupedMembershipConflictError) {
        throw new ActionGuardError(ERR.VALIDATION, error.message);
      }
      throw error;
    }

    // Setup owns packaging structure, so attaching a component here is what
    // brings its priced rows into existence. Before this, fan-out ran only on
    // the tier axis, which made materialization depend on authoring ORDER:
    // components-then-tiers worked, tiers-then-components silently produced an
    // empty Packaging section. Same shared helper as addTier.
    await db.transaction(async (tx) => {
      await materializePackagingRows(tx, asm.quoteId);
    });

    revalidateQuoteTree(quote.projectId, asm.quoteId);

    return {
      quoteLeafId: membership.quoteLeafId,
      junctionId: membership.assemblyLeafId,
    };
  });
}

export async function detachAssemblyLeaf(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const junctionId = String(formData.get("junctionId") ?? "").trim();
    if (!junctionId)
      throw new ActionGuardError(ERR.VALIDATION, "junctionId required");

    const user = await ensureUser();

    // Load the junction + parent assembly (for quote_id + draft check).
    const rows = await db
      .select({
        junction: assemblyLeaves,
        assembly: assemblies,
      })
      .from(assemblyLeaves)
      .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
      .where(eq(assemblyLeaves.id, junctionId))
      .limit(1);
    if (rows.length === 0) return;
    const { junction, assembly } = rows[0];

    const quote = await loadQuoteOrThrow(assembly.quoteId);
    assertDraft(quote);

    // Compatibility detach explicitly deletes legacy first (preserving its
    // dependent-cost cascades), then canonical. The reusable LEAF remains.
    await db.transaction(async (tx) => {
      const detached = await detachGroupedMembership(tx, {
        assemblyLeafId: junctionId,
      });
      if (!detached) return;

      // Per CLAUDE.md audit_log namespace — `assembly_leaf_detach`:
      // entity_id is the canonical quote_leaf PK; diff_json retains the
      // legacy junction plus Product and reusable LEAF context.
      await writeAuditEntry({
        userId: user.id,
        entityType: "quote_leaf",
        entityId: detached.quoteLeafId,
        action: "assembly_leaf_detach",
        diffJson: {
          assembly_id: junction.assemblyId,
          assembly_leaf_id: junctionId,
          leaf_id: junction.leafId,
          quote_leaf_id: detached.quoteLeafId,
          quantity: junction.quantity,
          position: junction.position,
        },
      }, tx);
    });

    revalidateQuoteTree(quote.projectId, assembly.quoteId);
  });
}

export async function updateAssemblyNotes(
  formData: FormData,
): Promise<ActionResult<{ assemblyId: string; internalNotes: string | null }>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("assemblyId") ?? "").trim();
    const rawNotes = String(formData.get("internalNotes") ?? "");
    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "assemblyId required");

    const asmRows = await db
      .select()
      .from(assemblies)
      .where(eq(assemblies.id, assemblyId))
      .limit(1);
    if (asmRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Assembly not found");
    const asm = asmRows[0];

    const quote = await loadQuoteOrThrow(asm.quoteId);
    assertDraft(quote);

    // Trim trailing whitespace + normalize empty to NULL. Lets the
    // HAS NOTE chip read off the non-null condition cleanly without
    // having to additionally check for empty strings on the read path.
    const trimmed = rawNotes.trim();
    const next: string | null = trimmed.length === 0 ? null : trimmed;
    const prev = asm.internalNotes;

    // Identity write — no-op (avoid noisy audit churn on save events
    // that happen to fire with unchanged value, e.g., blur events
    // without an actual edit).
    if (prev === next) {
      return { assemblyId, internalNotes: next };
    }

    await db
      .update(assemblies)
      .set({ internalNotes: next, updatedAt: new Date() })
      .where(eq(assemblies.id, assemblyId));

    // No dedicated audit action banked in CLAUDE.md for ASY notes
    // edits; use generic `notes_updated` (parallels the convention
    // used by other free-text-field edits like quote.customer_facing_notes).
    await writeAuditEntry({
      userId: (await ensureUser()).id,
      entityType: "assembly",
      entityId: assemblyId,
      action: "notes_updated",
      diffJson: {
        field: "internal_notes",
        from: prev,
        to: next,
      },
    });

    revalidateQuoteTree(quote.projectId, asm.quoteId);
    return { assemblyId, internalNotes: next };
  });
}

/**
 * Phase A.1 v2 impl-2 Step 9 — drag-to-reorder assemblies.
 *
 * formData["assemblyIds"] is the comma-separated ordered list of
 * assembly UUIDs after the user's drag. The action rewrites every
 * row's `position` to its 0-based index in the list. All rows must
 * belong to the same quote (cross-quote ordering is meaningless);
 * verified by re-loading each row + checking quoteId consistency.
 *
 * Mirrors reorderQuoteSkus in quotes.ts: optimistic UI on the
 * client, server overwrites positions in a single transaction,
 * revalidate refreshes the canonical order.
 */
export async function reorderAssemblies(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const idsRaw = String(formData.get("assemblyIds") ?? "");
    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0)
      throw new ActionGuardError(ERR.VALIDATION, "assemblyIds required");

    const quote = await loadQuoteOrThrow(quoteId);
    assertDraft(quote);

    const existing = await db
      .select({ id: assemblies.id, quoteId: assemblies.quoteId })
      .from(assemblies)
      .where(inArray(assemblies.id, ids));
    if (existing.length !== ids.length)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Some assemblyIds were not found.",
      );
    for (const r of existing) {
      if (r.quoteId !== quoteId)
        throw new ActionGuardError(
          ERR.VALIDATION,
          "All assemblies must belong to the same quote.",
        );
    }

    // Rewrite positions sequentially. Position values aren't unique-
    // constrained, so out-of-order updates can't conflict. Use a
    // single transaction so a partial failure doesn't leave the
    // table in an inconsistent state.
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(assemblies)
          .set({ position: i, updatedAt: new Date() })
          .where(eq(assemblies.id, ids[i]));
      }
    });

    // Audit pattern: single row capturing the new order. Future
    // refinement could cascade per-assembly position rows linked via
    // caused_by_audit_id, but the single audit row is sufficient for
    // forensic reconstruction (the ordered list is the change).
    await writeAuditEntry({
      userId: (await ensureUser()).id,
      entityType: "quote",
      entityId: quoteId,
      action: "assemblies_reordered",
      diffJson: { ordered_assembly_ids: ids },
    });

    revalidateQuoteTree(quote.projectId, quoteId);
  });
}

/**
 * Phase A.1 v2 impl-2 Step 9 — drag-to-reorder leaves within an ASY.
 *
 * formData["assemblyId"] + formData["junctionIds"] (comma-separated).
 * Junctions all must belong to the same assembly_id; verified server-
 * side. Cross-ASY junction moves (reparenting) is a separate workflow
 * ("Assign to parent ASY" in the leaf context menu) deferred to a
 * follow-up.
 */
export async function reorderAssemblyLeaves(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("assemblyId") ?? "").trim();
    const idsRaw = String(formData.get("junctionIds") ?? "");
    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "assemblyId required");
    const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0)
      throw new ActionGuardError(ERR.VALIDATION, "junctionIds required");

    const asmRows = await db
      .select()
      .from(assemblies)
      .where(eq(assemblies.id, assemblyId))
      .limit(1);
    if (asmRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Assembly not found");
    const asm = asmRows[0];

    const quote = await loadQuoteOrThrow(asm.quoteId);
    assertDraft(quote);

    const existing = await db
      .select({ id: assemblyLeaves.id, assemblyId: assemblyLeaves.assemblyId })
      .from(assemblyLeaves)
      .where(inArray(assemblyLeaves.id, ids));
    if (existing.length !== ids.length)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Some junctionIds were not found.",
      );
    for (const r of existing) {
      if (r.assemblyId !== assemblyId)
        throw new ActionGuardError(
          ERR.VALIDATION,
          "All junctions must belong to the same assembly. Cross-ASY moves use Assign to parent.",
        );
    }

    const user = await ensureUser();
    await db.transaction(async (tx) => {
      const reordered = await reorderGroupedMemberships(tx, {
        assemblyId,
        orderedAssemblyLeafIds: ids,
      });
      await writeAuditEntry({
        userId: user.id,
        entityType: "assembly",
        entityId: assemblyId,
        action: "assembly_leaves_reordered",
        diffJson: {
          ordered_quote_leaf_ids: reordered.map((row) => row.quoteLeafId),
          ordered_assembly_leaf_ids: ids,
        },
      }, tx);
    });

    revalidateQuoteTree(quote.projectId, asm.quoteId);
  });
}

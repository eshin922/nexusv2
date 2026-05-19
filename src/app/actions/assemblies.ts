"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  auditLog,
  leaves,
  quotes,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  quoteNotDraftMessage,
  type ActionResult,
} from "@/lib/action-result";
import { revalidateQuoteTree } from "@/lib/revalidate";

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

function assertDraft(quote: { status: string }) {
  if (quote.status !== "draft") {
    throw new ActionGuardError(
      ERR.QUOTE_NOT_DRAFT,
      quoteNotDraftMessage(quote.status),
    );
  }
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

    await db.delete(assemblies).where(eq(assemblies.id, assemblyId));

    await db.insert(auditLog).values({
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
          product_type_id: asm.productTypeId,
          position: asm.position,
        },
        cascaded_junctions: junctionRows.map((r) => ({
          junction_id: r.junction.id,
          leaf_id: r.junction.leafId,
          leaf_sku: r.leafSku,
          leaf_name: r.leafName,
          quantity: r.junction.quantity,
          position: r.junction.position,
        })),
        cascaded_junction_count: junctionRows.length,
      },
    });

    revalidateQuoteTree(quote.projectId, asm.quoteId);
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

    // Junction-only delete. Library leaf stays (assembly_leaves.leaf_id
    // is ON DELETE RESTRICT — couldn't cascade-delete the leaf even
    // if we wanted to). Spec values persist; reattach via library
    // browse (impl-5) preserves them.
    await db.delete(assemblyLeaves).where(eq(assemblyLeaves.id, junctionId));

    // Per CLAUDE.md audit_log namespace — `assembly_leaf_detach`:
    // entity_id = the deleted junction row's PK; diff_json carries
    // assembly + leaf identity so reconstruction of the workflow is
    // possible from audit alone.
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "assembly_leaf",
      entityId: junctionId,
      action: "assembly_leaf_detach",
      diffJson: {
        assembly_id: junction.assemblyId,
        leaf_id: junction.leafId,
        quantity: junction.quantity,
        position: junction.position,
      },
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
    await db.insert(auditLog).values({
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

"use server";

import { eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  freightInputs,
  packagingInputs,
  productionInputs,
  quoteSkus,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Leaf-detach micro-slice Sub-item 5 — admin-gated cleanup pass.
// Per Q2 LOCKED: manual admin trigger post-deploy. Slice ships
// with the dry-run script (scripts/verify/orphaned-cost-data-audit.ts)
// committed but no auto-execution. After Edward smokes the
// deployed slice on production and reviews the audit doc, he
// triggers this action via an admin UI affordance.
//
// Behavior: for each orphan assembly SKU (sku_role = 'assembly'
// with any per-SKU cost row in packaging_inputs / production_inputs
// / freight_inputs), execute the Sub-item 3 smart-migrate logic
// adapted for the no-leaf-role case (skip the role flip step;
// just create the auto-named child + reparent rows). Each orphan
// gets its own atomic transaction so a single failure doesn't
// abort the entire pass — failures are logged + skipped + listed
// in the report.
//
// Per brief §4 Sub-item 5 step 5: this action also returns the
// post-pass orphan count (re-query confirms zero remain).

type CleanupOrphan = {
  quoteSkuId: string;
  skuLabel: string;
  productName: string;
  unitsPerPack: number;
  quoteId: string;
};

type CleanupResult = {
  attempted: number;
  succeeded: number;
  skipped: Array<{ quoteSkuId: string; skuLabel: string; error: string }>;
  remainingOrphans: number;
};

export async function runOrphanedCostDataCleanup(): Promise<
  ActionResult<CleanupResult>
> {
  return runAction(async () => {
    await requireAdminAction();
    const user = await ensureUser();

    // Find orphan assemblies — same query shape as the dry-run
    // script, but here we need the data for the smart-migrate
    // adaptation (sku_label + product_name + units_per_pack +
    // quote_id).
    const orphans = await db
      .select({
        quoteSkuId: quoteSkus.id,
        skuLabel: quoteSkus.skuLabel,
        productName: quoteSkus.productName,
        unitsPerPack: quoteSkus.unitsPerPack,
        quoteId: quoteSkus.quoteId,
      })
      .from(quoteSkus)
      .where(
        sql`${quoteSkus.skuRole} = 'assembly' AND (
          EXISTS (SELECT 1 FROM packaging_inputs WHERE quote_sku_id = ${quoteSkus.id})
          OR EXISTS (SELECT 1 FROM production_inputs WHERE quote_sku_id = ${quoteSkus.id})
          OR EXISTS (SELECT 1 FROM freight_inputs WHERE quote_sku_id = ${quoteSkus.id})
        )`,
      );

    const skipped: CleanupResult["skipped"] = [];
    let succeeded = 0;

    for (const orphan of orphans) {
      try {
        await migrateOrphan(orphan, user.id);
        succeeded++;
      } catch (err) {
        skipped.push({
          quoteSkuId: orphan.quoteSkuId,
          skuLabel: orphan.skuLabel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Re-query to confirm zero remaining orphans (per brief step 5).
    const remaining = await db
      .select({ id: quoteSkus.id })
      .from(quoteSkus)
      .where(
        sql`${quoteSkus.skuRole} = 'assembly' AND (
          EXISTS (SELECT 1 FROM packaging_inputs WHERE quote_sku_id = ${quoteSkus.id})
          OR EXISTS (SELECT 1 FROM production_inputs WHERE quote_sku_id = ${quoteSkus.id})
          OR EXISTS (SELECT 1 FROM freight_inputs WHERE quote_sku_id = ${quoteSkus.id})
        )`,
      );

    return {
      attempted: orphans.length,
      succeeded,
      skipped,
      remainingOrphans: remaining.length,
    };
  });
}

// Per-orphan smart-migrate. Adapts the Sub-item 3 action's
// transaction shape: pre-allocate child id; reparent the three
// per-SKU cost tables; INSERT the child leaf with parent_sku_id =
// original. NO role flip — the original is already assembly.
async function migrateOrphan(orphan: CleanupOrphan, userId: string) {
  // Collision-detect the auto-name same as Sub-item 3 action.
  const existingLabels = new Set(
    (
      await db
        .select({ skuLabel: quoteSkus.skuLabel })
        .from(quoteSkus)
        .where(eq(quoteSkus.quoteId, orphan.quoteId))
    ).map((r) => r.skuLabel),
  );
  let candidateLabel = `${orphan.skuLabel}-CMP`;
  if (existingLabels.has(candidateLabel)) {
    let resolved = false;
    for (let n = 2; n <= 1000; n++) {
      const next = `${orphan.skuLabel}-CMP-${n}`;
      if (!existingLabels.has(next)) {
        candidateLabel = next;
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Auto-name collision: more than 1000 -CMP variants exist for ${orphan.skuLabel}.`,
      );
    }
  }
  const newChildSkuLabel = candidateLabel;
  const newChildId = crypto.randomUUID();

  const [pkgCount, prodCount, frtCount] = await Promise.all([
    db
      .select({ id: packagingInputs.id })
      .from(packagingInputs)
      .where(eq(packagingInputs.quoteSkuId, orphan.quoteSkuId)),
    db
      .select({ id: productionInputs.id })
      .from(productionInputs)
      .where(eq(productionInputs.quoteSkuId, orphan.quoteSkuId)),
    db
      .select({ id: freightInputs.id })
      .from(freightInputs)
      .where(eq(freightInputs.quoteSkuId, orphan.quoteSkuId)),
  ]);

  await db.transaction(async (tx) => {
    // INSERT child SKU FIRST (approach b ordering — Postgres
    // checks FK on UPDATE when the FK column changes, so cost-row
    // reparenting can't run before the child exists). Mirrors the
    // fix applied to convertLeafToAssemblyWithMigrate after Edward
    // smoke 2026-05-14.
    // Look up the orphan's hubspot_product_id so the new child
    // inherits it (Edward disposition (d) — auto-child inherits
    // HubSpot reference; Slice 12 writeback filter handles the
    // double-push concern).
    const [orphanFull] = await db
      .select({ hubspotProductId: quoteSkus.hubspotProductId })
      .from(quoteSkus)
      .where(eq(quoteSkus.id, orphan.quoteSkuId))
      .limit(1);
    await tx.insert(quoteSkus).values({
      id: newChildId,
      quoteId: orphan.quoteId,
      hubspotProductId: orphanFull?.hubspotProductId ?? null,
      skuLabel: newChildSkuLabel,
      productName: orphan.productName,
      unitsPerPack: orphan.unitsPerPack,
      retailBenchmark: null,
      notes: null,
      skuRole: "leaf",
      parentSkuId: orphan.quoteSkuId,
      qtyPerParent: "1",
      sortOrder: 0,
      isAutoMigrateArtifact: true,
    });

    // Reparent the three per-SKU cost tables. Safe now —
    // newChildId exists in quote_skus.
    if (pkgCount.length > 0) {
      await tx
        .update(packagingInputs)
        .set({ quoteSkuId: newChildId, updatedAt: new Date() })
        .where(eq(packagingInputs.quoteSkuId, orphan.quoteSkuId));
    }
    if (prodCount.length > 0) {
      await tx
        .update(productionInputs)
        .set({ quoteSkuId: newChildId, updatedAt: new Date() })
        .where(eq(productionInputs.quoteSkuId, orphan.quoteSkuId));
    }
    if (frtCount.length > 0) {
      await tx
        .update(freightInputs)
        .set({ quoteSkuId: newChildId, updatedAt: new Date() })
        .where(eq(freightInputs.quoteSkuId, orphan.quoteSkuId));
    }

    // Strip hubspot_product_id from the original (now-confirmed-
    // assembly). Same disposition as interactive smart-migrate:
    // assemblies are Nexus-local kit definitions; the HubSpot link
    // moved to the new auto-child leaf above. No-op when the
    // original already had a NULL link (e.g., pre-Sub-item-3
    // Nexus-local assembly that happened to acquire orphan cost
    // rows via some other path).
    await tx
      .update(quoteSkus)
      .set({ hubspotProductId: null, updatedAt: new Date() })
      .where(eq(quoteSkus.id, orphan.quoteSkuId));

    // Audit trail. Per Sub-item 5 vs Sub-item 3 difference: no
    // `role_converted` here (original is already assembly). Just
    // the create + reparent log entries.
    await tx.insert(auditLog).values({
      userId,
      entityType: "quote_sku",
      entityId: orphan.quoteSkuId,
      action: "cost_data_reparented",
      diffJson: {
        cost_data_migrated_to_child_id: newChildId,
        cost_lines_reparented: {
          packaging: pkgCount.length,
          production: prodCount.length,
          freight: frtCount.length,
        },
        source: "admin_orphan_cleanup",
      },
    });
    await tx.insert(auditLog).values({
      userId,
      entityType: "quote_sku",
      entityId: newChildId,
      action: "sku_created_auto_for_cost_migration",
      diffJson: {
        original_sku_id: orphan.quoteSkuId,
        auto_named_from: orphan.skuLabel,
        new_child_sku_label: newChildSkuLabel,
        source: "admin_orphan_cleanup",
      },
    });
  });
}

// Used by `eq` import to satisfy linter when the import isn't
// referenced elsewhere; kept here so future extensions don't have
// to re-add the import.
void or;

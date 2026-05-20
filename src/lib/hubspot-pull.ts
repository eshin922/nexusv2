import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leaves, users } from "@/db/schema";
import { listProducts, type HubspotProductRaw } from "./hubspot";
import {
  mapHubspotToLeaf,
  type MappedLeafFromHubspot,
} from "./hubspot-mapper";

// slice-hubspot-bidirectional — pull pagination + dedup + cascade-
// audit batching logic. Used by `pullFromHubSpot` server action
// (Step 5). One call processes one batch (≤100 products);
// caller iterates with the returned `nextAfter` cursor.
//
// Per Concern A disposition (CC brief review §2): one root
// `hubspot_pull_batch` audit row per batch + N derived
// `leaf_create` / `leaf_archive` rows linked via
// `caused_by_audit_id`. Audit-log readers filter on
// `caused_by_audit_id IS NULL` for user-initiated leaf creates
// vs full pull cascade.
//
// Per Catch #14: pull runs the helper TWICE per Pull operation —
// once with includeArchived=false (active products) then once
// with includeArchived=true (archived ones). HubSpot's list
// endpoint defaults to archived=false.

export type PullBatchOptions = {
  userId: string; // PM running the pull (audit user_id)
  projectId: string; // context for the root audit row
  after?: string;
  batchNumber: number;
  includeArchived: boolean;
};

export type PullBatchResult = {
  processed: number;
  added: number;
  updated: number;
  archivedCount: number;
  nextAfter: string | null;
  rootAuditId: string;
};

export async function pullProductsBatch(
  opts: PullBatchOptions,
): Promise<PullBatchResult> {
  const startedAt = new Date();

  // 1. Fetch a batch from HubSpot.
  const batch = await listProducts({
    after: opts.after,
    limit: 100,
    includeArchived: opts.includeArchived,
  });

  if (batch.results.length === 0) {
    // Empty batch — still emit a root audit row for traceability
    // (operators can see "pull ran and found nothing in this
    // bucket"). No derived rows.
    const [rootAudit] = await db
      .insert(auditLog)
      .values({
        userId: opts.userId,
        entityType: "project",
        entityId: opts.projectId,
        action: "hubspot_pull_batch",
        diffJson: {
          batch_number: opts.batchNumber,
          include_archived: opts.includeArchived,
          processed: 0,
          added: 0,
          updated: 0,
          archived: 0,
          started_at: startedAt.toISOString(),
          completed_at: new Date().toISOString(),
          next_after: null,
          audit_source: "hubspot_pull",
        },
      })
      .returning({ id: auditLog.id });
    return {
      processed: 0,
      added: 0,
      updated: 0,
      archivedCount: 0,
      nextAfter: null,
      rootAuditId: rootAudit.id,
    };
  }

  // 2. Pre-fetch nexus users keyed by hubspot_owner_id for the
  // mapper's owner translation. Single fetch per batch — at DPS
  // scale (~12 users) this is negligible cost; index on
  // users.hubspot_owner_id supports it.
  const userRows = await db
    .select({ id: users.id, hubspotOwnerId: users.hubspotOwnerId })
    .from(users);
  const userIdByHubspotOwnerId = new Map<string, string>();
  for (const u of userRows) {
    if (u.hubspotOwnerId) userIdByHubspotOwnerId.set(u.hubspotOwnerId, u.id);
  }

  // 3. Pre-fetch existing leaves by hubspot_product_id for the
  // added-vs-updated split. inArray with the batch's product IDs;
  // partial unique index `leaves_hubspot_product_id_idx` supports
  // the lookup.
  const productIds = batch.results.map((r) => r.id);
  const existing = await db
    .select({
      id: leaves.id,
      hubspotProductId: leaves.hubspotProductId,
      archived: leaves.archived,
    })
    .from(leaves)
    .where(inArray(leaves.hubspotProductId, productIds));
  const existingByHubspotId = new Map(
    existing.map((e) => [
      e.hubspotProductId as string,
      { id: e.id, wasArchived: e.archived },
    ]),
  );

  // 4. Map each raw to leaf shape (pure function, no DB).
  const mappedEntries: Array<{
    raw: HubspotProductRaw;
    mapped: MappedLeafFromHubspot;
  }> = batch.results.map((raw) => ({
    raw,
    mapped: mapHubspotToLeaf(raw, { userIdByHubspotOwnerId }),
  }));

  // 5. Transaction: insert root audit row first (so derived rows
  // can reference its id), then upsert leaves + emit derived
  // audit rows, then update root row with final counts.
  let added = 0;
  let updated = 0;
  let archivedCount = 0;
  let rootAuditId = "";

  await db.transaction(async (tx) => {
    const [rootAudit] = await tx
      .insert(auditLog)
      .values({
        userId: opts.userId,
        entityType: "project",
        entityId: opts.projectId,
        action: "hubspot_pull_batch",
        diffJson: {
          batch_number: opts.batchNumber,
          include_archived: opts.includeArchived,
          processed: batch.results.length,
          started_at: startedAt.toISOString(),
          added: 0,
          updated: 0,
          archived: 0,
          next_after: batch.nextAfter,
          audit_source: "hubspot_pull",
        },
      })
      .returning({ id: auditLog.id });
    rootAuditId = rootAudit.id;

    for (const { mapped } of mappedEntries) {
      const prev = existingByHubspotId.get(mapped.hubspotProductId);

      if (prev) {
        // UPDATE existing leaf. Preserve productTypeId — never
        // auto-set from HubSpot (HubSpot's hs_product_type enum
        // ≠ nexus product_types taxonomy; PM sets manually via
        // TypePicker post-pull).
        await tx
          .update(leaves)
          .set({
            name: mapped.name,
            sku: mapped.sku,
            unitCost: mapped.unitCost,
            url: mapped.url,
            imageUrl: mapped.imageUrl,
            fscClaim: mapped.fscClaim,
            fscStatus: mapped.fscStatus,
            supplierVerified: mapped.supplierVerified,
            ownerId: mapped.ownerId,
            archived: mapped.archived,
            updatedAt: new Date(),
          })
          .where(eq(leaves.id, prev.id));
        updated++;
        if (mapped.archived) archivedCount++;

        // Derived audit: leaf_archive fires only on state
        // transition (was archived=false, now archived=true).
        // Re-archiving an already-archived row is a no-op and
        // shouldn't emit. Same shape for un-archiving (was true,
        // now false) — Catch #11 disposition uses leaf_archive
        // with diff_json.source = 'hubspot_pull' for the
        // archive direction; un-archive is rare and TODO; the
        // archived state flips silently in the UPDATE above.
        if (mapped.archived && !prev.wasArchived) {
          await tx.insert(auditLog).values({
            userId: opts.userId,
            entityType: "leaf",
            entityId: prev.id,
            action: "leaf_archive",
            causedByAuditId: rootAuditId,
            diffJson: {
              reason: "hubspot_archived",
              source: "hubspot_pull",
            },
          });
        }
      } else {
        // INSERT new leaf. The unique partial index on
        // `hubspot_product_id WHERE NOT NULL` enforces no
        // duplicates; a race with a parallel pull would 23505
        // and re-throw — caller's Concern D advisory-lock
        // banking accepts the small risk for v1.
        const [newRow] = await tx
          .insert(leaves)
          .values({
            name: mapped.name,
            sku: mapped.sku,
            url: mapped.url,
            imageUrl: mapped.imageUrl,
            unitCost: mapped.unitCost,
            fscClaim: mapped.fscClaim,
            fscStatus: mapped.fscStatus,
            supplierVerified: mapped.supplierVerified,
            ownerId: mapped.ownerId,
            archived: mapped.archived,
            hubspotProductId: mapped.hubspotProductId,
          })
          .returning({ id: leaves.id });
        added++;
        if (mapped.archived) archivedCount++;

        // Derived audit: leaf_create with source='hubspot_pull'
        // per Slice 9.2 source-namespace convention. caused_by
        // links to the root batch row; audit readers can filter
        // out cascade-derived creates by `caused_by_audit_id
        // IS NULL`.
        await tx.insert(auditLog).values({
          userId: opts.userId,
          entityType: "leaf",
          entityId: newRow.id,
          action: "leaf_create",
          causedByAuditId: rootAuditId,
          diffJson: {
            name: mapped.name,
            sku: mapped.sku,
            hubspot_product_id: mapped.hubspotProductId,
            source: "hubspot_pull",
          },
        });
      }
    }

    // Update root audit row with final counts. JSONB column —
    // overwrite the whole diff_json since this is the canonical
    // post-batch shape.
    await tx
      .update(auditLog)
      .set({
        diffJson: {
          batch_number: opts.batchNumber,
          include_archived: opts.includeArchived,
          processed: batch.results.length,
          added,
          updated,
          archived: archivedCount,
          started_at: startedAt.toISOString(),
          completed_at: new Date().toISOString(),
          next_after: batch.nextAfter,
          audit_source: "hubspot_pull",
        },
      })
      .where(eq(auditLog.id, rootAuditId));
  });

  return {
    processed: batch.results.length,
    added,
    updated,
    archivedCount,
    nextAfter: batch.nextAfter,
    rootAuditId,
  };
}

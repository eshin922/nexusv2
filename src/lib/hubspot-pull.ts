import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, leaves, users } from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import type { HubSpotProductRaw } from "./integrations/hubspot-provider";
import { getApplicationDependencies } from "./integrations/composition";
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
  /**
   * Products this refresh declined to overwrite because they changed after
   * its snapshot was taken. Reported rather than silently dropped: a refresh
   * that quietly skips products is indistinguishable from one with nothing
   * to do.
   */
  skippedStale: number;
  nextAfter: string | null;
  rootAuditId: string;
  timings: PullBatchTimings;
};

export type PullBatchTimings = {
  hubspotMs: number;
  lookupMs: number;
  databaseMs: number;
  totalMs: number;
};

export async function pullProductsBatch(
  opts: PullBatchOptions,
): Promise<PullBatchResult> {
  const startedAt = new Date();
  const totalStartedAt = performance.now();

  // 1. Fetch a batch from HubSpot.
  const hubspotStartedAt = performance.now();
  const { hubspot } = await getApplicationDependencies();
  const batch = await hubspot.listProducts({
    after: opts.after,
    limit: 100,
    includeArchived: opts.includeArchived,
  });
  const hubspotMs = Math.round(performance.now() - hubspotStartedAt);

  if (batch.results.length === 0) {
    // Empty batch — still emit a root audit row for traceability
    // (operators can see "pull ran and found nothing in this
    // bucket"). No derived rows.
    const databaseStartedAt = performance.now();
    const rootAudit = await writeAuditEntryReturningId({
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
          skipped_stale: 0,
          started_at: startedAt.toISOString(),
          completed_at: new Date().toISOString(),
          next_after: null,
          audit_source: "hubspot_pull",
        },
      });
    const timings = {
      hubspotMs,
      lookupMs: 0,
      databaseMs: Math.round(performance.now() - databaseStartedAt),
      totalMs: Math.round(performance.now() - totalStartedAt),
    };
    console.info("hubspot_product_refresh_batch", {
      batchNumber: opts.batchNumber,
      includeArchived: opts.includeArchived,
      processed: 0,
      timings,
    });
    return {
      processed: 0,
      added: 0,
      updated: 0,
      archivedCount: 0,
      skippedStale: 0,
      nextAfter: null,
      rootAuditId: rootAudit,
      timings,
    };
  }

  // 2. Pre-fetch nexus users keyed by hubspot_owner_id for the
  // mapper's owner translation. Single fetch per batch — at DPS
  // scale (~12 users) this is negligible cost; index on
  // users.hubspot_owner_id supports it.
  const lookupStartedAt = performance.now();
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
      // The version this refresh OBSERVED. Carried into the transaction so
      // the write can be conditional on the row not having moved since.
      updatedAt: leaves.updatedAt,
    })
    .from(leaves)
    .where(inArray(leaves.hubspotProductId, productIds));
  const existingByHubspotId = new Map(
    existing.map((e) => [
      e.hubspotProductId as string,
      { id: e.id, wasArchived: e.archived, observedVersion: e.updatedAt },
    ]),
  );
  const lookupMs = Math.round(performance.now() - lookupStartedAt);

  // 4. Map each raw to leaf shape (pure function, no DB).
  const mappedEntries: Array<{
    raw: HubSpotProductRaw;
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
  /**
   * Rows this refresh DECLINED to overwrite because they changed after its
   * snapshot was taken. Counted and reported rather than silently skipped: a
   * refresh that quietly drops products is indistinguishable from one that
   * had nothing to do.
   */
  let skippedStale = 0;
  const skippedProductIds: string[] = [];
  let rootAuditId = "";

  const databaseStartedAt = performance.now();
  await db.transaction(async (tx) => {
    const rootAudit = await writeAuditEntryReturningId({
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
      }, tx);
    rootAuditId = rootAudit;

    // PVS-020: issue independent per-product mutations together so postgres-js
    // can pipeline them on the transaction connection. The former serial loop
    // paid one network round trip per Product before the UI saw batch progress.
    // Locks taken UP FRONT and in sorted order. Two refreshes running
    // concurrently would otherwise request the same set in whatever order
    // their promises happened to resolve, which is a deadlock with no
    // deterministic trigger. An edit only ever holds one leaf lock and then a
    // SKU lock, and takes no second leaf lock, so it cannot close a cycle
    // with this.
    const lockIds = mappedEntries
      .map(({ mapped }) => existingByHubspotId.get(mapped.hubspotProductId)?.id)
      .filter((id): id is string => Boolean(id))
      .sort();
    for (const id of lockIds) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`leaf:${id}`}, 0))`,
      );
    }

    await Promise.all(mappedEntries.map(async ({ mapped }) => {
      const prev = existingByHubspotId.get(mapped.hubspotProductId);

      if (prev) {
        // UPDATE existing leaf.
        //
        // productTypeId is PRESERVED and never auto-set from HubSpot: that is
        // Nexus's own taxonomy and the PM authors it via the TypePicker. The
        // vocabularies genuinely differ, so mapping one onto the other would
        // lose information.
        //
        // hubspotProductType IS written, because it is HubSpot's own
        // classification stored verbatim rather than a translation of it. The
        // two columns coexist; neither derives from the other.
        // ── THE REFRESH PARTICIPATES IN THE EDIT CONTRACT ───────────
        //
        // This writes the same columns the Library edit authors, so it has to
        // be bound by the same two rules -- otherwise the lock an edit takes
        // protects it from other edits and from nothing else.
        //
        // The LOCK serialises against an in-flight edit. Without it the
        // refresh can land between an edit's read and its write, and the edit
        // -- whose version check has already passed -- then overwrites the
        // refresh.
        //
        // The VERSION is what makes the lock sufficient. The batch and this
        // row were both read BEFORE the lock was requested, so waiting for it
        // means waiting while the row may change. Acquiring the lock proves
        // nothing about what happened while queueing for it; only the version
        // does. `WHERE updated_at = <observed>` is a compare-and-swap: if the
        // row moved, zero rows are affected and the stale snapshot is
        // declined rather than applied over the newer edit.
        const claimed = await tx
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
            hubspotProductType: mapped.hubspotProductType,
            updatedAt: new Date(),
          })
          .where(
            prev.observedVersion
              ? and(
                  eq(leaves.id, prev.id),
                  eq(leaves.updatedAt, prev.observedVersion),
                )
              : eq(leaves.id, prev.id),
          )
          .returning({ id: leaves.id });

        if (claimed.length === 0) {
          skippedStale++;
          skippedProductIds.push(mapped.hubspotProductId);
          return;
        }

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
          await writeAuditEntry({
            userId: opts.userId,
            entityType: "leaf",
            entityId: prev.id,
            action: "leaf_archive",
            causedByAuditId: rootAuditId,
            diffJson: {
              reason: "hubspot_archived",
              source: "hubspot_pull",
            },
          }, tx);
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
            hubspotProductType: mapped.hubspotProductType,
          })
          .returning({ id: leaves.id });
        added++;
        if (mapped.archived) archivedCount++;

        // Derived audit: leaf_create with source='hubspot_pull'
        // per Slice 9.2 source-namespace convention. caused_by
        // links to the root batch row; audit readers can filter
        // out cascade-derived creates by `caused_by_audit_id
        // IS NULL`.
        await writeAuditEntry({
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
        }, tx);
      }
    }));

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
          // Named in the audit, not only returned. A refresh that declined to
          // overwrite newer edits made a decision, and the record has to show
          // which products it left alone.
          skipped_stale: skippedStale,
          skipped_product_ids: skippedProductIds,
          started_at: startedAt.toISOString(),
          completed_at: new Date().toISOString(),
          next_after: batch.nextAfter,
          audit_source: "hubspot_pull",
        },
      })
      .where(eq(auditLog.id, rootAuditId));
  });

  const timings = {
    hubspotMs,
    lookupMs,
    databaseMs: Math.round(performance.now() - databaseStartedAt),
    totalMs: Math.round(performance.now() - totalStartedAt),
  };
  console.info("hubspot_product_refresh_batch", {
    batchNumber: opts.batchNumber,
    includeArchived: opts.includeArchived,
    processed: batch.results.length,
    added,
    updated,
    archived: archivedCount,
    timings,
  });

  return {
    processed: batch.results.length,
    added,
    updated,
    archivedCount,
    skippedStale,
    nextAfter: batch.nextAfter,
    rootAuditId,
    timings,
  };
}

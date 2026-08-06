import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";

/**
 * The single writer for `audit_log` — Gate 1A.
 *
 * WHY A CHOKE POINT EXISTS AT ALL. Before this, 69 call sites across 20 files
 * inserted audit rows directly, through seven separately-defined private
 * `logAudit`/`audit` helpers with differing signatures. Adding a column to the
 * table would not have made it populated; it would have made it populated at
 * the sites someone remembered to update. The 70th call site gets written by
 * someone reading one of the other 69, and whichever one they read decides
 * whether provenance survives.
 *
 * That is the same failure Costs certification found twice — fan-out
 * implemented on one axis only, and the causal-revision contract present on one
 * path of eleven. Both were "implemented correctly everywhere they were
 * implemented." A contract that depends on recall is not a contract.
 *
 * `scripts/verify/audit-single-writer.ts` fails the build on any
 * `insert(auditLog)` outside this module, which is what makes call site 70
 * impossible rather than merely discouraged.
 *
 * WHAT IT GUARANTEES. Every row carries event-time actor identity:
 *
 *   user_id             live relationship — nulled if the user is deleted
 *   actor_user_id       immutable event-time id, deliberately NO foreign key
 *   actor_display_name  human-readable event-time identity
 *
 * The Pricing trace stops when it reaches a person. Holding identity only in
 * `user_id`, whose FK is ON DELETE SET NULL, means one user deletion breaks
 * every chain that terminated in them. Provenance is a statement about what
 * happened, and what happened does not change when someone leaves.
 *
 * The display name is resolved as a scalar subquery inside the INSERT rather
 * than a prior SELECT, so this costs no additional round trip and stays correct
 * when the caller has only a user id.
 */

/** Transaction handle, so audit writes join the transaction they describe. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export type AuditEntry = {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  /** Defaults to `{}` — matches the prior behaviour of every private helper. */
  diffJson?: object;
  summary?: string | null;
  entityLabel?: string | null;
  /** Cascade root, per the Slice RI.1 tagging commitment. */
  causedByAuditId?: string | null;
};

/**
 * Write one audit row.
 *
 * Pass the transaction when the audit belongs to the write it describes — an
 * audit that can commit without its mutation, or vice versa, is not evidence.
 */
export async function writeAuditEntry(entry: AuditEntry, tx?: Executor): Promise<void> {
  const exec = tx ?? db;
  await exec.insert(auditLog).values({
    userId: entry.userId,
    // Snapshotted at write time. actor_user_id carries no FK by design: an FK
    // would reintroduce the coupling this exists to remove.
    actorUserId: entry.userId,
    actorDisplayName: sql`(select ${users.name} from ${users} where ${users.id} = ${entry.userId})`,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    diffJson: entry.diffJson ?? {},
    ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
    ...(entry.entityLabel !== undefined ? { entityLabel: entry.entityLabel } : {}),
    ...(entry.causedByAuditId !== undefined ? { causedByAuditId: entry.causedByAuditId } : {}),
  });
}

/**
 * Write one audit row and return its id, for callers that need to tag derived
 * rows with `causedByAuditId`.
 */
export async function writeAuditEntryReturningId(
  entry: AuditEntry,
  tx?: Executor,
): Promise<string> {
  const exec = tx ?? db;
  const [row] = await exec
    .insert(auditLog)
    .values({
      userId: entry.userId,
      actorUserId: entry.userId,
      actorDisplayName: sql`(select ${users.name} from ${users} where ${users.id} = ${entry.userId})`,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      diffJson: entry.diffJson ?? {},
      ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
      ...(entry.entityLabel !== undefined ? { entityLabel: entry.entityLabel } : {}),
      ...(entry.causedByAuditId !== undefined ? { causedByAuditId: entry.causedByAuditId } : {}),
    })
    .returning({ id: auditLog.id });
  return row.id;
}

/**
 * Resolve an actor's display name. Exposed for the backfill only — runtime
 * writes resolve it inline above, without a second round trip.
 */
export async function resolveActorDisplayName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

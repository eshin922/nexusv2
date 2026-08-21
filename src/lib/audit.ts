import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { ActionGuardError, ERR } from "@/lib/action-result";

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
 * FAILS CLOSED ON AN UNRESOLVED ACTOR. A scalar subquery that quietly returned
 * NULL would write exactly the broken terminal this exists to prevent, so the
 * actor is resolved and asserted before anything is written. An audit row
 * naming nobody is worse than a rejected write: the write can be retried, the
 * unattributable row cannot be repaired.
 *
 * A user who EXISTS but has no display name is a different case and must not be
 * blocked -- `users.name` is nullable and one current user has none. Blocking
 * would stop that person performing any audited action. They get a deterministic
 * identifier instead, which is R11's "thin terminal": a person was reached, and
 * their name simply was not recorded. That is a fact, not a gap.
 */

/**
 * Never empty. A user with no recorded name still terminates a chain in a
 * person; the terminal states the absence rather than rendering nothing.
 */
function displayNameFor(id: string, name: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed !== "" ? trimmed : `${FALLBACK_ACTOR_PREFIX}${id.slice(0, 8)})`;
}

/**
 * A fallback identity is NOT a sourced display name.
 *
 * The trace grades terminals: sourced ones carry a real recorded identity, thin
 * ones state an absence. `Unnamed user (8f3a1c2d)` reached a person and says
 * their name was never recorded — it must not be rendered as though someone
 * actually typed that. Without this distinction the fallback would silently
 * upgrade thin provenance into full provenance, which is the failure the two
 * terminal grades exist to prevent.
 *
 * Consumers grade with `isFallbackActorIdentity`; the prefix and the predicate
 * live together so the format cannot drift away from its own detector.
 */
const FALLBACK_ACTOR_PREFIX = "Unnamed user (";

export function isFallbackActorIdentity(displayName: string | null): boolean {
  return (displayName ?? "").startsWith(FALLBACK_ACTOR_PREFIX);
}

/**
 * The system actors permitted to terminate a trace.
 *
 * A closed set, deliberately. Every entry is a claim that some process acts on
 * its own behalf, and each one is a place a Gate 1B trace can legitimately stop
 * without reaching a person — so adding one should require saying so out loud,
 * not passing a new string at a call site.
 *
 * Names read as systems, never as people. A trace that stops here must be
 * unmistakably reporting a machine act; anything that could be misread as a
 * human name would defeat the distinction this exists to make.
 */
export const SYSTEM_ACTORS = {
  /** NetSuite Item Group push with no acting operator. */
  netsuiteIntegration: "NetSuite integration",
  /**
   * Refusal of a sign-in by an identity Nexus has no record of.
   *
   * There is deliberately no person to attribute this to. The identity that
   * attempted is NOT a Nexus actor — that is the entire finding — and naming
   * them as the actor would assert an enrollment the refusal exists to deny.
   * The attempted address is recorded on the row as the SUBJECT instead.
   */
  enrollmentGate: "Enrollment gate",
} as const;

export type SystemActor = (typeof SYSTEM_ACTORS)[keyof typeof SYSTEM_ACTORS];

/**
 * Resolve the acting user, or refuse. Returns the display name to snapshot.
 */
async function requireActor(userId: string, exec: Executor): Promise<string> {
  if (!userId?.trim()) {
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "An audit entry was attempted without an acting user.",
    );
  }
  const [row] = await exec
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    // The supplied id does not resolve. Writing the row anyway would produce an
    // audit entry that names nobody -- the broken terminal, created fresh.
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "The acting user for this audit entry could not be resolved, so the action was not recorded and was not saved.",
    );
  }
  return displayNameFor(row.id, row.name);
}

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
  const actorDisplayName = await requireActor(entry.userId, exec);
  await exec.insert(auditLog).values({
    userId: entry.userId,
    // Snapshotted at write time, always from the SUPPLIED id and independent of
    // the live FK. actor_user_id carries no FK by design: an FK would
    // reintroduce the coupling this exists to remove.
    actorUserId: entry.userId,
    actorDisplayName,
    actorKind: "human" as const,
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
  const actorDisplayName = await requireActor(entry.userId, exec);
  const [row] = await exec
    .insert(auditLog)
    .values({
      userId: entry.userId,
      actorUserId: entry.userId,
      actorDisplayName,
      actorKind: "human" as const,
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
 * Write several audit rows in ONE statement.
 *
 * Cascade patterns emit a root row plus N derived rows and insert the derived
 * set as a single batch. Looping `writeAuditEntry` would turn one statement
 * into N — a change in how the action emits, which the sweep must not make.
 * The actor is resolved once for the batch, since every row in a cascade shares
 * one acting person by construction.
 */
export async function writeAuditEntries(
  entries: AuditEntry[],
  tx?: Executor,
): Promise<void> {
  if (entries.length === 0) return;
  const exec = tx ?? db;
  const userIds = new Set(entries.map((e) => e.userId));
  if (userIds.size !== 1) {
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      "A batched audit write mixed acting users; cascade rows must share one actor.",
    );
  }
  const actorDisplayName = await requireActor(entries[0].userId, exec);
  await exec.insert(auditLog).values(
    entries.map((entry) => ({
      userId: entry.userId,
      actorUserId: entry.userId,
      actorDisplayName,
      actorKind: "human" as const,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      diffJson: entry.diffJson ?? {},
      ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
      ...(entry.entityLabel !== undefined ? { entityLabel: entry.entityLabel } : {}),
      ...(entry.causedByAuditId !== undefined ? { causedByAuditId: entry.causedByAuditId } : {}),
    })),
  );
}

export type SystemAuditEntry = Omit<AuditEntry, "userId"> & {
  /** Must come from SYSTEM_ACTORS. The set is closed on purpose. */
  systemActor: SystemActor;
};

/**
 * Write one audit row for an act with no acting person.
 *
 * The row terminates in the system, explicitly. `actor_user_id` is NULL and
 * `actor_kind` is `system`, so a Gate 1B trace arriving here reports a machine
 * act rather than reporting that it failed to find a human. Those are different
 * outcomes and the trace must be able to tell them apart without guessing from
 * a null.
 *
 * `user_id` is left NULL as well. Attaching a live user to a machine act would
 * make the row look operator-initiated to anything reading the FK, which is the
 * fabrication this model exists to prevent.
 *
 * Use this ONLY where no person acted. If an operator triggered the work, the
 * event is human even though a machine performed it — pass their id to
 * `writeAuditEntry` instead. The distinction is who is accountable, not what
 * executed.
 */
export async function writeSystemAuditEntry(
  entry: SystemAuditEntry,
  tx?: Executor,
): Promise<void> {
  const exec = tx ?? db;
  await exec.insert(auditLog).values({
    userId: null,
    actorUserId: null,
    actorDisplayName: entry.systemActor,
    actorKind: "system" as const,
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
 * Exposed for the backfill, which must apply the same never-empty rule to
 * historical rows that runtime writes apply to new ones.
 */
export async function resolveActorDisplayName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? displayNameFor(row.id, row.name) : null;
}

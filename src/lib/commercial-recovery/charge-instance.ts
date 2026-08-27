/**
 * Charge-instance identity — OD-032 phase 1.
 *
 * One helper, one job: given a quote and a charge, return the durable instance
 * id an election keys to, creating it if this is the charge's first election.
 *
 * ── WHY THIS IS A FUNCTION AND NOT INLINE ────────────────────────────────
 *
 * Two writers create elections — the recovery persist path and
 * `cloneQuoteGraph`. Phase 1's whole claim is that every write carries an
 * instance, and two call sites deriving that independently is how one of them
 * ends up not doing it. There is exactly one derivation, and it is here.
 *
 * ── IT NEVER READS owner_ref FROM ANYWHERE ───────────────────────────────
 *
 * The owner is `'@quote'` — a literal, defaulted here. It is never read from
 * `quote_snapshot_recovery_instructions.owner_ref`, which is anchor-coerced
 * (OD-028) and can differ between a quote and its copy. An identity derived
 * from that anchor would move when the anchor moved.
 *
 * That is not a convention this file merely follows. It is falsified in
 * `tests/unit/od-032-charge-instance-identity.test.ts`, which permutes the
 * anchor and asserts the resolved instance is unchanged.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { quoteChargeInstances } from "@/db/schema";

/** The sentinel owner for a charge caused by the engagement, not a component. */
export const QUOTE_OWNER_REF = "@quote";

/**
 * `db` or a transaction handle. Typed as the former because Drizzle's
 * transaction type is structurally compatible for these two statements.
 */
type Runner = Pick<typeof db, "select" | "insert">;

export type ChargeInstanceKey = {
  quoteId: string;
  chargeKey: string;
  /** Defaults to `'@quote'`. A `quote_leaves` id once phase 2 lands. */
  ownerRef?: string;
  /** Required for `other`; an optional override otherwise. */
  label?: string | null;
};

/**
 * Resolve — and if necessary create — the instance an election keys to.
 *
 * Idempotent by the business-uniqueness constraint: a second call for the same
 * `(quote, charge, owner, label)` returns the first call's row rather than
 * minting a rival identity for one commercial fact.
 */
export async function ensureChargeInstance(
  runner: Runner,
  args: ChargeInstanceKey,
): Promise<string> {
  const ownerRef = args.ownerRef ?? QUOTE_OWNER_REF;
  const label = args.label ?? null;

  // `IS NULL`, never `= NULL`. The constraint is NULLS NOT DISTINCT, so an
  // unlabelled charge has exactly one row — but an equality comparison matches
  // none of them, which would mint a duplicate on every single election.
  const match = and(
    eq(quoteChargeInstances.quoteId, args.quoteId),
    eq(quoteChargeInstances.chargeKey, args.chargeKey as never),
    eq(quoteChargeInstances.ownerRef, ownerRef),
    label === null ? isNull(quoteChargeInstances.label) : eq(quoteChargeInstances.label, label),
  );

  const found = await runner
    .select({ id: quoteChargeInstances.id })
    .from(quoteChargeInstances)
    .where(match)
    .limit(1);
  if (found.length > 0) return found[0].id;

  const inserted = await runner
    .insert(quoteChargeInstances)
    .values({
      quoteId: args.quoteId,
      chargeKey: args.chargeKey as never,
      ownerRef,
      label,
    })
    .onConflictDoNothing()
    .returning({ id: quoteChargeInstances.id });
  if (inserted.length > 0) return inserted[0].id;

  // Lost a race; the constraint held and the winner's row is the identity.
  // Re-read rather than retry the insert.
  const again = await runner
    .select({ id: quoteChargeInstances.id })
    .from(quoteChargeInstances)
    .where(match)
    .limit(1);
  if (again.length === 0) {
    throw new Error(
      `charge instance for ${args.quoteId}/${args.chargeKey}/${ownerRef} could neither be created nor found`,
    );
  }
  return again[0].id;
}

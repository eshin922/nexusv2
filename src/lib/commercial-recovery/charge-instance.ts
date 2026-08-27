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
 *
 * ── THE OWNER IS TWO COLUMNS, AND THEY CANNOT DISAGREE ────────────────────
 *
 * Phase 2 added `owner_quote_leaf_id` — a real FK, so that deleting a component
 * cascades to the charges it caused rather than stranding them — and a CHECK
 * tying it to `owner_ref`:
 *
 *   (owner_ref = '@quote' AND owner_quote_leaf_id IS NULL)
 *     OR (owner_quote_leaf_id IS NOT NULL AND owner_ref = owner_quote_leaf_id::text)
 *
 * Until this change the helper wrote `owner_ref` alone, so a component owner
 * satisfied NEITHER branch and the database refused the insert outright. That
 * was the CHECK doing its job — the inconsistent state was unrepresentable, and
 * the helper was one of the writers that would have produced it.
 *
 * So the leaf id is derived here, from the one value the caller passes, and
 * written to both columns. A caller cannot supply them separately and cannot
 * make them disagree.
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
  /**
   * Defaults to `'@quote'`. Otherwise a `quote_leaves` id — the component that
   * caused the charge.
   *
   * ONE value, not two. `owner_quote_leaf_id` is derived from this rather than
   * accepted alongside it, because two parameters can disagree and the CHECK
   * would then reject the write at the database instead of the caller being
   * unable to express the mistake.
   */
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

  // The FK half of the owner. NULL for the engagement, the leaf id itself for a
  // component — which is the CHECK's second branch satisfied by construction.
  const ownerQuoteLeafId = ownerRef === QUOTE_OWNER_REF ? null : ownerRef;

  // `IS NULL`, never `= NULL`. The constraint is NULLS NOT DISTINCT, so an
  // unlabelled charge has exactly one row — but an equality comparison matches
  // none of them, which would mint a duplicate on every single election.
  //
  // The lookup matches `owner_ref` only, deliberately. It is the business
  // constraint's own column and the CHECK guarantees the FK agrees with it, so
  // adding a second owner predicate would narrow the search by a value that
  // cannot differ — and would silently mint a duplicate if it ever did, which
  // is the opposite of what a redundant check should do.
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
      ownerQuoteLeafId,
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

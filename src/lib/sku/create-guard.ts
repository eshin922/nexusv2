import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaves, skuAllocations } from "@/db/schema";
import { ActionGuardError, ERR } from "@/lib/action-result";

/**
 * The guards around creating a product that carries a reserved identifier.
 *
 * ── THE ORDER IS THE POINT ───────────────────────────────────────────────
 *
 * A reservation is preserved and marked dispatched BEFORE the external create
 * leaves, so a crash in between is distinguishable from never having sent it.
 * "Never sent" is safe to retry. "Sent, outcome unknown" is not, and the whole
 * reason to record the difference is that the two look identical afterwards.
 *
 * ── THE CLAIM IS A STATE TRANSITION, NOT A NOTE ──────────────────────────
 *
 * Dispatch is claimed by moving the reservation OUT of `allocated` in a single
 * conditional UPDATE. That is what makes it enforced rather than merely
 * visible: a marker that leaves the state usable stops nothing, because the
 * next caller reads the same usable state and proceeds. Two concurrent callers
 * both match `state = allocated` only if the write is not conditional on it;
 * being conditional, exactly one row is updated and exactly one caller
 * continues.
 *
 * A process that dies after claiming leaves the reservation claimed. That is
 * the correct outcome, not a leak: the request may have reached HubSpot, so
 * the state that means "outcome unresolved" is precisely the state it should
 * be left in.
 *
 * ── NOTHING HERE ADOPTS AN EXTERNAL PRODUCT ──────────────────────────────
 *
 * When an outcome is unknown the reservation is HELD with whatever is known --
 * including the HubSpot product id when there is one -- and creation is
 * refused until a person resolves it. `hs_sku` carries `hasUniqueValue`, so
 * HubSpot rejects a duplicate rather than returning the existing product, and
 * there is no safe automatic recovery.
 */

/**
 * Marker distinguishing a reservation claimed and still in flight from one
 * whose failure has been settled. Both are `conflicted` -- both are unresolved
 * -- and the note is for the human reading the listing, never for control
 * flow.
 */
const INFLIGHT_PREFIX = "inflight:";

/**
 * Refuse a SKU that is already taken — in the catalog OR by an outstanding
 * reservation.
 *
 * Applies to typed SKUs as much as generated ones. Create previously checked
 * NEITHER, leaving HubSpot to reject duplicates: a rule enforced in the wrong
 * catalog, and one that says nothing about a number Nexus has reserved and not
 * yet applied.
 */
export async function assertSkuFree(
  sku: string,
  opts: { ignoreAllocationId?: string | null } = {},
): Promise<void> {
  const normalized = sku.trim().toUpperCase();
  if (normalized === "") return;

  const [inCatalog] = await db
    .select({ id: leaves.id, name: leaves.name })
    .from(leaves)
    .where(sql`upper(btrim(${leaves.sku})) = ${normalized}`)
    .limit(1);
  if (inCatalog) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `SKU "${sku}" already belongs to "${inCatalog.name}". A SKU identifies ` +
        "one product; two products cannot share one.",
    );
  }

  // A reservation counts. The number is spent the moment it is issued --
  // assigned SKUs are never recycled -- so typing one another intent is
  // holding must be refused rather than silently duplicated.
  const held = await db
    .select({ id: skuAllocations.id, state: skuAllocations.state })
    .from(skuAllocations)
    .where(
      opts.ignoreAllocationId
        ? and(
            sql`upper(btrim(${skuAllocations.sku})) = ${normalized}`,
            ne(skuAllocations.id, opts.ignoreAllocationId),
          )
        : sql`upper(btrim(${skuAllocations.sku})) = ${normalized}`,
    )
    .limit(1);
  if (held.length > 0) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `SKU "${sku}" is already reserved by another create. Reserved numbers are ` +
        "never reissued, so this one cannot be used here.",
    );
  }
}

/**
 * Refuse to proceed on a reservation that is not usable.
 *
 * `conflicted` is the one that matters: a previous attempt left an outcome
 * nobody has resolved, and running again would be the blind retry this exists
 * to prevent.
 */
export async function requireAllocationUsable(
  allocationId: string,
  sku: string | null,
): Promise<void> {
  const [row] = await db
    .select()
    .from(skuAllocations)
    .where(eq(skuAllocations.id, allocationId))
    .limit(1);
  if (!row) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That SKU reservation no longer exists. Generate a new one.",
    );
  }
  if (row.state === "conflicted") {
    throw new ActionGuardError(
      ERR.DATA_INTEGRITY,
      `This SKU reservation is unresolved from an earlier attempt` +
        (row.hubspotProductId
          ? ` — HubSpot product ${row.hubspotProductId} may already carry it`
          : "") +
        `. It will not be reissued and the create is refused until someone ` +
        `checks what exists. Support listing: npm run support:sku-unresolved`,
    );
  }
  if (row.state === "applied") {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That SKU reservation is already applied to a product.",
    );
  }
  if (row.state === "abandoned") {
    throw new ActionGuardError(
      ERR.VALIDATION,
      "That SKU reservation was abandoned. Generate a new one.",
    );
  }
  if (sku !== null && sku.trim().toUpperCase() !== row.sku.trim().toUpperCase()) {
    // The field was typed over after generating. Refused rather than bound to
    // a different string, and the reservation stays spent.
    throw new ActionGuardError(
      ERR.VALIDATION,
      `The SKU being saved ("${sku}") is not the one reserved ("${row.sku}").`,
    );
  }
}

/**
 * Atomically claim a reservation for one dispatch.
 *
 * Returns true only for the caller whose UPDATE matched. The condition
 * `state = 'allocated'` is what makes this a claim: Postgres serialises the
 * two writers on the row, the second sees the state the first left, and its
 * WHERE no longer matches. No advisory lock is needed because the row itself
 * is the lock.
 *
 * A false return means someone else holds it -- a concurrent submission, or a
 * previous attempt that never resolved. Either way this caller must not call
 * HubSpot.
 *
 * The claimed state is `conflicted`, reusing the state that already means
 * "unresolved, needs a human". While the request is in flight the outcome IS
 * unresolved, and if the process dies here that is exactly what it should be
 * left as. No migration is required to say so.
 */
export async function claimAllocationForDispatch(
  allocationId: string,
): Promise<boolean> {
  const claimed = await db
    .update(skuAllocations)
    .set({
      state: "conflicted",
      note: `${INFLIGHT_PREFIX}${new Date().toISOString()}`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(skuAllocations.id, allocationId), eq(skuAllocations.state, "allocated")),
    )
    .returning({ id: skuAllocations.id });
  return claimed.length === 1;
}

/**
 * Release a claim after an ANSWERED refusal.
 *
 * HubSpot replied and made nothing, so the outcome is resolved and the
 * reservation goes back to usable. Conditional on the in-flight marker still
 * being ours, so a settle that happened in between is never overwritten.
 */
export async function releaseAllocationAfterRejection(
  allocationId: string,
): Promise<void> {
  await db
    .update(skuAllocations)
    .set({ state: "allocated", note: null, updatedAt: new Date() })
    .where(
      and(
        eq(skuAllocations.id, allocationId),
        eq(skuAllocations.state, "conflicted"),
        sql`${skuAllocations.note} like ${INFLIGHT_PREFIX + "%"}`,
      ),
    );
}

/**
 * Hold a reservation whose outcome nobody knows.
 *
 * Keeps the number spent, records what is known, and blocks further creates on
 * it. It does NOT adopt whatever may exist externally, and it does not
 * abandon: an unused reservation may stay spent forever, which costs a number
 * and nothing else.
 */
export async function holdAllocationUnresolved(
  allocationId: string,
  args: { note: string; hubspotProductId: string | null },
): Promise<void> {
  await db
    .update(skuAllocations)
    .set({
      state: "conflicted",
      note: args.note.slice(0, 500),
      hubspotProductId: args.hubspotProductId,
      updatedAt: new Date(),
    })
    .where(eq(skuAllocations.id, allocationId));
}

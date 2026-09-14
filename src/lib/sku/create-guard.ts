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
 * ── NOTHING HERE ADOPTS AN EXTERNAL PRODUCT ──────────────────────────────
 *
 * When an outcome is unknown the reservation is HELD with whatever is known --
 * including the HubSpot product id when there is one -- and creation is
 * refused until a person resolves it. `hs_sku` carries `hasUniqueValue`, so
 * HubSpot rejects a duplicate rather than returning the existing product;
 * there is no safe automatic recovery, and claiming one anyway is how two
 * products end up 31 seconds apart.
 */

/** Marker written into `note` while a create is in flight. */
const DISPATCH_PREFIX = "dispatched:";

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
 * Record that a create is about to leave, or clear that mark.
 *
 * Deliberately written into `note` rather than a new column: this release adds
 * no migration, and the distinction it carries -- dispatched versus not -- is
 * only consulted by a human reading the support listing. The states that
 * machinery reads are still the `state` column.
 */
export async function markAllocationDispatched(
  allocationId: string,
  opts: { clear?: boolean } = {},
): Promise<void> {
  await db
    .update(skuAllocations)
    .set({
      note: opts.clear ? null : `${DISPATCH_PREFIX}${new Date().toISOString()}`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(skuAllocations.id, allocationId), eq(skuAllocations.state, "allocated")),
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

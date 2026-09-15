import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { formatSku, normalizeToken } from "./format";
import {
  leaves,
  skuAllocations,
  skuBrandRegistry,
  skuCounters,
} from "@/db/schema";

/**
 * SKU allocation.
 *
 * ── THE FEATURE IS OFF BY CONSTRUCTION, NOT BY A FLAG ────────────────────
 *
 * Three independent conditions must hold before a single identifier can be
 * issued, and production satisfies none of them:
 *
 *   1. the brand token is `approved` in the registry  (production: no rows)
 *   2. its counter has been seeded                    (production: no rows)
 *   3. `SKU_GENERATION_ENABLED=1`                     (production: unset)
 *
 * Any one of them absent refuses. A flag alone would have been the wrong
 * shape: a flag is one edit away from being on, whereas an unseeded counter
 * cannot issue a number that does not exist. The flag is the outermost of the
 * three, not the only one.
 *
 * ── THE COUNTER CANNOT PREVENT COLLISIONS, ONLY PROPOSE CANDIDATES ───────
 *
 * The counter is authoritative for what NEXUS has allocated and for nothing
 * else. Products are created directly in HubSpot and items directly in
 * NetSuite, so a number this counter has never issued may already be taken.
 * Allocation is therefore a bounded loop that checks each candidate against
 * the catalog and advances past externally-created values -- and when the
 * loop is exhausted it REFUSES rather than issuing something unchecked.
 *
 * Detection is not prevention, and this says so rather than implying
 * otherwise: the catalog check narrows the window, it does not close it. The
 * `sku_allocations` unique index on the normalized SKU is what actually closes
 * it, because two concurrent allocations racing to one number cannot both
 * insert.
 */

/** The two indexes whose violations mean different things. */
const ATTEMPT_KEY_IDX = "sku_allocations_attempt_key_idx";
const SKU_IDX = "sku_allocations_sku_idx";

/**
 * Which unique index a failure violated, or null if it was not one.
 *
 * Named rather than inferred from the message: two constraints on one table
 * exclude two different failures, and treating them alike would adopt a
 * stranger's allocation or spin on a number that is genuinely taken.
 */
function uniqueViolation(e: unknown): string | null {
  const err = e as { code?: string; constraint_name?: string };
  if (err?.code !== "23505") return null;
  return err.constraint_name ?? "";
}

/** How far past a taken number to look before refusing. */
const MAX_PROBES = 50;

export type AllocationRefusal =
  | { kind: "disabled"; message: string }
  | { kind: "brand_required"; message: string }
  | { kind: "brand_not_registered"; message: string; token: string }
  | { kind: "brand_not_approved"; message: string; token: string }
  | { kind: "counter_not_seeded"; message: string; token: string }
  | { kind: "exhausted"; message: string; token: string }
  | { kind: "unresolved"; message: string; token: string };

export type AllocationOutcome =
  | { ok: true; sku: string; allocationId: string; token: string; number: number }
  | { ok: false; refusal: AllocationRefusal };

/** The outermost gate. Unset anywhere it has not been deliberately switched on. */
export function generationFlagEnabled(): boolean {
  return process.env.SKU_GENERATION_ENABLED === "1";
}



/**
 * Brands this operator may pick from: approved AND seeded.
 *
 * A brand that is approved but unseeded is deliberately NOT offered. Offering
 * it would present a choice that always fails at the moment of use, which
 * teaches an operator that the button is broken rather than that the brand is
 * not ready.
 */
export async function listAllocatableBrands(): Promise<
  { token: string; customerLabel: string }[]
> {
  if (!generationFlagEnabled()) return [];
  return db
    .select({
      token: skuBrandRegistry.token,
      customerLabel: skuBrandRegistry.customerLabel,
    })
    .from(skuBrandRegistry)
    .innerJoin(skuCounters, eq(skuCounters.token, skuBrandRegistry.token))
    .where(
      and(
        eq(skuBrandRegistry.status, "approved"),
        sql`${skuCounters.nextNumber} is not null`,
      ),
    )
    .orderBy(skuBrandRegistry.customerLabel);
}

/**
 * What a customer's registry entry is, as a closed set.
 *
 * `none` and `awaiting_setup` are DIFFERENT facts with different remedies --
 * no mapping exists yet, versus a mapping exists and its starting number has
 * not been established. Collapsing them into "cannot generate" would tell an
 * operator to do something that is already done.
 */
export type CustomerBrandState =
  | { kind: "none" }
  | { kind: "awaiting_setup"; token: string; customerLabel: string }
  | { kind: "ready"; token: string; customerLabel: string };

/**
 * The registry entry for a customer RECORD.
 *
 * Resolved from the HubSpot company id -- never from the product's or the
 * project's NAME. A name match would be the same name-derivation the registry
 * exists to prevent, arriving one layer later.
 *
 * `ready` means all three conditions hold, so `allocateSku` will issue. It is
 * checked against `listAllocatableBrands` rather than re-derived, so this
 * cannot drift from what the allocator will actually accept.
 */
export async function customerBrandState(
  hubspotCompanyId: string | null,
): Promise<CustomerBrandState> {
  if (!hubspotCompanyId) return { kind: "none" };
  const [row] = await db
    .select({
      token: skuBrandRegistry.token,
      customerLabel: skuBrandRegistry.customerLabel,
    })
    .from(skuBrandRegistry)
    .where(
      and(
        eq(skuBrandRegistry.hubspotCompanyId, hubspotCompanyId),
        eq(skuBrandRegistry.status, "approved"),
      ),
    )
    .limit(1);
  if (!row) return { kind: "none" };

  const allowed = await listAllocatableBrands();
  return allowed.some((b) => b.token === row.token)
    ? { kind: "ready", token: row.token, customerLabel: row.customerLabel }
    : { kind: "awaiting_setup", token: row.token, customerLabel: row.customerLabel };
}

/**
 * The allocatable brand for a customer, or null.
 *
 * Thin wrapper over `customerBrandState` for the one caller that only needs
 * the yes/no. Kept separate so a caller cannot accidentally treat
 * `awaiting_setup` as allocatable by reading a truthy token off it.
 */
export async function registeredBrandForCompany(
  hubspotCompanyId: string | null,
): Promise<{ token: string; customerLabel: string } | null> {
  const state = await customerBrandState(hubspotCompanyId);
  return state.kind === "ready"
    ? { token: state.token, customerLabel: state.customerLabel }
    : null;
}

/**
 * Allocate one SKU for one creation intent.
 *
 * Idempotent on `attemptKey`: the same intent retried returns the SAME
 * allocation rather than consuming a second number. That is the property the
 * `attempt_key` unique index exists to guarantee, and it is what lets the UI
 * keep a generated value across save retries without holding it in component
 * state where a remount would lose it.
 */
export async function allocateSku(args: {
  token: string;
  attemptKey: string;
  userId: string;
}): Promise<AllocationOutcome> {
  const token = normalizeToken(args.token);

  if (!generationFlagEnabled()) {
    return {
      ok: false,
      refusal: {
        kind: "disabled",
        message:
          "SKU generation is not enabled in this environment. It stays off " +
          "until the registry is approved and counters are seeded.",
      },
    };
  }
  if (token === "") {
    return {
      ok: false,
      refusal: {
        kind: "brand_required",
        message: "Choose a brand. There is no default namespace.",
      },
    };
  }

  // An existing allocation for this intent is returned as-is, before any
  // counter is touched.
  const [existing] = await db
    .select()
    .from(skuAllocations)
    .where(eq(skuAllocations.attemptKey, args.attemptKey))
    .limit(1);
  if (existing) {
    // A HELD reservation is not handed back as though it were usable. An
    // earlier attempt on this intent left an outcome nobody has resolved, and
    // returning it here would put the identifier back in the field and invite
    // exactly the blind retry the hold exists to stop.
    if (existing.state === "conflicted" || existing.state === "abandoned") {
      return {
        ok: false,
        refusal: {
          kind: "unresolved",
          token: existing.token,
          message:
            `An earlier attempt with this SKU is unresolved` +
            (existing.hubspotProductId
              ? ` — HubSpot product ${existing.hubspotProductId} may already carry it`
              : "") +
            `. It will not be reissued; someone has to check what exists first.`,
        },
      };
    }
    return {
      ok: true,
      sku: existing.sku,
      allocationId: existing.id,
      token: existing.token,
      number: existing.number,
    };
  }

  return db.transaction(async (tx) => {
    const [brand] = await tx
      .select()
      .from(skuBrandRegistry)
      .where(eq(skuBrandRegistry.token, token))
      .limit(1);
    if (!brand) {
      return {
        ok: false as const,
        refusal: {
          kind: "brand_not_registered" as const,
          token,
          message: `"${token}" is not a registered brand. Tokens come from the registry, never from a product name.`,
        },
      };
    }
    if (brand.status !== "approved") {
      return {
        ok: false as const,
        refusal: {
          kind: "brand_not_approved" as const,
          token,
          message: `"${token}" is proposed but not approved, so it cannot issue identifiers yet.`,
        },
      };
    }

    // Row-locked so two concurrent allocations for one brand serialize here
    // rather than racing to the same number and losing one to the unique index.
    const [counter] = await tx
      .select()
      .from(skuCounters)
      .where(eq(skuCounters.token, token))
      .for("update")
      .limit(1);

    if (!counter || counter.nextNumber === null) {
      return {
        ok: false as const,
        refusal: {
          kind: "counter_not_seeded" as const,
          token,
          message:
            `The counter for "${token}" has not been seeded. Seeding must read ` +
            "the live catalogs and start above the highest existing number; " +
            "until it does, no number here would be known to be free.",
        },
      };
    }

    // Bounded probe. Each candidate is checked against the catalog AND against
    // prior allocations, because a number can be taken by either -- a product
    // created straight in HubSpot, or an allocation that has not been applied
    // yet.
    let n = counter.nextNumber;
    for (let probe = 0; probe < MAX_PROBES; probe++, n++) {
      const candidate = formatSku(token, n);
      const norm = candidate.toUpperCase();

      const [clash] = await tx
        .select({ id: leaves.id })
        .from(leaves)
        .where(sql`upper(btrim(${leaves.sku})) = ${norm}`)
        .limit(1);
      if (clash) continue;

      const [held] = await tx
        .select({ id: skuAllocations.id })
        .from(skuAllocations)
        .where(sql`upper(btrim(${skuAllocations.sku})) = ${norm}`)
        .limit(1);
      if (held) continue;

      // Inside a SAVEPOINT, because a unique violation aborts the enclosing
      // transaction and there are two violations here worth surviving.
      // Retry safety rests on the CONSTRAINT, not on having checked first --
      // the checks above only narrow the window, and the index is what closes
      // it.
      let insertedId: string | null = null;
      try {
        const rows = await tx.transaction(async (sp) =>
          sp
            .insert(skuAllocations)
            .values({
              attemptKey: args.attemptKey,
              sku: candidate,
              token,
              number: n,
              state: "allocated",
              allocatedByUserId: args.userId,
            })
            .returning({ id: skuAllocations.id }),
        );
        insertedId = rows[0].id;
      } catch (e) {
        const violated = uniqueViolation(e);

        // Another concurrent retry of THIS SAME INTENT won. It allocated on
        // our behalf, so adopt its allocation -- one intent, one number, which
        // is the whole point of the attempt key. Issuing a second number here
        // would be the exact failure the constraint exists to prevent.
        if (violated === ATTEMPT_KEY_IDX) {
          const [winner] = await tx
            .select()
            .from(skuAllocations)
            .where(eq(skuAllocations.attemptKey, args.attemptKey))
            .limit(1);
          if (winner) {
            return {
              ok: true as const,
              sku: winner.sku,
              allocationId: winner.id,
              token: winner.token,
              number: winner.number,
            };
          }
        }

        // Someone took this number between our check and our insert. That is
        // the window the check could never close; advance and try the next.
        if (violated === SKU_IDX) continue;

        throw e;
      }

      await tx
        .update(skuCounters)
        .set({ nextNumber: n + 1, updatedAt: new Date() })
        .where(eq(skuCounters.token, token));

      return {
        ok: true as const,
        sku: candidate,
        allocationId: insertedId,
        token,
        number: n,
      };
    }

    // Refuses rather than issuing something unchecked. Fifty consecutive taken
    // numbers means the counter's seed is wrong, and guessing past that would
    // mint a colliding identity.
    return {
      ok: false as const,
      refusal: {
        kind: "exhausted" as const,
        token,
        message:
          `Checked ${MAX_PROBES} consecutive numbers for "${token}" and every one ` +
          "is already taken. The counter's seed is probably below the catalog; " +
          "it needs re-seeding rather than another attempt.",
      },
    };
  });
}

export { formatSku, normalizeToken };

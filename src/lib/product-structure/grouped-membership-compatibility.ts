import { and, eq, inArray } from "drizzle-orm";
import { ensureQuoteSpecAuthority } from "./quote-spec-authority";
import type { db } from "../../db/index.ts";
import { assemblies, assemblyLeaves, quoteLeaves } from "../../db/schema.ts";

export type CompatibilityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type CompatibilityFaultPoint =
  | "attach_after_canonical"
  | "detach_after_legacy"
  | "quantity_after_canonical"
  | "reorder_after_canonical";

export type CompatibilityFaultInjector = (
  point: CompatibilityFaultPoint,
) => void | Promise<void>;

export class GroupedMembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupedMembershipConflictError";
  }
}

type AttachGroupedMembershipArgs = {
  quoteId: string;
  assemblyId: string;
  leafId: string;
  quantity: string;
  position: number;
  /** B-3 — attribution for the quote-owned spec instantiated here. */
  createdBy: string;
  /** Copy Quote — template the new authority from this source quote. */
  specTemplateFromQuoteId?: string;
  createdAt?: Date;
  fault?: CompatibilityFaultInjector;
};

export type GroupedMembershipEvidence = {
  assemblyLeafId: string;
  quoteLeafId: string;
  quoteId: string;
  assemblyId: string;
  leafId: string;
  quantity: string;
  position: number;
};

async function assertNoConflictingMembership(
  tx: CompatibilityTransaction,
  args: Pick<AttachGroupedMembershipArgs, "quoteId" | "assemblyId" | "leafId">,
): Promise<void> {
  const legacy = await tx
    .select({ id: assemblyLeaves.id })
    .from(assemblyLeaves)
    .where(
      and(
        eq(assemblyLeaves.assemblyId, args.assemblyId),
        eq(assemblyLeaves.leafId, args.leafId),
      ),
    )
    .limit(1);
  const canonical = await tx
    .select({ id: quoteLeaves.id })
    .from(quoteLeaves)
    .where(
      and(
        eq(quoteLeaves.quoteId, args.quoteId),
        eq(quoteLeaves.assemblyId, args.assemblyId),
        eq(quoteLeaves.leafId, args.leafId),
      ),
    )
    .limit(1);
  if (legacy.length > 0 || canonical.length > 0) {
    throw new GroupedMembershipConflictError(
      "This leaf is already attached to this assembly.",
    );
  }
}

export async function attachGroupedMembership(
  tx: CompatibilityTransaction,
  args: AttachGroupedMembershipArgs,
): Promise<GroupedMembershipEvidence> {
  await assertNoConflictingMembership(tx, args);

  const [assembly] = await tx
    .select({ quoteId: assemblies.quoteId })
    .from(assemblies)
    .where(eq(assemblies.id, args.assemblyId))
    .limit(1);
  if (!assembly || assembly.quoteId !== args.quoteId) {
    throw new GroupedMembershipConflictError(
      "Product and membership Quote identity do not match.",
    );
  }

  // B-3 — same rule as the Direct path: the quote owns its specification from
  // attachment. Idempotent, so a leaf attached to two Item Groups in one quote
  // resolves to ONE authority rather than minting a second.
  const authority = await ensureQuoteSpecAuthority(tx as never, {
    quoteId: args.quoteId,
    leafId: args.leafId,
    createdBy: args.createdBy,
    templateFromQuoteId: args.specTemplateFromQuoteId,
  });

  const [canonical] = await tx
    .insert(quoteLeaves)
    .values({
      quoteId: args.quoteId,
      assemblyId: args.assemblyId,
      leafId: args.leafId,
      leafSpecVersionId: authority.id,
      pinnedAt: new Date(),
      quantity: args.quantity,
      position: args.position,
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .returning();

  await args.fault?.("attach_after_canonical");

  const [legacy] = await tx
    .insert(assemblyLeaves)
    .values({
      assemblyId: args.assemblyId,
      leafId: args.leafId,
      quantity: args.quantity,
      position: args.position,
      parentAssemblyLeafId: null,
      quoteLeafId: canonical.id,
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .returning();

  return {
    assemblyLeafId: legacy.id,
    quoteLeafId: canonical.id,
    quoteId: args.quoteId,
    assemblyId: args.assemblyId,
    leafId: args.leafId,
    quantity: legacy.quantity,
    position: legacy.position,
  };
}

async function loadMappedMembership(
  tx: CompatibilityTransaction,
  assemblyLeafId: string,
): Promise<GroupedMembershipEvidence | null> {
  const [row] = await tx
    .select({ legacy: assemblyLeaves, canonical: quoteLeaves, quoteId: assemblies.quoteId })
    .from(assemblyLeaves)
    .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
    .leftJoin(quoteLeaves, eq(quoteLeaves.id, assemblyLeaves.quoteLeafId))
    .where(eq(assemblyLeaves.id, assemblyLeafId))
    .limit(1);
  if (!row) return null;
  if (
    !row.canonical ||
    row.legacy.quoteLeafId !== row.canonical.id ||
    row.quoteId !== row.canonical.quoteId ||
    row.legacy.assemblyId !== row.canonical.assemblyId ||
    row.legacy.leafId !== row.canonical.leafId ||
    Number(row.legacy.quantity) !== Number(row.canonical.quantity) ||
    row.legacy.position !== row.canonical.position
  ) {
    throw new GroupedMembershipConflictError(
      `Grouped membership ${assemblyLeafId} has an invalid canonical mapping.`,
    );
  }
  return {
    assemblyLeafId: row.legacy.id,
    quoteLeafId: row.canonical.id,
    quoteId: row.quoteId,
    assemblyId: row.legacy.assemblyId,
    leafId: row.legacy.leafId,
    quantity: row.legacy.quantity,
    position: row.legacy.position,
  };
}

export async function detachGroupedMembership(
  tx: CompatibilityTransaction,
  args: { assemblyLeafId: string; fault?: CompatibilityFaultInjector },
): Promise<GroupedMembershipEvidence | null> {
  const membership = await loadMappedMembership(tx, args.assemblyLeafId);
  if (!membership) return null;

  // Delete legacy first so its existing ON DELETE CASCADE behavior for
  // inputs/overrides/targets is preserved. Then delete the canonical row
  // explicitly; never depend on quote_leaves -> assembly_leaves cascade.
  await tx
    .delete(assemblyLeaves)
    .where(eq(assemblyLeaves.id, membership.assemblyLeafId));
  await args.fault?.("detach_after_legacy");
  await tx.delete(quoteLeaves).where(eq(quoteLeaves.id, membership.quoteLeafId));
  return membership;
}

export async function detachGroupedMembershipsForAssembly(
  tx: CompatibilityTransaction,
  assemblyId: string,
): Promise<GroupedMembershipEvidence[]> {
  const rows = await tx
    .select({ id: assemblyLeaves.id })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.assemblyId, assemblyId));
  const evidence: GroupedMembershipEvidence[] = [];
  for (const row of rows) {
    const detached = await detachGroupedMembership(tx, {
      assemblyLeafId: row.id,
    });
    if (detached) evidence.push(detached);
  }
  return evidence;
}

export async function updateGroupedMembershipQuantity(
  tx: CompatibilityTransaction,
  args: {
    assemblyLeafId: string;
    quantity: string;
    fault?: CompatibilityFaultInjector;
  },
): Promise<GroupedMembershipEvidence> {
  const membership = await loadMappedMembership(tx, args.assemblyLeafId);
  if (!membership) {
    throw new GroupedMembershipConflictError("Grouped membership not found.");
  }
  await tx
    .update(quoteLeaves)
    .set({ quantity: args.quantity })
    .where(eq(quoteLeaves.id, membership.quoteLeafId));
  await args.fault?.("quantity_after_canonical");
  await tx
    .update(assemblyLeaves)
    .set({ quantity: args.quantity })
    .where(eq(assemblyLeaves.id, membership.assemblyLeafId));
  return { ...membership, quantity: args.quantity };
}

export async function reorderGroupedMemberships(
  tx: CompatibilityTransaction,
  args: {
    assemblyId: string;
    orderedAssemblyLeafIds: string[];
    fault?: CompatibilityFaultInjector;
  },
): Promise<GroupedMembershipEvidence[]> {
  const rows = await tx
    .select({ id: assemblyLeaves.id, assemblyId: assemblyLeaves.assemblyId })
    .from(assemblyLeaves)
    .where(inArray(assemblyLeaves.id, args.orderedAssemblyLeafIds));
  if (
    rows.length !== args.orderedAssemblyLeafIds.length ||
    rows.some((row) => row.assemblyId !== args.assemblyId)
  ) {
    throw new GroupedMembershipConflictError(
      "All grouped memberships must belong to the same Product.",
    );
  }

  const memberships: Array<GroupedMembershipEvidence | null> = [];
  for (const id of args.orderedAssemblyLeafIds) {
    memberships.push(await loadMappedMembership(tx, id));
  }
  if (memberships.some((membership) => membership === null)) {
    throw new GroupedMembershipConflictError("Grouped membership not found.");
  }
  const mapped = memberships as GroupedMembershipEvidence[];

  for (let position = 0; position < mapped.length; position++) {
    await tx
      .update(quoteLeaves)
      .set({ position })
      .where(eq(quoteLeaves.id, mapped[position].quoteLeafId));
  }
  await args.fault?.("reorder_after_canonical");
  for (let position = 0; position < mapped.length; position++) {
    await tx
      .update(assemblyLeaves)
      .set({ position })
      .where(eq(assemblyLeaves.id, mapped[position].assemblyLeafId));
  }
  return mapped.map((membership, position) => ({ ...membership, position }));
}

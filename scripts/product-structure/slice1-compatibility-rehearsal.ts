import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import {
  attachGroupedMembership,
  detachGroupedMembership,
  reorderGroupedMemberships,
  updateGroupedMembershipQuantity,
} from "../../src/lib/product-structure/grouped-membership-compatibility.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
const parsed = new URL(url);
if (!parsed.pathname.slice(1).includes("compatibility_test")) {
  throw new Error("Compatibility rehearsal refused: database name lacks compatibility_test");
}

const client = postgres(url, { max: 4, prepare: false });
const db = drizzle(client, { schema });

async function counts(assemblyId: string, leafId: string) {
  const [legacy, canonical] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.assemblyLeaves)
      .where(and(eq(schema.assemblyLeaves.assemblyId, assemblyId), eq(schema.assemblyLeaves.leafId, leafId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.quoteLeaves)
      .where(and(eq(schema.quoteLeaves.assemblyId, assemblyId), eq(schema.quoteLeaves.leafId, leafId))),
  ]);
  return { legacy: legacy[0].count, canonical: canonical[0].count };
}

async function main() {
  const [target] = await db.select({
    assemblyId: schema.assemblies.id,
    quoteId: schema.assemblies.quoteId,
  }).from(schema.assemblies)
    .innerJoin(schema.quotes, eq(schema.quotes.id, schema.assemblies.quoteId))
    .where(eq(schema.quotes.status, "draft"))
    .limit(1);
  assert.ok(target, "representative copy needs a draft Product");

  const existing = new Set((await db.select({ leafId: schema.assemblyLeaves.leafId })
    .from(schema.assemblyLeaves)
    .where(eq(schema.assemblyLeaves.assemblyId, target.assemblyId))).map((r) => r.leafId));
  const candidates = (await db.select({ id: schema.leaves.id }).from(schema.leaves)
    .where(eq(schema.leaves.archived, false)))
    .filter((leaf) => !existing.has(leaf.id)).slice(0, 4);
  assert.equal(candidates.length, 4, "representative copy needs four unattached LEAFs");

  const injected = async () => { throw new Error("injected compatibility failure"); };
  await assert.rejects(
    db.transaction((tx) => attachGroupedMembership(tx, {
      quoteId: target.quoteId, assemblyId: target.assemblyId,
      leafId: candidates[0].id, quantity: "2", position: 90, fault: injected,
    })),
    /injected compatibility failure/,
  );
  assert.deepEqual(await counts(target.assemblyId, candidates[0].id), { legacy: 0, canonical: 0 });

  const attached = await db.transaction((tx) => attachGroupedMembership(tx, {
    quoteId: target.quoteId, assemblyId: target.assemblyId,
    leafId: candidates[0].id, quantity: "2", position: 90,
  }));
  assert.deepEqual(await counts(target.assemblyId, candidates[0].id), { legacy: 1, canonical: 1 });

  await assert.rejects(
    db.transaction((tx) => updateGroupedMembershipQuantity(tx, {
      assemblyLeafId: attached.assemblyLeafId, quantity: "7", fault: injected,
    })),
  );
  let [pair] = await db.select({ legacy: schema.assemblyLeaves.quantity, canonical: schema.quoteLeaves.quantity })
    .from(schema.assemblyLeaves)
    .innerJoin(schema.quoteLeaves, eq(schema.quoteLeaves.id, schema.assemblyLeaves.quoteLeafId))
    .where(eq(schema.assemblyLeaves.id, attached.assemblyLeafId));
  assert.equal(Number(pair.legacy), 2);
  assert.equal(Number(pair.canonical), 2);
  await db.transaction((tx) => updateGroupedMembershipQuantity(tx, {
    assemblyLeafId: attached.assemblyLeafId, quantity: "7",
  }));
  [pair] = await db.select({ legacy: schema.assemblyLeaves.quantity, canonical: schema.quoteLeaves.quantity })
    .from(schema.assemblyLeaves)
    .innerJoin(schema.quoteLeaves, eq(schema.quoteLeaves.id, schema.assemblyLeaves.quoteLeafId))
    .where(eq(schema.assemblyLeaves.id, attached.assemblyLeafId));
  assert.equal(Number(pair.legacy), 7);
  assert.equal(Number(pair.canonical), 7);

  const concurrent = await Promise.allSettled([0, 1].map(() =>
    db.transaction((tx) => attachGroupedMembership(tx, {
      quoteId: target.quoteId, assemblyId: target.assemblyId,
      leafId: candidates[1].id, quantity: "1", position: 91,
    })),
  ));
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  assert.deepEqual(await counts(target.assemblyId, candidates[1].id), { legacy: 1, canonical: 1 });

  const two = await db.select({ id: schema.assemblyLeaves.id, position: schema.assemblyLeaves.position })
    .from(schema.assemblyLeaves).where(eq(schema.assemblyLeaves.assemblyId, target.assemblyId))
    .orderBy(schema.assemblyLeaves.position).limit(2);
  assert.equal(two.length, 2);
  const reversed = two.map((row) => row.id).reverse();
  const beforePositions = two.map((row) => row.position);
  await assert.rejects(db.transaction((tx) => reorderGroupedMemberships(tx, {
    assemblyId: target.assemblyId, orderedAssemblyLeafIds: reversed, fault: injected,
  })));
  const afterFailedReorder = await db.select({ id: schema.assemblyLeaves.id, position: schema.assemblyLeaves.position })
    .from(schema.assemblyLeaves).where(inArray(schema.assemblyLeaves.id, two.map((row) => row.id)))
    .orderBy(schema.assemblyLeaves.position);
  assert.deepEqual(afterFailedReorder.map((row) => row.position), beforePositions);
  await db.transaction((tx) => reorderGroupedMemberships(tx, {
    assemblyId: target.assemblyId, orderedAssemblyLeafIds: reversed,
  }));

  const [tier] = await db.select({ id: schema.quoteTiers.id }).from(schema.quoteTiers)
    .where(eq(schema.quoteTiers.quoteId, target.quoteId)).limit(1);
  assert.ok(tier, "representative copy needs a tier for dependent detach proof");
  await db.insert(schema.assemblyLeafInputs).values({
    assemblyLeafId: attached.assemblyLeafId, tierId: tier.id,
    lineGroupId: randomUUID(), sortOrder: 0,
  });
  await db.insert(schema.assemblyLeafOverrides).values({
    assemblyLeafId: attached.assemblyLeafId, tierId: tier.id, sellPriceOverride: "12.34",
  });
  await db.insert(schema.assemblyLeafTargets).values({
    assemblyLeafId: attached.assemblyLeafId, tierId: tier.id, clientTargetPricePerUnit: "11.11",
  });
  await assert.rejects(db.transaction((tx) => detachGroupedMembership(tx, {
    assemblyLeafId: attached.assemblyLeafId, fault: injected,
  })));
  assert.deepEqual(await counts(target.assemblyId, candidates[0].id), { legacy: 1, canonical: 1 });
  await db.transaction((tx) => detachGroupedMembership(tx, { assemblyLeafId: attached.assemblyLeafId }));
  assert.deepEqual(await counts(target.assemblyId, candidates[0].id), { legacy: 0, canonical: 0 });
  const [dependentCounts] = await db.select({
    inputs: sql<number>`(SELECT count(*) FROM assembly_leaf_inputs WHERE assembly_leaf_id=${attached.assemblyLeafId})::int`,
    overrides: sql<number>`(SELECT count(*) FROM assembly_leaf_overrides WHERE assembly_leaf_id=${attached.assemblyLeafId})::int`,
    targets: sql<number>`(SELECT count(*) FROM assembly_leaf_targets WHERE assembly_leaf_id=${attached.assemblyLeafId})::int`,
    leaves: sql<number>`(SELECT count(*) FROM leaves WHERE id=${candidates[0].id})::int`,
  }).from(schema.quotes).limit(1);
  assert.deepEqual(dependentCounts, { inputs: 0, overrides: 0, targets: 0, leaves: 1 });

  // Clone/copy membership creation uses the same canonical-first primitive.
  const [cloneAssembly] = await db.insert(schema.assemblies).values({
    quoteId: target.quoteId,
    sku: `COMPAT-${randomUUID()}`,
    name: "Slice 1 compatibility clone fixture",
    position: 999,
  }).returning({ id: schema.assemblies.id });
  const cloneSources = await db.select({
    leafId: schema.assemblyLeaves.leafId,
    quantity: schema.assemblyLeaves.quantity,
    position: schema.assemblyLeaves.position,
  }).from(schema.assemblyLeaves)
    .where(eq(schema.assemblyLeaves.assemblyId, target.assemblyId)).limit(2);
  for (const source of cloneSources) {
    await db.transaction((tx) => attachGroupedMembership(tx, {
      quoteId: target.quoteId,
      assemblyId: cloneAssembly.id,
      leafId: source.leafId,
      quantity: source.quantity,
      position: source.position,
    }));
  }
  const [cloneMapping] = await db.select({
    legacy: sql<number>`count(*)::int`,
    canonical: sql<number>`count(${schema.quoteLeaves.id})::int`,
    distinctCanonical: sql<number>`count(DISTINCT ${schema.assemblyLeaves.quoteLeafId})::int`,
  }).from(schema.assemblyLeaves)
    .innerJoin(schema.quoteLeaves, eq(schema.quoteLeaves.id, schema.assemblyLeaves.quoteLeafId))
    .where(eq(schema.assemblyLeaves.assemblyId, cloneAssembly.id));
  assert.deepEqual(cloneMapping, {
    legacy: cloneSources.length,
    canonical: cloneSources.length,
    distinctCanonical: cloneSources.length,
  });

  const [reconciliation] = await db.select({
    unmapped: sql<number>`(SELECT count(*) FROM assembly_leaves WHERE quote_leaf_id IS NULL)::int`,
    mismatch: sql<number>`(
      SELECT count(*) FROM assembly_leaves al
      JOIN assemblies a ON a.id=al.assembly_id
      JOIN quote_leaves ql ON ql.id=al.quote_leaf_id
      WHERE ql.quote_id<>a.quote_id OR ql.assembly_id IS DISTINCT FROM al.assembly_id
         OR ql.leaf_id<>al.leaf_id OR ql.quantity<>al.quantity OR ql.position<>al.position
    )::int`,
  }).from(schema.quotes).limit(1);
  assert.deepEqual(reconciliation, { unmapped: 0, mismatch: 0 });
  process.stdout.write(`${JSON.stringify({ pass: true, reconciliation, externalCalls: 0 })}\n`);
}

try { await main(); } finally { await client.end({ timeout: 5 }); }

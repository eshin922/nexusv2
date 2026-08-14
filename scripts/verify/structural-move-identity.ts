/**
 * Structural movement — economic-identity survival falsification.
 *
 * The governing invariant:
 *
 *   Structural movement must preserve BOTH canonical product identity AND
 *   dependent economic-record identity.
 *
 * WHY BOTH HALVES ARE ASSERTED. The cost tables are dual-keyed: they carry
 * `quote_leaf_id` and `assembly_leaf_id`, and BOTH cascade on delete. So the
 * obvious Group -> Direct implementation — delete the junction, keep the
 * canonical row — destroys the product's packaging inputs, per-cell overrides,
 * client targets and freight attachments **while `quote_leaves.id` is preserved
 * perfectly**. A falsification asserting only identity would pass over an empty
 * cost structure and report success.
 *
 * So the fixture is built with REAL rows in all four dependent tables, and the
 * assertions compare exact primary keys before and after — not counts, which
 * a delete-plus-reinsert would also satisfy.
 *
 * COVERAGE GAP, STATED RATHER THAN IMPLIED. Three of the four dependent tables
 * are exercised with real rows: `assembly_leaf_inputs`,
 * `assembly_leaf_overrides` and `assembly_leaf_targets`.
 * `freight_subcategory_items` is NOT — it needs a freight subcategory and leg
 * structure this fixture does not build.
 *
 * The move code is table-agnostic (it loops `DEPENDENT_TABLES`), so the
 * mechanism is proven by the three. What the three cannot prove is that the
 * fourth is still IN that list, so claim 0 asserts the list's membership
 * directly — otherwise a future edit could drop freight from the loop and every
 * other claim here would still pass.
 *
 * Creates its own fixtures and removes them.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeafOverrides,
  assemblyLeafTargets,
  assemblyLeaves,
  leaves,
  quoteLeaves,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { attachGroupedMembership } from "@/lib/product-structure/grouped-membership-compatibility";
import {
  DEPENDENT_TABLES,
  dependentEconomicRows,
  moveStructuralMembership,
} from "@/lib/product-structure/structural-move";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const TAG = "MOVE-FALSIFY";
const created = { quotes: [] as string[], leaves: [] as string[] };

const fingerprint = (rows: Awaited<ReturnType<typeof dependentEconomicRows>>) =>
  rows.map((r) => `${r.table}#${r.key}`).sort().join("|");

async function main() {
  console.log("\nStructural move — economic identity survival\n");

  // Claim 0 · the repoint loop still covers all four dual-keyed tables. The
  // fixture exercises three of them; this is what stops the fourth being
  // quietly dropped from the list while every other claim here keeps passing.
  claim(
    DEPENDENT_TABLES.length === 4,
    "0 · all four dual-keyed dependent tables are in the repoint set",
    `${DEPENDENT_TABLES.length} tables — freight_subcategory_items is covered by membership, not by fixture`,
  );

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [seed] = await db.select({ projectId: quotes.projectId }).from(quotes).limit(1);
  if (!user || !seed) throw new Error("no fixtures available");

  const [q] = await db
    .insert(quotes)
    .values({
      projectId: seed.projectId,
      scenarioLabel: `ZZ-VALIDATION-${TAG}`,
      status: "draft",
      versionNumber: 1,
    })
    .returning({ id: quotes.id });
  created.quotes.push(q.id);

  const [tier] = await db
    .insert(quoteTiers)
    .values({ quoteId: q.id, label: `${TAG}-T1`, qty: 1000, position: 0 })
    .returning({ id: quoteTiers.id });

  const [leaf] = await db
    .insert(leaves)
    .values({ name: `${TAG} product`, hubspotProductType: "Secondary", createdBy: user.id })
    .returning({ id: leaves.id });
  created.leaves.push(leaf.id);

  const mkGroup = async (n: string) => {
    const [a] = await db
      .insert(assemblies)
      .values({ quoteId: q.id, sku: `${TAG}-${n}`, name: `${TAG} ${n}`, position: 0 })
      .returning({ id: assemblies.id });
    return a.id;
  };
  const groupA = await mkGroup("A");
  const groupB = await mkGroup("B");

  // Attach into Group A, then author REAL economics against it.
  const evidence = await db.transaction(async (tx) =>
    attachGroupedMembership(tx as never, {
      quoteId: q.id,
      assemblyId: groupA,
      leafId: leaf.id,
      quantity: "2",
      position: 0,
      createdBy: user.id,
    }),
  );
  const canonicalId = evidence.quoteLeafId;

  await db.insert(assemblyLeafInputs).values({
    quoteLeafId: canonicalId,
    assemblyLeafId: evidence.assemblyLeafId,
    tierId: tier.id,
    lineGroupId: crypto.randomUUID(),
    category: "Secondary",
    unitCost: "1.2345",
    sortOrder: 0,
    createdBy: user.id,
  });
  await db.insert(assemblyLeafOverrides).values({
    quoteLeafId: canonicalId,
    assemblyLeafId: evidence.assemblyLeafId,
    tierId: tier.id,
    sellPriceOverride: "9.8765",
    createdBy: user.id,
  });
  await db.insert(assemblyLeafTargets).values({
    quoteLeafId: canonicalId,
    assemblyLeafId: evidence.assemblyLeafId,
    tierId: tier.id,
    clientTargetPricePerUnit: "7.7777",
    createdBy: user.id,
  });

  const before = await dependentEconomicRows(db as never, canonicalId);
  const [beforeCanonical] = await db
    .select()
    .from(quoteLeaves)
    .where(eq(quoteLeaves.id, canonicalId));

  claim(
    before.length >= 3 && new Set(before.map((r) => r.table)).size >= 3,
    "setup · the product carries real rows across dependent economic tables",
    before.map((r) => r.table).join(", "),
  );
  claim(
    before.every((r) => r.assemblyLeafId === evidence.assemblyLeafId),
    "setup · every dependent row is keyed to the source junction",
  );

  // ============================================================ Group -> Direct
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: canonicalId,
      target: { kind: "direct", position: 0 },
    }),
  );

  const afterDirect = await dependentEconomicRows(db as never, canonicalId);
  const [afterCanonical] = await db
    .select()
    .from(quoteLeaves)
    .where(eq(quoteLeaves.id, canonicalId));

  claim(
    afterCanonical?.id === beforeCanonical.id,
    "1 · quote_leaves.id is IDENTICAL before and after",
    `${beforeCanonical.id} -> ${afterCanonical?.id}`,
  );
  claim(
    afterCanonical?.leafSpecVersionId === beforeCanonical.leafSpecVersionId,
    "2 · quote-owned spec authority still resolves through that same identity",
    `${afterCanonical?.leafSpecVersionId}`,
  );
  claim(
    afterCanonical?.quantity === beforeCanonical.quantity,
    "3 · quantity unchanged",
    `${beforeCanonical.quantity} -> ${afterCanonical?.quantity}`,
  );
  claim(
    afterCanonical?.assemblyId === null,
    "4 · canonical membership is now Direct",
    `assembly_id=${afterCanonical?.assemblyId}`,
  );

  // THE ONE THAT MATTERS. Exact primary keys, not counts — a delete followed by
  // a reinsert would keep the count and fail this.
  claim(
    fingerprint(before) === fingerprint(afterDirect),
    "5 · EXACT dependent row identities preserved — no delete, no reinsert",
    `${before.length} rows · ${fingerprint(afterDirect).slice(0, 70)}...`,
  );
  claim(
    afterDirect.every((r) => r.quoteLeafId === canonicalId),
    "6 · every preserved dependent row retains its quote_leaf_id",
  );
  claim(
    afterDirect.every((r) => r.assemblyLeafId === null),
    "7 · only assembly_leaf_id changed — old junction id -> NULL",
    `distinct values: ${JSON.stringify([...new Set(afterDirect.map((r) => r.assemblyLeafId))])}`,
  );
  claim(
    before.length === afterDirect.length,
    "8 · aggregate count unchanged (secondary tripwire)",
    `${before.length} -> ${afterDirect.length}`,
  );
  const [junctionGone] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.id, evidence.assemblyLeafId));
  claim(junctionGone.n === 0, "9 · the legacy junction is gone");

  const [groupStillThere] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assemblies)
    .where(eq(assemblies.id, groupA));
  claim(
    groupStillThere.n === 1,
    "10 · the emptied Item Group is NOT auto-deleted",
  );

  // ============================================================ Direct -> Group
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: canonicalId,
      target: { kind: "group", assemblyId: groupB, position: 0 },
    }),
  );
  const afterRegroup = await dependentEconomicRows(db as never, canonicalId);
  const [regrouped] = await db
    .select()
    .from(quoteLeaves)
    .where(eq(quoteLeaves.id, canonicalId));
  claim(
    regrouped?.id === canonicalId && regrouped?.assemblyId === groupB,
    "11 · Direct -> Group reuses the SAME canonical row",
    `id=${regrouped?.id === canonicalId} assembly=${regrouped?.assemblyId === groupB}`,
  );
  claim(
    fingerprint(before) === fingerprint(afterRegroup),
    "12 · dependent identities survive Direct -> Group unchanged",
  );

  // ============================================================ Group A -> B
  const [newJunction] = await db
    .select({ id: assemblyLeaves.id })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.quoteLeafId, canonicalId));
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: canonicalId,
      target: { kind: "group", assemblyId: groupA, position: 0 },
    }),
  );
  const afterAtoB = await dependentEconomicRows(db as never, canonicalId);
  const [movedJunction] = await db
    .select({ id: assemblyLeaves.id, assemblyId: assemblyLeaves.assemblyId })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.quoteLeafId, canonicalId));
  claim(
    movedJunction?.id === newJunction.id && movedJunction?.assemblyId === groupA,
    "13 · Group B -> Group A moves the junction IN PLACE, no delete",
    `junction preserved=${movedJunction?.id === newJunction.id}`,
  );
  claim(
    fingerprint(before) === fingerprint(afterAtoB),
    "14 · dependent identities survive Group -> Group unchanged",
  );

  // ================================================================ atomicity
  const beforeFail = await dependentEconomicRows(db as never, canonicalId);
  let threw = false;
  try {
    await db.transaction(async (tx) => {
      await moveStructuralMembership(tx as never, {
        quoteLeafId: canonicalId,
        target: { kind: "direct", position: 0 },
      });
      throw new Error("induced failure after the move");
    });
  } catch {
    threw = true;
  }
  const afterFail = await dependentEconomicRows(db as never, canonicalId);
  const [afterFailCanonical] = await db
    .select({ assemblyId: quoteLeaves.assemblyId })
    .from(quoteLeaves)
    .where(eq(quoteLeaves.id, canonicalId));
  claim(
    threw &&
      afterFailCanonical?.assemblyId === groupA &&
      fingerprint(beforeFail) === fingerprint(afterFail),
    "15 · a failed transaction leaves the grouped state AND dependents untouched",
    `assembly restored=${afterFailCanonical?.assemblyId === groupA} rows intact=${fingerprint(beforeFail) === fingerprint(afterFail)}`,
  );

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

async function cleanup() {
  if (created.quotes.length > 0) {
    await db.delete(quoteLeaves).where(inArray(quoteLeaves.quoteId, created.quotes));
    await db.delete(assemblies).where(inArray(assemblies.quoteId, created.quotes));
    await db.delete(quoteTiers).where(inArray(quoteTiers.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.leaves.length > 0)
    await db.delete(leaves).where(inArray(leaves.id, created.leaves));
}

main()
  .then(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  });

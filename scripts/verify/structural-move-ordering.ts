/**
 * Structural movement — the insertion indicator's promise, against a real DB.
 *
 * THE CLAIM:
 *
 *   The position the operator is shown before release is the position the
 *   database ends up in.
 *
 * WHY THIS IS SEPARATE FROM THE IDENTITY FALSIFICATION. That one asks whether
 * the product and its economics SURVIVE a move. This one asks whether the move
 * lands WHERE IT SAID. Both passed trivially before this change — the first
 * because it never inspected order, the second because there was no promise to
 * break: every drop was written at position 0.
 *
 * WHY IT NEEDS A DATABASE. `orderAfterMove` is unit-tested and pure, so the
 * arithmetic is already proven. What cannot be proven in a unit test is that
 * the rendered read-back — `ORDER BY position, created_at`, which is what the
 * tree actually loads — reproduces it. That is a property of the WRITE, and the
 * write is where the old defect lived: setting one row's position left ties
 * broken by creation time, an order no client can predict.
 *
 * So the assertions compare against the ordering the loader uses, not against
 * the positions written. A renumber that produced 0,1,1,2 would satisfy an
 * assertion about the moved row's own position and still render wrongly.
 *
 * Creates its own fixtures and removes them.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leaves,
  quoteLeaves,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { attachGroupedMembership } from "@/lib/product-structure/grouped-membership-compatibility";
import { attachDirectProduct } from "@/lib/product-structure/direct-attachment";
import { moveStructuralMembership } from "@/lib/product-structure/structural-move";
import { orderAfterMove } from "@/lib/product-structure/drop-plan";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const TAG = "MOVE-ORDER";
const created = { quotes: [] as string[], leaves: [] as string[] };

/** Exactly what the tree loader reads for a group's members. */
async function renderedGroup(assemblyId: string): Promise<string[]> {
  const rows = await db
    .select({ quoteLeafId: assemblyLeaves.quoteLeafId })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.assemblyId, assemblyId))
    .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt));
  return rows.map((r) => r.quoteLeafId as string);
}

/** Exactly what the tree loader reads for Direct Products. */
async function renderedDirect(quoteId: string): Promise<string[]> {
  const rows = await db
    .select({ id: quoteLeaves.id })
    .from(quoteLeaves)
    .where(and(eq(quoteLeaves.quoteId, quoteId), isNull(quoteLeaves.assemblyId)))
    .orderBy(asc(quoteLeaves.position), asc(quoteLeaves.createdAt));
  return rows.map((r) => r.id);
}

async function positionsOf(assemblyId: string): Promise<number[]> {
  const rows = await db
    .select({ position: assemblyLeaves.position })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.assemblyId, assemblyId))
    .orderBy(asc(assemblyLeaves.position));
  return rows.map((r) => r.position);
}

const eq_ = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  console.log("\nStructural move — promised position vs persisted position\n");

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [seed] = await db
    .select({ projectId: quotes.projectId })
    .from(quotes)
    .limit(1);
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

  await db
    .insert(quoteTiers)
    .values({ quoteId: q.id, label: `${TAG}-T1`, qty: 1000, position: 0 });

  const mkLeaf = async (n: number) => {
    const [l] = await db
      .insert(leaves)
      .values({
        name: `${TAG} product ${n}`,
        hubspotProductType: "Secondary",
        createdBy: user.id,
      })
      .returning({ id: leaves.id });
    created.leaves.push(l.id);
    return l.id;
  };
  const mkGroup = async (n: string) => {
    const [a] = await db
      .insert(assemblies)
      .values({
        quoteId: q.id,
        sku: `${TAG}-${n}`,
        name: `${TAG} ${n}`,
        position: 0,
      })
      .returning({ id: assemblies.id });
    return a.id;
  };

  const groupA = await mkGroup("A");
  const groupB = await mkGroup("B");

  // GROUP B IS POPULATED FIRST, AND THAT IS LOAD-BEARING.
  //
  // A tie in `position` is broken by `created_at`. If the arriving product is
  // always the OLDEST row in its destination, ties resolve forward — which is
  // the same direction the ordering rule inserts, so a completely broken write
  // still reads correctly and the cross-group claims pass by coincidence
  // (measured: they did, under a probe that disabled the renumber entirely).
  //
  // Creating B's members BEFORE A's makes the arriving product the YOUNGEST row
  // in B, so an unresolved tie sorts it the WRONG way and claim 3 can actually
  // fail. A fixture that cannot produce the failure cannot certify its absence.
  const bMembers: string[] = [];
  for (let i = 0; i < 2; i++) {
    const leafId = await mkLeaf(10 + i);
    const ev = await db.transaction(async (tx) =>
      attachGroupedMembership(tx as never, {
        quoteId: q.id,
        assemblyId: groupB,
        leafId,
        quantity: "1",
        position: i,
        createdBy: user.id,
      }),
    );
    bMembers.push(ev.quoteLeafId);
  }

  // Four members in Group A, created AFTER B's.
  const members: string[] = [];
  for (let i = 0; i < 4; i++) {
    const leafId = await mkLeaf(i);
    const ev = await db.transaction(async (tx) =>
      attachGroupedMembership(tx as never, {
        quoteId: q.id,
        assemblyId: groupA,
        leafId,
        quantity: "1",
        position: i,
        createdBy: user.id,
      }),
    );
    members.push(ev.quoteLeafId);
  }

  claim(
    eq_(await renderedGroup(groupA), members),
    "setup · the group renders in attachment order",
  );

  // ── 1 · Same-group reorder lands at the promised index, for EVERY index ────
  //
  // The moved row is the FIRST one, so its created_at is the earliest in the
  // group. Any implementation that leaves a position tie will sort it to the
  // top regardless of the requested index — which is precisely the defect, and
  // it is invisible if you only ever test moving the last row.
  let allIndexesHeld = true;
  const detail: string[] = [];
  for (const index of [0, 1, 2, 3]) {
    const before = await renderedGroup(groupA);
    const moving = before[0];
    const expected = orderAfterMove(
      before.filter((id) => id !== moving),
      moving,
      index,
    );
    await db.transaction(async (tx) =>
      moveStructuralMembership(tx as never, {
        quoteLeafId: moving,
        target: { kind: "group", assemblyId: groupA, position: index },
      }),
    );
    const after = await renderedGroup(groupA);
    if (!eq_(after, expected)) {
      allIndexesHeld = false;
      detail.push(`index ${index}: expected ${expected.map((x) => x.slice(0, 4))} got ${after.map((x) => x.slice(0, 4))}`);
    }
    // Put it back at the top for the next iteration.
    await db.transaction(async (tx) =>
      moveStructuralMembership(tx as never, {
        quoteLeafId: moving,
        target: { kind: "group", assemblyId: groupA, position: 0 },
      }),
    );
  }
  claim(
    allIndexesHeld,
    "1 · same-group reorder persists the promised index at every position",
    detail.join(" · ") || "0,1,2,3 all landed exactly",
  );

  // ── 2 · Positions are dense and unique ────────────────────────────────────
  const positions = await positionsOf(groupA);
  claim(
    positions.every((p, i) => p === i),
    "2 · destination positions are dense 0..n-1 — no ties left to break",
    `positions = [${positions.join(", ")}]`,
  );

  // ── 3 · Cross-group arrival lands at the promised index ───────────────────
  // Index 1 ties with B's second member. The arriving product is younger, so
  // an unrenumbered write sorts it AFTER that member — the wrong side.
  const bBefore = await renderedGroup(groupB);
  const incoming = (await renderedGroup(groupA))[2];
  const bExpected = orderAfterMove(bBefore, incoming, 1);
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: incoming,
      target: { kind: "group", assemblyId: groupB, position: 1 },
    }),
  );
  claim(
    eq_(await renderedGroup(groupB), bExpected),
    "3 · Group A -> Group B arrives at the promised index, not at the top",
  );

  // ── 4 · The origin group compacts ─────────────────────────────────────────
  const aPositions = await positionsOf(groupA);
  claim(
    aPositions.every((p, i) => p === i),
    "4 · the group the product LEFT is compacted, not left with a hole",
    `positions = [${aPositions.join(", ")}]`,
  );

  // ── 5 · Group -> Direct lands among the existing Direct rows ──────────────
  const dLeaf1 = await mkLeaf(20);
  const dLeaf2 = await mkLeaf(21);
  for (const [i, l] of [dLeaf1, dLeaf2].entries()) {
    await db.transaction(async (tx) =>
      attachDirectProduct(tx as never, {
        quoteId: q.id,
        leafId: l,
        quantity: "1",
        position: i,
        createdBy: user.id,
      }),
    );
  }
  const dBefore = await renderedDirect(q.id);
  const leaving = (await renderedGroup(groupB))[0];
  const dExpected = orderAfterMove(dBefore, leaving, 1);
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: leaving,
      target: { kind: "direct", position: 1 },
    }),
  );
  claim(
    eq_(await renderedDirect(q.id), dExpected),
    "5 · Group -> Direct lands BETWEEN the existing root products",
  );

  // ── 6 · Direct -> Group lands at the promised index ───────────────────────
  const gBefore = await renderedGroup(groupA);
  const promoting = (await renderedDirect(q.id))[0];
  const gExpected = orderAfterMove(gBefore, promoting, gBefore.length);
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: promoting,
      target: { kind: "group", assemblyId: groupA, position: gBefore.length },
    }),
  );
  claim(
    eq_(await renderedGroup(groupA), gExpected),
    "6 · Direct -> Group appends at the promised index",
  );

  // ── 7 · Out-of-range clamps rather than corrupting ────────────────────────
  const cBefore = await renderedGroup(groupA);
  const clamped = cBefore[0];
  await db.transaction(async (tx) =>
    moveStructuralMembership(tx as never, {
      quoteLeafId: clamped,
      target: { kind: "group", assemblyId: groupA, position: 999 },
    }),
  );
  const cAfter = await renderedGroup(groupA);
  claim(
    cAfter.length === cBefore.length && cAfter[cAfter.length - 1] === clamped,
    "7 · an out-of-range index clamps to the end, losing nothing",
  );
}

async function cleanup() {
  for (const quoteId of created.quotes) {
    const leafRows = await db
      .select({ id: quoteLeaves.id })
      .from(quoteLeaves)
      .where(eq(quoteLeaves.quoteId, quoteId));
    const ids = leafRows.map((r) => r.id);
    if (ids.length)
      await db.delete(assemblyLeaves).where(inArray(assemblyLeaves.quoteLeafId, ids));
    await db.delete(quoteLeaves).where(eq(quoteLeaves.quoteId, quoteId));
    await db.delete(assemblies).where(eq(assemblies.quoteId, quoteId));
    await db.delete(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));
    await db.delete(quotes).where(eq(quotes.id, quoteId));
  }
  if (created.leaves.length)
    await db.delete(leaves).where(inArray(leaves.id, created.leaves));
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n  ${checks - failures}/${checks} passed\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  });

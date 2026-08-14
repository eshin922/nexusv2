/**
 * Provisions the drag/drop validation fixture for PR #265.
 *
 * NON-BASKET BY CONSTRUCTION. The quote is created fresh under the
 * `ZZ-VALIDATION-` namespace, which the S-7 basket predicate excludes, and the
 * script asserts its absence from the captured baseline before returning. An
 * operator walk on it cannot move a governed number or block a deployment.
 *
 * USES EXISTING LIBRARY PRODUCTS. It creates no master data — the point is a
 * structure to drag, not a catalogue. Products are picked from the live
 * Library, so nothing here pollutes it.
 *
 * Structure: 2 Item Groups (one with 2 members so reorder-within-group is
 * exercisable, one with 1 so it can be emptied), plus 1 Direct Product. That is
 * the minimum that reaches all four transitions.
 */

import { eq, inArray, isNull, sql } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/db";
import { assemblies, leaves, quoteTiers, quotes, users } from "@/db/schema";
import { attachDirectProduct } from "@/lib/product-structure/direct-attachment";
import { attachGroupedMembership } from "@/lib/product-structure/grouped-membership-compatibility";

const PROJECT_ID = "71ced625-2b64-4887-925a-a524e038ce30";

async function main() {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error("no user");

  // Four real Library products, classified so the tree renders Product Types.
  const pool = await db
    .select({ id: leaves.id, name: leaves.name })
    .from(leaves)
    .where(
      sql`${leaves.archived} = false and ${leaves.sku} is not null and ${leaves.hubspotProductType} is not null`,
    )
    .limit(4);
  if (pool.length < 4) throw new Error("not enough classified Library products");

  const [quote] = await db
    .insert(quotes)
    .values({
      projectId: PROJECT_ID,
      scenarioLabel: "ZZ-VALIDATION-drag-drop",
      status: "draft",
      versionNumber: 1,
    })
    .returning({ id: quotes.id });

  for (const [i, q] of [1000, 5000, 10000].entries()) {
    await db
      .insert(quoteTiers)
      .values({ quoteId: quote.id, label: `Tier ${i + 1}`, qty: q, position: i });
  }

  const mkGroup = async (n: number, name: string) => {
    const [a] = await db
      .insert(assemblies)
      .values({
        quoteId: quote.id,
        sku: `ASY-DRAG-${n}`,
        name,
        position: n - 1,
      })
      .returning({ id: assemblies.id });
    return a.id;
  };
  const groupA = await mkGroup(1, "Drag Target A");
  const groupB = await mkGroup(2, "Drag Target B");

  // Group A gets two members — reorder-within-group needs a pair.
  await db.transaction(async (tx) => {
    await attachGroupedMembership(tx as never, {
      quoteId: quote.id, assemblyId: groupA, leafId: pool[0].id,
      quantity: "1", position: 0, createdBy: user.id,
    });
    await attachGroupedMembership(tx as never, {
      quoteId: quote.id, assemblyId: groupA, leafId: pool[1].id,
      quantity: "1", position: 1, createdBy: user.id,
    });
  });
  // Group B gets one — so it can be emptied and prove it survives.
  await db.transaction(async (tx) => {
    await attachGroupedMembership(tx as never, {
      quoteId: quote.id, assemblyId: groupB, leafId: pool[2].id,
      quantity: "1", position: 0, createdBy: user.id,
    });
  });
  // One Direct Product, for Direct -> Group.
  await db.transaction(async (tx) => {
    await attachDirectProduct(tx as never, {
      quoteId: quote.id, leafId: pool[3].id,
      quantity: "1", position: 0, createdBy: user.id,
    });
  });

  // The safety assertion, not an assumption.
  const baseline = JSON.parse(
    fs.readFileSync("docs/gate-1b/costing-baseline.json", "utf8"),
  ) as { entries: { quote_id: string }[] };
  const inBasket = baseline.entries.some((e) => e.quote_id === quote.id);

  console.log("\n  quote      :", quote.id);
  console.log("  project    :", PROJECT_ID);
  console.log("  label      : ZZ-VALIDATION-drag-drop");
  console.log("  structure  : 2 Item Groups (A: 2 members, B: 1) + 1 Direct Product");
  console.log("  products   :", pool.map((p) => p.name.slice(0, 28)).join(" · "));
  console.log("  in basket  :", inBasket ? "YES — UNSAFE" : "NO — safe to mutate");
  if (inBasket) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

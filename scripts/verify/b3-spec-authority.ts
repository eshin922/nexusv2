/**
 * B-3 · quote-owned spec authority — behavioural falsifications 1-10.
 *
 * Runs against the real database and CLEANS UP AFTER ITSELF. Falsification 11
 * ("no quote-context reader resolves Library is_current") is a source grep and
 * lives in tests/unit/product-setup-wiring.test.ts, because it is a property of
 * the code rather than of any run.
 *
 * Each claim states what must hold and prints PASS/FAIL. A run that cannot
 * establish a claim FAILS it rather than skipping — an unrunnable check that
 * reports nothing is indistinguishable from one that passed.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { leafSpecs, leaves, quoteLeaves, quotes, users } from "@/db/schema";
import { ensureQuoteSpecAuthority } from "@/lib/product-structure/quote-spec-authority";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const TAG = "B3-FALSIFY";
const created = { quotes: [] as string[], leaves: [] as string[] };

async function main() {
  console.log("\nB-3 falsifications 1-10\n");

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [anyQuote] = await db
    .select({ id: quotes.id, projectId: quotes.projectId })
    .from(quotes)
    .limit(1);
  if (!user || !anyQuote) throw new Error("no user/quote to build fixtures from");

  // Three quotes in a real project, and two library products: one WITH a
  // library default spec, one with none.
  const mk = async (label: string) => {
    const [q] = await db
      .insert(quotes)
      .values({
        projectId: anyQuote.projectId,
        scenarioLabel: `ZZ-VALIDATION-${TAG}-${label}`,
        status: "draft",
        versionNumber: 1,
      })
      .returning({ id: quotes.id });
    created.quotes.push(q.id);
    return q.id;
  };
  const qa = await mk("A");
  const qb = await mk("B");
  const qc = await mk("C");

  const mkLeaf = async (name: string) => {
    const [l] = await db
      .insert(leaves)
      .values({ name: `${TAG} ${name}`, createdBy: user.id })
      .returning({ id: leaves.id });
    created.leaves.push(l.id);
    return l.id;
  };
  const withDefault = await mkLeaf("with-default");
  const noDefault = await mkLeaf("no-default");

  // Library default for the first product.
  const [libDefault] = await db
    .insert(leafSpecs)
    .values({
      leafId: withDefault,
      specValues: { material: "LIBRARY-ORIGINAL" },
      versionNumber: 1,
      isCurrent: true,
      createdBy: user.id,
    })
    .returning();

  const attach = (quoteId: string, leafId: string) =>
    ensureQuoteSpecAuthority(db as never, { quoteId, leafId, createdBy: user.id });

  // ---------------------------------------------------------------- 1 + 2
  const a1 = await attach(qa, withDefault);
  const b1 = await attach(qb, withDefault);
  claim(a1.id !== b1.id, "1 · Quote A and Quote B receive INDEPENDENT authority",
    `A=${a1.id.slice(0, 8)} B=${b1.id.slice(0, 8)}`);
  claim(
    JSON.stringify(a1.specValues) === JSON.stringify({ material: "LIBRARY-ORIGINAL" }) &&
      JSON.stringify(b1.specValues) === JSON.stringify(a1.specValues),
    "2 · both initially inherit identical Library defaults",
    JSON.stringify(a1.specValues),
  );
  claim(
    a1.templatedFromSpecId === libDefault.id && b1.templatedFromSpecId === libDefault.id,
    "2b · provenance records the Library default each was templated from",
  );

  // ------------------------------------------------------------------- 3 + 4
  await db
    .update(leafSpecs)
    .set({ specValues: { material: "QUOTE-A-ONLY" } })
    .where(eq(leafSpecs.id, a1.id));

  const readB = await db.select().from(leafSpecs).where(eq(leafSpecs.id, b1.id));
  claim(
    (readB[0].specValues as Record<string, unknown>).material === "LIBRARY-ORIGINAL",
    "3 · editing Quote A does NOT change Quote B",
    `B still ${JSON.stringify(readB[0].specValues)}`,
  );
  const readLib = await db.select().from(leafSpecs).where(eq(leafSpecs.id, libDefault.id));
  claim(
    (readLib[0].specValues as Record<string, unknown>).material === "LIBRARY-ORIGINAL",
    "4 · editing Quote A does NOT change the Library default",
  );

  // ----------------------------------------------------------------------- 5
  await db
    .update(leafSpecs)
    .set({ productTypeId: "leaf_other" })
    .where(eq(leafSpecs.id, a1.id));
  const [leafRow] = await db
    .select({ productTypeId: leaves.productTypeId })
    .from(leaves)
    .where(eq(leaves.id, withDefault));
  const [bAfter] = await db.select().from(leafSpecs).where(eq(leafSpecs.id, b1.id));
  claim(
    leafRow.productTypeId === null && bAfter.productTypeId !== "leaf_other",
    "5 · Quote A type change touches neither Quote B nor the Library type",
    `library leaves.product_type_id=${leafRow.productTypeId}`,
  );

  // ------------------------------------------------------------------- 6 + 7
  await db
    .update(leafSpecs)
    .set({ specValues: { material: "LIBRARY-UPDATED" } })
    .where(eq(leafSpecs.id, libDefault.id));
  const [aAfterLib] = await db.select().from(leafSpecs).where(eq(leafSpecs.id, a1.id));
  const [bAfterLib] = await db.select().from(leafSpecs).where(eq(leafSpecs.id, b1.id));
  claim(
    (aAfterLib.specValues as Record<string, unknown>).material === "QUOTE-A-ONLY" &&
      (bAfterLib.specValues as Record<string, unknown>).material === "LIBRARY-ORIGINAL",
    "6 · updating the Library default changes NEITHER existing quote",
  );

  const c1 = await attach(qc, withDefault);
  claim(
    (c1.specValues as Record<string, unknown>).material === "LIBRARY-UPDATED",
    "7 · a quote attached AFTERWARDS receives the new Library default",
    JSON.stringify(c1.specValues),
  );

  // ----------------------------------------------------------------------- 8
  const a2 = await attach(qa, withDefault);
  claim(
    a2.id === a1.id,
    "8 · a second attachment of the same product in one quote reuses the authority",
    `${a2.id.slice(0, 8)} === ${a1.id.slice(0, 8)}`,
  );

  // ----------------------------------------------------------------------- 9
  const n1 = await attach(qa, noDefault);
  claim(
    n1.quoteId === qa && JSON.stringify(n1.specValues) === "{}" &&
      n1.templatedFromSpecId === null,
    "9a · a product with no Library spec gets an EMPTY quote-owned authority",
  );
  await db.insert(leafSpecs).values({
    leafId: noDefault,
    specValues: { material: "CREATED-LATER" },
    versionNumber: 1,
    isCurrent: true,
    createdBy: user.id,
  });
  const [n1After] = await db.select().from(leafSpecs).where(eq(leafSpecs.id, n1.id));
  claim(
    JSON.stringify(n1After.specValues) === "{}",
    "9b · and does NOT float to a Library default created afterwards",
    JSON.stringify(n1After.specValues),
  );

  // ---------------------------------------------------------------------- 10
  // Every pre-existing attachment — including sent/accepted/complete quotes —
  // resolves an authority its own quote owns. This is the backfill's claim, and
  // it is checked over the whole live population rather than a sample.
  const [unresolved] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM quote_leaves ql
    LEFT JOIN leaf_specs ls ON ls.id = ql.leaf_spec_version_id
    WHERE ql.leaf_spec_version_id IS NULL
       OR ls.quote_id IS DISTINCT FROM ql.quote_id
       OR ls.leaf_id <> ql.leaf_id
  `)) as unknown as Array<{ n: number }>;
  const [sentPop] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM quote_leaves ql
    JOIN quotes q ON q.id = ql.quote_id
    WHERE q.status IN ('sent','accepted','complete')
  `)) as unknown as Array<{ n: number }>;
  claim(
    unresolved.n === 0,
    "10 · every attachment resolves quote-owned authority, sent/accepted included",
    `unresolved=${unresolved.n} · sent/accepted/complete attachments=${sentPop.n}`,
  );

  console.log(`\n  ${failures === 0 ? "ALL HOLD" : "FALSIFIED"} — ${checks - failures}/${checks}\n`);
}

try {
  await main();
} finally {
  // Fixtures are disposable and must not join the S-7 basket or the live
  // population. Removed whether or not the claims held.
  if (created.quotes.length) {
    await db.delete(leafSpecs).where(inArray(leafSpecs.quoteId, created.quotes));
    await db.delete(quoteLeaves).where(inArray(quoteLeaves.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.leaves.length) {
    await db.delete(leafSpecs).where(
      and(inArray(leafSpecs.leafId, created.leaves), isNull(leafSpecs.quoteId)),
    );
    await db.delete(leaves).where(inArray(leaves.id, created.leaves));
  }
  console.log("  fixtures removed");
}
process.exit(failures === 0 ? 0 : 1);

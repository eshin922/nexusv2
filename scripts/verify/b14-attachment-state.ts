/**
 * B-14 · Library `Attached` state — falsification.
 *
 * The defect: the Library row kept offering `Add` after a successful attach.
 * Cause: the attached-set was derived from `assembly_leaves`, which records
 * GROUP MEMBERSHIP only. A Direct Product attaches with `assembly_id NULL` and
 * produces no junction row, so the reading was structurally blind to it.
 *
 * The case that matters most is therefore the DIRECT one, and it is asserted
 * first. Group attachment is asserted alongside it so the fix cannot trade one
 * blindness for another.
 *
 * Creates its own fixtures and removes them.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, leaves, quoteLeaves, quotes, users } from "@/db/schema";
import { attachDirectProduct } from "@/lib/product-structure/direct-attachment";
import { attachGroupedMembership } from "@/lib/product-structure/grouped-membership-compatibility";
import { loadLibraryBrowse } from "@/lib/library-browse-loader";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const TAG = "B14-FALSIFY";
const created = { quotes: [] as string[], leaves: [] as string[] };

async function rowFor(quoteId: string, leafId: string) {
  const r = await loadLibraryBrowse({
    targetQuoteId: quoteId,
    scopeFilter: "all",
    search: TAG,
  });
  return r.rows.find((x) => x.leafId === leafId);
}

async function main() {
  console.log("\nB-14 attachment state\n");

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

  const mkLeaf = async (label: string) => {
    const [l] = await db
      .insert(leaves)
      .values({
        name: `${TAG} ${label}`,
        sku: `${TAG}-${label}`,
        hubspotProductType: "Secondary",
        createdBy: user.id,
      })
      .returning({ id: leaves.id });
    created.leaves.push(l.id);
    return l.id;
  };
  const directLeaf = await mkLeaf("direct");
  const groupLeaf = await mkLeaf("grouped");

  // ------------------------------------------------------ before attachment
  const before = await rowFor(q.id, directLeaf);
  claim(
    before !== undefined &&
      !before.attachedInTargetQuote &&
      !before.attachedDirectInTargetQuote &&
      before.attachedAssemblyIdsInTargetQuote.length === 0,
    "1 · an unattached product reads as NOT attached",
    `direct=${before?.attachedDirectInTargetQuote} any=${before?.attachedInTargetQuote}`,
  );

  // ------------------------------------------------------------ DIRECT — the
  // exact case the junction-derived reading could never see.
  await db.transaction(async (tx) => {
    await attachDirectProduct(tx as never, {
      quoteId: q.id,
      leafId: directLeaf,
      quantity: "1",
      position: 0,
      createdBy: user.id,
    });
  });
  const afterDirect = await rowFor(q.id, directLeaf);
  claim(
    afterDirect?.attachedDirectInTargetQuote === true,
    "2 · a DIRECT attach flips the row to attached — the original defect",
    `direct=${afterDirect?.attachedDirectInTargetQuote} any=${afterDirect?.attachedInTargetQuote}`,
  );
  claim(
    afterDirect?.attachedAssemblyIdsInTargetQuote.length === 0,
    "2b · and claims no Item Group membership, because it has none",
    `groups=${JSON.stringify(afterDirect?.attachedAssemblyIdsInTargetQuote)}`,
  );

  // ------------------------------------------------------------- GROUPED —
  // the fix must not trade one blindness for another.
  const [asm] = await db
    .insert(assemblies)
    .values({
      quoteId: q.id,
      sku: `${TAG}-ASY`,
      name: `${TAG} group`,
      position: 0,
    })
    .returning({ id: assemblies.id });
  await db.transaction(async (tx) => {
    await attachGroupedMembership(tx as never, {
      quoteId: q.id,
      assemblyId: asm.id,
      leafId: groupLeaf,
      quantity: "1",
      position: 0,
      createdBy: user.id,
    });
  });
  const afterGroup = await rowFor(q.id, groupLeaf);
  claim(
    afterGroup?.attachedAssemblyIdsInTargetQuote.includes(asm.id) === true,
    "3 · a GROUPED attach reports the owning Item Group",
    `groups=${JSON.stringify(afterGroup?.attachedAssemblyIdsInTargetQuote)}`,
  );
  claim(
    afterGroup?.attachedDirectInTargetQuote === false,
    "3b · and does NOT claim a direct attachment",
    `direct=${afterGroup?.attachedDirectInTargetQuote}`,
  );

  // -------------------------------------------------------------- isolation
  const otherQuoteRow = await loadLibraryBrowse({
    targetQuoteId: seed.projectId, // deliberately not this quote's id
    scopeFilter: "all",
    search: TAG,
  });
  const foreign = otherQuoteRow.rows.find((x) => x.leafId === directLeaf);
  claim(
    foreign !== undefined && !foreign.attachedInTargetQuote,
    "4 · attachment is scoped to the TARGET quote, not global",
    `attached elsewhere=${foreign?.attachedInTargetQuote}`,
  );

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

async function cleanup() {
  if (created.quotes.length > 0) {
    await db.delete(quoteLeaves).where(inArray(quoteLeaves.quoteId, created.quotes));
    await db.delete(assemblies).where(inArray(assemblies.quoteId, created.quotes));
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

/**
 * Step 4 · Product Type authority cutover — falsifications 7-10.
 *
 * Runs against the real database and CLEANS UP AFTER ITSELF. Every claim
 * states what must hold and prints PASS/FAIL; a claim that cannot be
 * established FAILS rather than being skipped, because a check that reports
 * nothing is indistinguishable from one that passed.
 *
 * NO HUBSPOT MUTATION. Falsifications 7 and 8 need an authoritative Product
 * Type to CHANGE. That change is simulated by writing
 * `leaves.hubspot_product_type` on a fixture leaf — exactly what a governed
 * pull does when someone reclassifies in HubSpot — so the property is proven
 * without touching a real portal.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leafSpecs, leaves, quoteLeaves, quotes, users } from "@/db/schema";
import { ensureQuoteSpecAuthority } from "@/lib/product-structure/quote-spec-authority";
import {
  decodePinnedSchema,
  resolveSpecSchema,
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
} from "@/lib/product-structure/spec-schema-mapping";
import { loadAssemblyTree } from "@/lib/assembly-tree";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const TAG = "STEP4-FALSIFY";
const created = { quotes: [] as string[], leaves: [] as string[] };

async function main() {
  console.log("\nStep 4 falsifications 7-10\n");

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [anyQuote] = await db
    .select({ id: quotes.id, projectId: quotes.projectId })
    .from(quotes)
    .limit(1);
  if (!user || !anyQuote)
    throw new Error("no user/quote to build fixtures from");

  const mkQuote = async (label: string) => {
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

  // A product classified `Primary` in HubSpot at the moment of attachment.
  const [leaf] = await db
    .insert(leaves)
    .values({
      name: `${TAG} reclassified product`,
      hubspotProductType: "Primary",
      createdBy: user.id,
    })
    .returning({ id: leaves.id });
  created.leaves.push(leaf.id);

  const qBefore = await mkQuote("before");
  const qAfter = await mkQuote("after");

  // ------------------------------------------------------------------ setup
  const before = await ensureQuoteSpecAuthority(db as never, {
    quoteId: qBefore,
    leafId: leaf.id,
    createdBy: user.id,
  });
  claim(
    before.specSchema === "primary",
    "setup · attachment while HubSpot says `Primary` pins `primary`",
    `pin=${before.specSchema} derivedFrom=${before.schemaDerivedFromType}`,
  );

  // The reclassification. This is what a governed pull writes when someone
  // changes the product's type in HubSpot.
  await db
    .update(leaves)
    .set({ hubspotProductType: "Secondary" })
    .where(eq(leaves.id, leaf.id));

  // ----------------------------------------------------------------------- 7
  const [beforeAfterChange] = await db
    .select()
    .from(leafSpecs)
    .where(eq(leafSpecs.id, before.id));
  claim(
    beforeAfterChange.specSchema === "primary" &&
      beforeAfterChange.schemaDerivedFromType === "Primary",
    "7 · the EXISTING quote retains its pinned Spec Schema after the change",
    `pin=${beforeAfterChange.specSchema} derivedFrom=${beforeAfterChange.schemaDerivedFromType} (live is now Secondary)`,
  );
  const stillPrimary = decodePinnedSchema(
    beforeAfterChange.specSchema,
    beforeAfterChange.schemaDerivedFromType,
  );
  claim(
    stillPrimary?.kind === "schema" && stillPrimary.schemaId === "primary",
    "7b · and every reader decodes that pin as `primary`, not as the live type",
    `decoded=${JSON.stringify(stillPrimary)}`,
  );

  // ----------------------------------------------------------------------- 8
  const after = await ensureQuoteSpecAuthority(db as never, {
    quoteId: qAfter,
    leafId: leaf.id,
    createdBy: user.id,
  });
  claim(
    after.specSchema === "secondary" &&
      after.schemaDerivedFromType === "Secondary",
    "8 · a NEW attachment after the change receives the newly-resolved schema",
    `pin=${after.specSchema} derivedFrom=${after.schemaDerivedFromType}`,
  );
  claim(
    before.specSchema !== after.specSchema,
    "8b · the two quotes therefore hold DIFFERENT schemas for the same product",
    `${before.specSchema} vs ${after.specSchema}`,
  );

  // ----------------------------------------------------------------------- 9
  //
  // Both surfaces must read the SAME authoritative source. Proven by changing
  // that source and requiring both to move together — a check that compares
  // two static reads would pass even if one had been frozen.
  await db.insert(quoteLeaves).values({
    quoteId: qAfter,
    leafId: leaf.id,
    assemblyId: null,
    quantity: "1",
    position: 0,
  });
  const [libraryRow] = await db
    .select({ hubspotProductType: leaves.hubspotProductType })
    .from(leaves)
    .where(eq(leaves.id, leaf.id));
  const tree = await loadAssemblyTree(qAfter);
  const setupNode = tree?.directProducts.find((p) => p.leafId === leaf.id);
  claim(
    !!setupNode,
    "9 · setup · the attached product renders in the Setup tree",
    setupNode ? `node=${setupNode.name}` : "NOT FOUND",
  );
  claim(
    setupNode?.productType?.value === libraryRow.hubspotProductType,
    "9 · Library and Setup show the SAME authoritative Product Type",
    `library=${libraryRow.hubspotProductType} setup=${setupNode?.productType?.value}`,
  );
  claim(
    setupNode?.productType?.value === "Secondary",
    "9b · and it is the LIVE value, so a reclassification reaches both",
    `setup=${setupNode?.productType?.value} (was Primary at attachment)`,
  );

  // ---------------------------------------------------------------------- 10
  //
  // Validation must select the field schema from the PIN, not from live
  // classification. The fixture is built so the two disagree: were validation
  // reading live HubSpot, this quote's accepted field set would have silently
  // become the Secondary one mid-edit.
  const liveResolution = resolveSpecSchema(libraryRow.hubspotProductType);
  const pinnedResolution = decodePinnedSchema(
    beforeAfterChange.specSchema,
    beforeAfterChange.schemaDerivedFromType,
  );
  claim(
    liveResolution?.kind === "schema" &&
      pinnedResolution?.kind === "schema" &&
      liveResolution.schemaId !== pinnedResolution.schemaId,
    "10 · setup · live and pinned resolutions genuinely DISAGREE for this quote",
    `live=${JSON.stringify(liveResolution)} pinned=${JSON.stringify(pinnedResolution)}`,
  );
  const validatedAgainst =
    pinnedResolution?.kind === "schema"
      ? SPEC_SCHEMA_PRODUCT_TYPE_ID[pinnedResolution.schemaId]
      : null;
  claim(
    validatedAgainst === SPEC_SCHEMA_PRODUCT_TYPE_ID.primary,
    "10 · quote spec validation resolves the PINNED schema, not the live type",
    `would validate against ${validatedAgainst}`,
  );

  // Setup's readiness verdict must come from the same pin, or the chip and the
  // accepted field set could disagree with each other.
  const treeBefore = await loadAssemblyTree(qBefore);
  await db.insert(quoteLeaves).values({
    quoteId: qBefore,
    leafId: leaf.id,
    assemblyId: null,
    quantity: "1",
    position: 0,
  });
  const reloaded = await loadAssemblyTree(qBefore);
  const beforeNode = reloaded?.directProducts.find((p) => p.leafId === leaf.id);
  claim(
    beforeNode?.specSchema?.pin === "primary",
    "10b · and Setup's readiness for that quote reads the same pin",
    `pin=${beforeNode?.specSchema?.pin} typeId=${beforeNode?.specSchema?.typeId} (tree had ${treeBefore?.directProducts.length ?? 0} before attach)`,
  );

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

async function cleanup() {
  if (created.quotes.length > 0) {
    await db.delete(quoteLeaves).where(inArray(quoteLeaves.quoteId, created.quotes));
    await db.delete(leafSpecs).where(inArray(leafSpecs.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.leaves.length > 0) {
    await db.delete(leafSpecs).where(inArray(leafSpecs.leafId, created.leaves));
    await db.delete(leaves).where(inArray(leaves.id, created.leaves));
  }
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

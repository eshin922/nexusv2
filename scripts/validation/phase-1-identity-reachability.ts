import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";
import { attachGroupedMembership } from "../../src/lib/product-structure/grouped-membership-compatibility.ts";
import {
  CanonicalAttachmentResolutionError,
  canonicalQuoteLeafId,
  legacyAssemblyLeafId,
  lookupCanonicalAttachment,
  lookupCanonicalAttachmentByLegacyId,
} from "../../src/lib/product-structure/canonical-attachment-identity.ts";

assertRuntimeSafety();
const projectId = randomUUID();
const quoteId = randomUUID();
const otherQuoteId = randomUUID();
const assemblyId = randomUUID();
const leafId = randomUUID();
const directLeafId = randomUUID();

try {
  await db.transaction(async (tx) => {
    await tx.insert(schema.projects).values({
      id: projectId,
      hubspotDealId: `phase-1-identity-${projectId}`,
      dealName: "Phase 1 Identity Reachability",
    });
    await tx.insert(schema.quotes).values([
      { id: quoteId, projectId, versionNumber: 1, status: "draft" },
      {
        id: otherQuoteId,
        projectId,
        scenarioLabel: "Other",
        versionNumber: 1,
        status: "draft",
      },
    ]);
    await tx.insert(schema.assemblies).values({
      id: assemblyId,
      quoteId,
      sku: "PHASE1-GROUPED",
      name: "Phase 1 Grouped Product",
    });
    await tx.insert(schema.leaves).values([
      { id: leafId, name: "Phase 1 Grouped Leaf", sku: "PHASE1-LEAF-G" },
      { id: directLeafId, name: "Phase 1 Direct Leaf", sku: "PHASE1-LEAF-D" },
    ]);
  });

  const mapped = await db.transaction((tx) =>
    attachGroupedMembership(tx, {
      quoteId,
      assemblyId,
      leafId,
      quantity: "1",
      position: 0,
    }),
  );
  const canonical = await lookupCanonicalAttachment(
    canonicalQuoteLeafId(mapped.quoteLeafId),
  );
  const legacy = await lookupCanonicalAttachmentByLegacyId(
    legacyAssemblyLeafId(mapped.assemblyLeafId),
  );
  assert.deepEqual(legacy, canonical);

  const [direct] = await db
    .insert(schema.quoteLeaves)
    .values({ quoteId, assemblyId: null, leafId: directLeafId })
    .returning({ id: schema.quoteLeaves.id });
  const directResolution = await lookupCanonicalAttachment(
    canonicalQuoteLeafId(direct.id),
  );
  assert.equal(directResolution.assemblyLeafId, null);

  let missingRejected = false;
  try {
    await lookupCanonicalAttachmentByLegacyId(legacyAssemblyLeafId(randomUUID()));
  } catch (error) {
    missingRejected = error instanceof CanonicalAttachmentResolutionError;
  }

  let duplicateRejected = false;
  try {
    await db.insert(schema.assemblyLeaves).values({
      assemblyId,
      leafId,
      quoteLeafId: mapped.quoteLeafId,
    });
  } catch {
    duplicateRejected = true;
  }

  await db
    .update(schema.quoteLeaves)
    .set({ quantity: "2" })
    .where(eq(schema.quoteLeaves.id, mapped.quoteLeafId));
  let driftRejected = false;
  try {
    await lookupCanonicalAttachmentByLegacyId(
      legacyAssemblyLeafId(mapped.assemblyLeafId),
    );
  } catch (error) {
    driftRejected = error instanceof CanonicalAttachmentResolutionError;
  }
  await db
    .update(schema.quoteLeaves)
    .set({ quantity: "1" })
    .where(eq(schema.quoteLeaves.id, mapped.quoteLeafId));

  await db
    .update(schema.quoteLeaves)
    .set({ quoteId: otherQuoteId, assemblyId: null })
    .where(eq(schema.quoteLeaves.id, mapped.quoteLeafId));
  let crossQuoteRejected = false;
  try {
    await lookupCanonicalAttachmentByLegacyId(
      legacyAssemblyLeafId(mapped.assemblyLeafId),
    );
  } catch (error) {
    crossQuoteRejected = error instanceof CanonicalAttachmentResolutionError;
  }

  const evidence = {
    canonicalKey: "quote_leaves.id",
    currentRoute: { quoteLeafId: direct.id, resolved: true, legacyId: null },
    compatibilityRoute: {
      assemblyLeafId: mapped.assemblyLeafId,
      quoteLeafId: mapped.quoteLeafId,
      resolved: true,
    },
    failures: {
      missingRejected,
      duplicateRejected,
      crossQuoteRejected,
      driftRejected,
    },
  };
  console.log(JSON.stringify(evidence, null, 2));
  assert.ok(Object.values(evidence.failures).every(Boolean));
} finally {
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
}

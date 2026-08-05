import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";
import {
  CanonicalAttachmentResolutionError,
  canonicalQuoteLeafId,
  legacyAssemblyLeafId,
  lookupCanonicalAttachment,
  lookupCanonicalAttachmentByLegacyId,
} from "../../src/lib/product-structure/canonical-attachment-identity.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
assertRuntimeSafety();

async function main() {
  const [mapped] = await db
    .select({ assemblyLeafId: schema.assemblyLeaves.id, quoteLeafId: schema.assemblyLeaves.quoteLeafId })
    .from(schema.assemblyLeaves)
    .where(sql`${schema.assemblyLeaves.quoteLeafId} is not null`)
    .limit(1);
  assert.ok(mapped?.quoteLeafId, "representative copy requires one mapped membership");

  const canonical = await lookupCanonicalAttachment(canonicalQuoteLeafId(mapped.quoteLeafId));
  const reverse = await lookupCanonicalAttachmentByLegacyId(legacyAssemblyLeafId(mapped.assemblyLeafId));
  assert.deepEqual(reverse, canonical);
  assert.equal(canonical.assemblyLeafId, mapped.assemblyLeafId);

  await assert.rejects(
    lookupCanonicalAttachmentByLegacyId(legacyAssemblyLeafId(randomUUID())),
    CanonicalAttachmentResolutionError,
  );

  const [targetQuote] = await db
    .select({ quoteId: schema.quotes.id })
    .from(schema.quotes)
    .where(eq(schema.quotes.status, "draft"))
    .limit(1);
  const [targetLeaf] = await db
    .select({ leafId: schema.leaves.id })
    .from(schema.leaves)
    .limit(1);
  assert.ok(targetQuote && targetLeaf, "representative copy requires a draft Quote and reusable LEAF");
  const target = { ...targetQuote, ...targetLeaf };

  const directId = randomUUID();
  await db.insert(schema.quoteLeaves).values({
    id: directId,
    quoteId: target.quoteId,
    assemblyId: null,
    leafId: target.leafId,
    quantity: "1",
    position: 987654,
  });
  try {
    const direct = await lookupCanonicalAttachment(canonicalQuoteLeafId(directId));
    assert.equal(direct.quoteId, target.quoteId);
    assert.equal(direct.leafId, target.leafId);
    assert.equal(direct.assemblyId, null);
    assert.equal(direct.assemblyLeafId, null);
  } finally {
    await db.delete(schema.quoteLeaves).where(eq(schema.quoteLeaves.id, directId));
  }

  const [directResidue] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.quoteLeaves)
    .where(and(eq(schema.quoteLeaves.id, directId), sql`${schema.quoteLeaves.assemblyId} is null`));
  assert.equal(directResidue.count, 0);

  process.stdout.write(JSON.stringify({
    pass: true,
    canonicalLookup: canonical.quoteLeafId,
    reverseLookup: reverse.quoteLeafId,
    directFormIsolatedOnly: true,
    externalCalls: 0,
  }));
}

await main();

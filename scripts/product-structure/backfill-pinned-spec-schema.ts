/**
 * Step 4.3 · backfill the pinned Spec Schema onto existing quote-owned rows.
 *
 * Recomputes each quote-owned authority's schema from its leaf's AUTHORITATIVE
 * HubSpot Product Type, through the governed mapping. The mapping is not
 * restated here in SQL: a CASE expression duplicating it would be a second
 * authority that drifts from the first silently, which is the exact failure
 * this whole migration removes.
 *
 * IDEMPOTENT. Touches only rows whose pin is NULL, so a re-run after a partial
 * failure completes the work and a re-run after success is a no-op. It will
 * never overwrite an existing pin — a pin that is already set is authority, and
 * re-deriving it would be the retroactive reinterpretation pinning exists to
 * prevent.
 *
 * LIBRARY-SCOPE ROWS ARE DELIBERATELY UNTOUCHED. They are templates and defer;
 * NULL is their correct state.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --experimental-loader ./scripts/support/src-resolver.mjs \
 *        scripts/product-structure/backfill-pinned-spec-schema.ts [--apply]
 *
 * Without --apply it reports the plan and writes nothing.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { leafSpecs, leaves } from "@/db/schema";
import {
  encodePinnedSchema,
  resolveSpecSchema,
} from "@/lib/product-structure/spec-schema-mapping";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `\nStep 4.3 · pinned Spec Schema backfill  [${APPLY ? "APPLY" : "DRY RUN"}]\n`,
  );

  const rows = await db
    .select({
      specId: leafSpecs.id,
      quoteId: leafSpecs.quoteId,
      leafId: leafSpecs.leafId,
      leafName: leaves.name,
      hubspotProductType: leaves.hubspotProductType,
      nexusTypeId: leafSpecs.productTypeId,
    })
    .from(leafSpecs)
    .innerJoin(leaves, eq(leaves.id, leafSpecs.leafId))
    .where(
      and(isNotNull(leafSpecs.quoteId), isNull(leafSpecs.specSchema)),
    );

  console.log(`  quote-owned rows without a pin : ${rows.length}`);
  if (rows.length === 0) {
    console.log("\n  nothing to do.\n");
    return;
  }

  const dist = new Map<string, number>();
  const unmapped: string[] = [];
  const noType: string[] = [];

  for (const r of rows) {
    const resolution = resolveSpecSchema(r.hubspotProductType);
    const pin = encodePinnedSchema(resolution);
    dist.set(pin, (dist.get(pin) ?? 0) + 1);
    if (pin === "unmapped")
      unmapped.push(`${r.leafName} «${r.hubspotProductType}»`);
    if (pin === "no_type") noType.push(r.leafName);

    if (APPLY) {
      await db
        .update(leafSpecs)
        .set({
          specSchema: pin,
          schemaDerivedFromType: r.hubspotProductType ?? null,
        })
        .where(eq(leafSpecs.id, r.specId));
    }
  }

  console.log("\n  resolved distribution");
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(10)} ${v}`);

  // Named, not counted. An unmapped pin means an authoritative value the
  // governed mapping does not dispose of, and CI is supposed to make that
  // impossible — so if any appear here, the exhaustiveness check has a hole.
  if (unmapped.length > 0) {
    console.log(`\n  UNMAPPED (${unmapped.length}) — mapping has a hole:`);
    for (const u of new Set(unmapped)) console.log(`    ${u}`);
  }
  if (noType.length > 0) {
    console.log(
      `\n  NO TYPE SET (${noType.length}) — missing authoritative classification:`,
    );
    for (const n of [...new Set(noType)].slice(0, 20))
      console.log(`    ${n}`);
    if (new Set(noType).size > 20)
      console.log(`    ... ${new Set(noType).size - 20} more`);
  }

  console.log(
    APPLY
      ? `\n  APPLIED to ${rows.length} rows.\n`
      : "\n  DRY RUN — nothing written. Re-run with --apply.\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

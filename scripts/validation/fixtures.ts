import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  resetFixtureWorld,
  seedFixtureWorld,
  fixtureRecordIds,
  type FixtureManifest,
} from "../../tests/harness/fixtures/world.ts";
import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

const command = process.argv[2];
const runId = process.argv[3] ?? process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";
const artifactDirectory = path.resolve(
  process.cwd(),
  ".artifacts",
  "validation",
  runId,
);
const manifestPath = path.join(artifactDirectory, "fixture-manifest.json");

async function validate(manifest?: FixtureManifest) {
  assertRuntimeSafety();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const { projectIds, quoteIds } = fixtureRecordIds(runId);
  try {
    const [counts] = await sql<{
      projects: number;
      quotes: number;
      tiers: number;
      pushes: number;
      canonical_attachments: number;
      invalid_identity_mappings: number;
      invalid_external_ids: number;
      freight_subcategories: number;
      freight_destinations: number;
      freight_breaks: number;
      freight_memberships: number;
      freight_customs_breaks: number;
      invalid_tracking_destinations: number;
    }[]>`
      select
        (select count(*)::int from freight_subcategories fs
          where fs.quote_id in ${sql(quoteIds)}) as freight_subcategories,
        (select count(*)::int from freight_destinations fd
          join freight_subcategories fs on fs.id = fd.freight_subcategory_id
          where fs.quote_id in ${sql(quoteIds)}) as freight_destinations,
        (select count(*)::int from freight_destination_breaks fb
          join freight_destinations fd on fd.id = fb.freight_destination_id
          join freight_subcategories fs on fs.id = fd.freight_subcategory_id
          where fs.quote_id in ${sql(quoteIds)}) as freight_breaks,
        (select count(*)::int from freight_subcategory_items fi
          join freight_subcategories fs on fs.id = fi.freight_subcategory_id
          where fs.quote_id in ${sql(quoteIds)}) as freight_memberships,
        (select count(*)::int from freight_customs_breaks cb
          join freight_customs_entries ce on ce.id = cb.freight_customs_entry_id
          join freight_subcategories fs on fs.id = ce.freight_subcategory_id
          where fs.quote_id in ${sql(quoteIds)}) as freight_customs_breaks,
        (select count(*)::int from freight_destination_tracking ft
          join freight_destinations fd on fd.id = ft.freight_destination_id
          join freight_subcategories fs on fs.id = fd.freight_subcategory_id
          where fs.quote_id in ${sql(quoteIds)} and fs.selected_destination_id <> fd.id) as invalid_tracking_destinations,
        (select count(*)::int from projects
          where id in ${sql(projectIds)}) as projects,
        (select count(*)::int from quotes
          where id in ${sql(quoteIds)}) as quotes,
        (select count(*)::int from quote_tiers qt
          where qt.quote_id in ${sql(quoteIds)}) as tiers,
        (select count(*)::int from netsuite_so_pushes nsp
          where nsp.quote_id in ${sql(quoteIds)}) as pushes,
        (select count(*)::int from quote_leaves ql
          where ql.quote_id in ${sql(quoteIds)}) as canonical_attachments,
        (select count(*)::int
          from assembly_leaves al
          join assemblies a on a.id = al.assembly_id
          left join quote_leaves ql on ql.id = al.quote_leaf_id
          where a.quote_id in ${sql(quoteIds)}
            and (
              ql.id is null or ql.quote_id <> a.quote_id
              or ql.assembly_id <> al.assembly_id or ql.leaf_id <> al.leaf_id
            )) as invalid_identity_mappings,
        (select count(*)::int from projects
          where id in ${sql(projectIds)}
            and hubspot_deal_id !~ '^[0-9]+$') as invalid_external_ids
    `;
    // DERIVED from the fixture definitions, not pinned to literals. The
    // literals were 8 / 8 / 16 / 32 and went wrong the moment a fourth
    // operator fixture landed — the seed was correct and the check was stale,
    // which is the least useful way for an assertion to fail.
    //
    //   5 lifecycle states, one project + one quote + two tiers each
    //   4 operator fixtures, one project + one quote each
    //   tiers and attachments vary per operator fixture, so both are summed
    // Governed quote fixtures, which is NOT the same as the number of
    // lifecycle states. VAL-208 (2026-08-10) added `sendable` -- a SECOND
    // draft, seeded identically -- so the destructive send lifecycle stops
    // sharing `draft` with scenarios that need it to stay editable. Five
    // states, six fixtures; every count below follows the fixture count
    // because each fixture seeds its own project, quote, tiers and
    // attachments regardless of the lifecycle it lands in.
    const LIFECYCLE_STATES = 6;
    const OPERATORS: Array<{
      skuCount: number;
      tierCount: number;
      /** Carries a border-crossing leg, so it produces customs entries. */
      bordered: boolean;
      air: boolean;
      domestic: boolean;
    }> = [
      { skuCount: 1, tierCount: 2, bordered: false, air: false, domestic: false },
      { skuCount: 6, tierCount: 2, bordered: true, air: true, domestic: false },
      { skuCount: 10, tierCount: 2, bordered: true, air: true, domestic: true },
      { skuCount: 6, tierCount: 4, bordered: true, air: true, domestic: false }, // r3Volume
      { skuCount: 6, tierCount: 4, bordered: true, air: true, domestic: true }, // r12Visual
    ];
    // One shipment per LEG the fixture asks for. Derived from the spec flags
    // rather than fitted to a per-operator average: the `x 2` rate that held
    // while three of four fixtures had an air leg stopped holding the moment a
    // fifth arrived with a different leg mix.
    const SUBCATS = OPERATORS.reduce(
      (n, o) => n + 1 + (o.air ? 1 : 0) + (o.domestic ? 1 : 0),
      0,
    );
    const OPERATOR_TIER_TOTAL = OPERATORS.reduce((sum, o) => sum + o.tierCount, 0);
    const expected = {
      projects: LIFECYCLE_STATES + OPERATORS.length,
      quotes: LIFECYCLE_STATES + OPERATORS.length,
      tiers: LIFECYCLE_STATES * 2 + OPERATOR_TIER_TOTAL,
      pushes: 2,
      canonical_attachments:
        LIFECYCLE_STATES * 3 + OPERATORS.reduce((sum, o) => sum + o.skuCount, 0),
      invalid_identity_mappings: 0,
      // Freight scales per OPERATOR fixture, not per lifecycle state. The old
      // literals encoded three operators; a fourth made every one of them
      // wrong at once. Per-operator rates recovered from those literals
      // (6/12/24/24 over three operators) and re-multiplied, so adding a fifth
      // fixture needs no edit here.
      freight_subcategories: SUBCATS,
      freight_destinations: SUBCATS * 2,
      // Breaks and memberships are per DESTINATION per TIER — four
      // destinations each — so they follow the tier total, not the fixture
      // count. The old literal 24 read as "8 per operator" only because every
      // operator had two tiers; the four-tier fixture is what separated the
      // two readings.
      // Breaks are per DESTINATION per TIER — four destinations each — so they
      // follow the tier total. The old literal 24 read as "8 per operator"
      // only because every operator had two tiers; the four-tier fixture is
      // what separated the two readings.
      // Per DESTINATION per TIER, and there are two destinations per shipment
      // — so it follows the shipment mix, not the fixture count. The old
      // `tiers x 4` held only while every fixture had two shipments.
      freight_breaks: OPERATORS.reduce(
        (n, o) => n + o.tierCount * (1 + (o.air ? 1 : 0) + (o.domestic ? 1 : 0)) * 2,
        0,
      ),
      // Memberships are per SHIPMENT MEMBER and do not vary with tiers — eight
      // per operator fixture, which the four-tier addition confirmed by adding
      // exactly eight rather than sixteen.
      // MEASURED, and for the same reason `freight_customs_breaks` below is:
      // membership follows each fixture's SKU count AND its shipment mix, and
      // the two do not compose into one rate across five fixtures. A formula
      // fitting all five would be a curve through five points, which is worse
      // than a number that is honestly a number.
      freight_memberships: 43,
      // MEASURED, not derived — and deliberately so. The other five counts
      // above have a rate that holds across fixtures; this one does not. The
      // two original bordered fixtures produce five entries per tier and the
      // new one produces four, because the entries follow each fixture's
      // destination mix rather than its tier count. Any formula fitting all
      // three would be a curve fitted to three points, which is worse than a
      // number that is honestly a number.
      //
      // It will go stale when a fixture is added. That is the trade accepted
      // here: a stale literal fails loudly and is corrected in one line,
      // whereas an invented rate fails quietly by agreeing with the wrong
      // total.
      freight_customs_breaks: 52,
      invalid_tracking_destinations: 0,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (counts[key as keyof typeof expected] !== value) {
        throw new Error(`[fixtures] expected ${value} ${key}, found ${counts[key as keyof typeof expected]}`);
      }
    }
    if (counts.invalid_external_ids !== 0) {
      throw new Error("[fixtures] found a non-validation external identifier");
    }
    if (manifest && Object.keys(manifest.quotes).length !== LIFECYCLE_STATES) {
      throw new Error("[fixtures] manifest does not contain every lifecycle state");
    }
    if (manifest && Object.keys(manifest.operatorQuotes).length !== OPERATORS.length) {
      throw new Error("[fixtures] manifest does not contain every operator scale fixture");
    }
    return counts;
  } finally {
    await sql.end();
  }
}

async function main() {
  if (command === "seed") {
    await resetFixtureWorld(runId);
    const manifest = await seedFixtureWorld(runId);
    const counts = await validate(manifest);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, counts }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ command, runId, manifestPath, counts }));
    return;
  }
  if (command === "reset") {
    await resetFixtureWorld(runId);
    await rm(artifactDirectory, { recursive: true, force: true });
    console.log(JSON.stringify({ command, runId }));
    return;
  }
  if (command === "validate") {
    const counts = await validate();
    console.log(JSON.stringify({ command, runId, counts }));
    return;
  }
  throw new Error("Usage: fixtures.ts <seed|validate|reset> [run-id]");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

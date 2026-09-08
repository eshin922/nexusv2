/**
 * STEP 0 · classify every S-7 failure by CAUSE, before anything is re-baselined.
 *
 * OD-013 makes the sequence mandatory: a preservation check that gets
 * re-baselined whenever it fails is not a preservation check. HARNESS-1 adds
 * that re-baselining is a governance act which erases the drift record, so it
 * must never happen as a side effect of other work.
 *
 * This script performs no writes and proposes no baseline. It answers one
 * question per failing quote: WHY did this move?
 *
 *   instrument      a validation / soak / training artifact — mutable by
 *                   design, and never a preservation reference
 *   mutable         a DRAFT — meant to change; its drift says nothing about
 *                   the engine
 *   immutable-moved a sent / accepted / complete quote whose numbers moved
 *                   with no input change. The only class that can be evidence
 *                   about the software, and therefore the only one that needs
 *                   adjudication against the approved-change record
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

/** The failing quote ids reported by `gate1b:verify-preserved` on main. */
const FAILING = [
  "0d76e2eb-5993-4ae9-851f-267f5108207e",
  "27581262-14b3-4f3f-86e8-b12123f7d899",
  "2f29af72-805b-446c-866c-73e9b0991b1a",
  "93a5d4bb-7006-4bc4-9215-216af4d39747",
  "97d25286-2c42-4a72-8979-89f1a5c2cf26",
  "cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c",
  "da56da37-ef4e-4e48-a177-ade3a677fcdd",
  "e23f0e2c-57e4-45fe-96c8-2380aadf5f3a",
  "f2db6e10-8a38-4f95-b81b-e016c448b677",
  "f5f5ac14-4d6b-4a48-98da-e6285a2cd9be",
  "f88c22e3-2d50-419e-b923-c771f5784531",
];

/** Baseline recapture — `096b6da`, "recapture the S-7 baseline as a certified new reference". */
const BASELINE_CAPTURED = "2026-08-23";

const IMMUTABLE = new Set(["sent", "accepted", "complete"]);

/**
 * An instrument is named by CONVENTION, and the convention lives in two places
 * the current basket predicate only half-covers: the DEAL name carries
 * `ZZ-VALIDATION —` while the scenario label carries `ZZ-SOAK-…`, `CERT-…`,
 * `UAT-…`. The predicate matches `scenario_label LIKE 'ZZ-VALIDATION-%'` alone,
 * which is why it excludes 3 of them and admits the rest.
 */
function instrumentReason(dealName: string, label: string | null): string | null {
  const l = label ?? "";
  if (dealName.startsWith("ZZ-VALIDATION")) return "deal namespace ZZ-VALIDATION";
  if (dealName.startsWith("TRAINING")) return "deal namespace TRAINING";
  if (l.startsWith("ZZ-VALIDATION-")) return "scenario namespace ZZ-VALIDATION- (currently excluded)";
  if (l.startsWith("ZZ-SOAK")) return "scenario namespace ZZ-SOAK";
  if (/^(CERT|UAT)-/.test(l)) return "scenario namespace CERT/UAT";
  if (/do not quote|smoke|test scenario|sample test/i.test(l)) return "label declares itself a fixture";
  return null;
}

const rows = (await db.execute(sql`
  select q.id::text qid, q.status::text st, q.scenario_label sl, p.deal_name dn,
         q.updated_at, q.sent_at, q.accepted_at
    from quotes q join projects p on p.id = q.project_id
   where q.id::text = any(${sql.raw(`ARRAY[${FAILING.map((f) => `'${f}'`).join(",")}]`)})
   order by q.status, p.deal_name
`)) as unknown as Array<Record<string, string | null>>;

console.log(`S-7 failures classified · baseline captured ${BASELINE_CAPTURED}\n`);

const buckets: Record<string, string[]> = { instrument: [], mutable: [], immutable_moved: [] };

for (const r of rows) {
  const deal = String(r.dn ?? "");
  const label = r.sl;
  const status = String(r.st);
  const inst = instrumentReason(deal, label);

  // Did anything touch this quote's own data since the baseline was captured?
  const [edits] = (await db.execute(sql`
    select count(*)::text n, max(created_at)::text last
      from audit_log
     where (entity_id = ${r.qid} or diff_json->>'quote_id' = ${r.qid})
       and created_at > ${BASELINE_CAPTURED}::date
  `)) as unknown as Array<{ n: string; last: string | null }>;

  const bucket = inst ? "instrument" : !IMMUTABLE.has(status) ? "mutable" : "immutable_moved";
  buckets[bucket].push(String(r.qid));

  const tag =
    bucket === "instrument" ? "INSTRUMENT " : bucket === "mutable" ? "mutable    " : "IMMUTABLE  ";

  console.log(`${tag} ${status.padEnd(9)} ${`${deal} / ${label ?? "—"}`.slice(0, 62)}`);
  console.log(
    `            ${inst ?? "not an instrument"} · audit rows since baseline: ${edits.n}${edits.last ? ` (last ${String(edits.last).slice(0, 10)})` : ""}`,
  );
}

console.log("\n── classification ──────────────────────────────────────");
console.log(`instrument       ${buckets.instrument.length}  never a preservation reference; belongs outside the basket`);
console.log(`mutable (draft)  ${buckets.mutable.length}  meant to change; drift says nothing about the engine`);
console.log(`IMMUTABLE-MOVED  ${buckets.immutable_moved.length}  the only class that can be evidence about the software`);

if (buckets.immutable_moved.length > 0) {
  console.log("\nThe immutable-moved set requires adjudication against the approved-change");
  console.log("record before ANY re-baseline. Merged since the baseline was captured and");
  console.log("deliberately moving governed commercial numbers with owner approval:");
  console.log("  #369  allocation-OFF one-time charges enter cost, revenue and margin");
  console.log("  #453  the Price Build stops double-counting embedded recovery");
  console.log("  #497  OD-028 — the Item Group owns its own economics");
  console.log("  #517  a charge's cost is recognised whatever its recovery placement");
  console.log("  #439  margin reads UNRESOLVED when the quote carries unbillable recovery");
  console.log("\nIf every immutable movement is attributable to those, the baseline is");
  console.log("STALE-BY-APPROVAL, not violated — and re-baselining is the correct");
  console.log("governance act rather than a way of hiding a regression.");
}
process.exit(0);

/**
 * GOVERNANCE GATE · the five preconditions for replacing the S-7 baseline.
 *
 * Re-baselining erases the drift record. HARNESS-1 says so, and OD-013 makes
 * the classification sequence mandatory before one. This records what is true
 * at the moment of replacement, and REFUSES if any condition fails -- because a
 * precondition that only prints is a precondition nobody has to satisfy.
 *
 * Run against merged `main`, immediately before `gate1b:capture-baseline`.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import {
  basketPredicate,
  CERTIFIED_REFERENCE_QUOTES,
  missingCertifiedReferences,
  isReferenceStatus,
  isValidationInstrument,
} from "./basket.ts";

const EXPECTED_BASKET_SIZE = 26;

/**
 * The four quotes whose old-baseline difference has been adjudicated.
 *
 * Three are sibling scenarios reconciling exactly to #497 / OD-028 -- the Item
 * Group taking ownership of its own economics, moving production (0.6) and raw
 * (0.1) out of `factoryCostPerUnit` (3.2 -> 2.5). The fourth is the
 * separately-billed service recovery relocation, #416 / #517.
 *
 * Listing them by id is the point: a FIFTH difference, or a different four,
 * means something moved that nobody adjudicated, and the recapture must stop.
 */
const ADJUDICATED = new Map<string, string>([
  ["0d76e2eb-5993-4ae9-851f-267f5108207e", "#497 OD-028 Item Group owns its economics"],
  ["da56da37-ef4e-4e48-a177-ade3a677fcdd", "#497 OD-028 Item Group owns its economics"],
  ["e23f0e2c-57e4-45fe-96c8-2380aadf5f3a", "#497 OD-028 Item Group owns its economics"],
  ["93a5d4bb-7006-4bc4-9215-216af4d39747", "#416/#517 separately-billed service recovery"],
]);

const fails: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
  if (!ok) fails.push(label);
};

console.log("S-7 RE-BASELINE PRECONDITIONS\n");

const rows = (await db.execute(sql`
  select q.id::text qid, q.quote_number qn, q.status::text st, q.scenario_label sl,
         p.deal_name dn
    from quotes q join projects p on p.id = q.project_id
   where ${basketPredicate()}
   order by q.quote_number
`)) as unknown as Array<Record<string, string | null>>;

// 1 ─────────────────────────────────────────────────────────────────────
check("basket size = 26", rows.length === EXPECTED_BASKET_SIZE, `${rows.length}`);

// 2 ─────────────────────────────────────────────────────────────────────
const mutable = rows.filter((r) => !isReferenceStatus(r.st));
check(
  "every entry is sent / accepted / complete",
  mutable.length === 0,
  mutable.length === 0
    ? [...new Set(rows.map((r) => r.st))].sort().join(", ")
    : `${mutable.length} mutable: ${mutable.map((r) => r.qn ?? r.qid).join(", ")}`,
);

// 3 ─────────────────────────────────────────────────────────────────────
const instruments = rows.filter((r) => isValidationInstrument(r.sl, r.dn));
check(
  "zero disposable-instrument rows",
  instruments.length === 0,
  instruments.map((r) => `${r.dn} / ${r.sl}`).join(", ") || "none",
);

// 4 ─────────────────────────────────────────────────────────────────────
const missing = missingCertifiedReferences(rows.map((r) => r.qn));
check(
  `O1-O5 all present (${CERTIFIED_REFERENCE_QUOTES.length})`,
  missing.length === 0,
  missing.length === 0 ? CERTIFIED_REFERENCE_QUOTES.join(", ") : `MISSING ${missing.join(", ")}`,
);

// 5 ─────────────────────────────────────────────────────────────────────
//
// The residual differences must be EXACTLY the adjudicated set. Supplied by
// the caller from the verifier's own output rather than recomputed here: two
// implementations of "which quotes differ" would eventually disagree, and the
// one that matters is the one the gate actually runs.
const observed = (process.argv.slice(2)[0] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (observed.length === 0) {
  console.log(
    "\n  --  residual-difference check SKIPPED: pass the failing quote ids as a\n" +
      "      comma-separated argument, taken from gate1b:verify-preserved.",
  );
  fails.push("residual differences not supplied");
} else {
  const unexpected = observed.filter((id) => !ADJUDICATED.has(id));
  const absent = [...ADJUDICATED.keys()].filter((id) => !observed.includes(id));
  check(
    "residual differences are exactly the adjudicated four",
    unexpected.length === 0 && absent.length === 0,
    unexpected.length || absent.length
      ? `unexpected: ${unexpected.join(", ") || "none"} · absent: ${absent.join(", ") || "none"}`
      : `${observed.length} of ${ADJUDICATED.size}`,
  );
  for (const id of observed) {
    if (ADJUDICATED.has(id)) console.log(`         ${id.slice(0, 8)}  ${ADJUDICATED.get(id)}`);
  }
}

console.log("");
if (fails.length === 0) {
  console.log("PRECONDITIONS MET — the baseline may be replaced.");
} else {
  console.log(`REFUSED — ${fails.length} precondition(s) failed. Do not re-baseline.`);
  for (const f of fails) console.log(`  - ${f}`);
}
process.exit(fails.length === 0 ? 0 : 1);

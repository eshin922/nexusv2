/**
 * WHAT THE SEND ACTUALLY FROZE — every O3 requirement, checked against the row.
 *
 * The frozen snapshot is what the push reads. A projection that resolved
 * correctly proves nothing about the snapshot: the destination only reaches the
 * ERP if the FREEZE wrote it, and that is a different act on a different table.
 *
 * So this reads `quote_snapshot_lines` and the two recovery tables directly and
 * reports every requirement independently. It computes nothing from the
 * projection, on purpose — a verifier that re-derives its expectation from the
 * thing under test can only agree with it.
 *
 * READ-ONLY.
 *
 * Usage:  o3-frozen-verify.ts <quoteNumber> [tierLabel]
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

const quoteNumber = process.argv[2] ?? "DPS-1074";
const wantTier = process.argv[3] ?? "Tier 2";

const [quote] = (await db.execute(sql`
  SELECT id, quote_number, version_number, status FROM quotes WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<{ id: string; quote_number: string; version_number: number; status: string }>;

if (!quote) {
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

/** The CURRENT snapshot: the one with no superseded_at. */
const snaps = (await db.execute(sql`
  SELECT id, version_number, sent_at, superseded_at
    FROM quote_snapshots WHERE quote_id = ${quote.id}
   ORDER BY effective_from
`)) as unknown as Array<Record<string, unknown>>;

const current = snaps.filter((s) => s.superseded_at === null);
if (current.length !== 1) {
  console.log(`INDETERMINATE · expected exactly one current snapshot, found ${current.length}`);
  process.exit(2);
}
const snapshotId = current[0].id as string;

console.log(`QUOTE ${quote.quote_number} · v${quote.version_number} · ${quote.status}`);
console.log(`SNAPSHOTS ${snaps.length} total · current is v${current[0].version_number}`);
console.log("");

const fails: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
  if (!ok) fails.push(label);
};

// ── frozen OTC lines ──────────────────────────────────────────────────
const lines = (await db.execute(sql`
  SELECT l.id,
         l.display_name,
         COALESCE(l.bv011_destination::text, 'NULL')              AS dest,
         COALESCE(l.destination_unresolved_reason::text, 'NULL')  AS reason,
         lt.tier_label                                            AS tier_label,
         lt.line_amount::text                                     AS amount
    FROM quote_snapshot_lines l
    JOIN quote_snapshot_line_tiers lt ON lt.quote_snapshot_line_id = l.id
   WHERE l.quote_snapshot_id = ${snapshotId}
     AND l.line_kind = 'otc'
     AND lt.tier_label = ${wantTier}
   ORDER BY l.display_name
`)) as unknown as Array<Record<string, string>>;

console.log(`FROZEN OTC LINES AT ${wantTier} (${lines.length})`);
for (const l of lines) {
  console.log(`  ${String(l.display_name).slice(0, 42).padEnd(42)} dest=${l.dest.padEnd(18)} reason=${l.reason.padEnd(31)} amount=${String(l.amount).padStart(10)}`);
}
console.log("");

console.log("REQUIREMENTS");

const tooling = lines.find((l) => String(l.display_name).startsWith("Tooling"));
check("Tooling line frozen with otc_mould", tooling?.dest === "otc_mould", tooling ? `dest=${tooling.dest}` : "line absent");

const plates = lines.find((l) => String(l.display_name).includes("Label Set"));
check(
  "Label Print Plates frozen with otc_print_plates",
  plates?.dest === "otc_print_plates",
  plates ? `dest=${plates.dest}` : "line absent",
);

check(
  "neither carries destination_unresolved_reason",
  [tooling, plates].every((l) => l !== undefined && l.reason === "NULL"),
  [tooling?.reason ?? "-", plates?.reason ?? "-"].join(" / "),
);

// Included charges must not have become separate lines.
check(
  "Included charges emit no separate line",
  lines.length === 2,
  `${lines.length} OTC line(s) at ${wantTier}`,
);

const separateTotal = lines.reduce((n, l) => n + Number(l.amount), 0);
check(
  `one-time separate total = 9168.00 at ${wantTier}`,
  separateTotal.toFixed(2) === "9168.00",
  separateTotal.toFixed(2),
);

// ── frozen elections, at instance grain ───────────────────────────────
const elections = (await db.execute(sql`
  SELECT charge_key::text AS charge_key,
         mode::text       AS mode,
         COALESCE(charge_instance_id::text, 'NULL') AS instance
    FROM quote_snapshot_charge_recovery
   WHERE snapshot_id = ${snapshotId}
   ORDER BY charge_key, charge_instance_id
`)) as unknown as Array<Record<string, string>>;

console.log("");
console.log(`FROZEN ELECTIONS (${elections.length})`);
for (const e of elections) console.log(`  ${e.charge_key.padEnd(14)} ${e.mode.padEnd(10)} instance ${e.instance}`);

check(
  "four frozen elections",
  elections.length === 4,
  `${elections.length}`,
);
check(
  "every frozen election is instance-grain",
  elections.length > 0 && elections.every((e) => e.instance !== "NULL"),
  `${elections.filter((e) => e.instance === "NULL").length} with a null instance`,
);
check(
  "instance ids are distinct",
  new Set(elections.map((e) => e.instance)).size === elections.length,
  `${new Set(elections.map((e) => e.instance)).size} distinct`,
);

// ── recovery_ask stays NULL, live ─────────────────────────────────────
const asks = (await db.execute(sql`
  SELECT count(*) AS n, count(cit.recovery_ask) AS non_null
    FROM quote_charge_instance_tiers cit
    JOIN quote_charge_instances ci ON ci.id = cit.charge_instance_id
   WHERE ci.quote_id = ${quote.id}
`)) as unknown as Array<{ n: string; non_null: string }>;

console.log("");
check(
  "all twelve recovery_ask values NULL",
  asks[0].n === "12" && asks[0].non_null === "0",
  `${asks[0].n} rows, ${asks[0].non_null} non-null`,
);

// ── frozen instructions reconcile ─────────────────────────────────────
const instr = (await db.execute(sql`
  SELECT i.charge_key::text AS charge_key,
         i.treatment::text  AS treatment,
         COALESCE(i.charge_instance_id::text, 'NULL') AS instance,
         t.label            AS tier_label,
         i.cost::text       AS cost,
         COALESCE(i.governed_recovery::text, 'NULL') AS recovery
    FROM quote_snapshot_recovery_instructions i
    JOIN quote_tiers t ON t.id = i.tier_id
   WHERE i.quote_snapshot_id = ${snapshotId}
   ORDER BY i.charge_key, i.charge_instance_id, t.qty
`)) as unknown as Array<Record<string, string>>;

console.log("");
console.log(`FROZEN RECOVERY INSTRUCTIONS (${instr.length})`);
for (const r of instr) {
  console.log(
    `  ${r.charge_key.padEnd(14)} ${String(r.tier_label).padEnd(8)} ${r.treatment.padEnd(13)} cost=${String(r.cost).padStart(10)} recovery=${String(r.recovery).padStart(10)} instance ${r.instance.slice(0, 8)}`,
  );
}

check("twelve frozen instructions", instr.length === 12, `${instr.length}`);
check(
  "every instruction is instance-grain",
  instr.length > 0 && instr.every((r) => r.instance !== "NULL"),
  `${instr.filter((r) => r.instance === "NULL").length} with a null instance`,
);

// Reconciliation: the separately-billed instructions at the tier must sum to
// the frozen OTC line amounts. Independent of the projection — this compares
// two frozen tables against each other.
const sepAtTier = instr.filter((r) => r.tier_label === wantTier && r.treatment === "separate_line");
const sepSum = sepAtTier.reduce((n, r) => n + Number(r.recovery === "NULL" ? 0 : r.recovery), 0);
check(
  `separate-line instructions reconcile to the OTC lines at ${wantTier}`,
  sepSum.toFixed(2) === separateTotal.toFixed(2),
  `instructions ${sepSum.toFixed(2)} vs lines ${separateTotal.toFixed(2)}`,
);

console.log("");
console.log(fails.length === 0 ? "PASS" : `FAIL · ${fails.length} requirement(s): ${fails.join("; ")}`);
process.exit(fails.length === 0 ? 0 : 1);

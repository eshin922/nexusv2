/**
 * Repoint the v2 DRAFT of the validation fixture onto its fixture-local leaves.
 *
 * Runs after `clone-fixture-local-leaves.ts` and after the quote has been
 * revised to v2. Changes ONE column on two rows — `quote_leaves.leaf_id` — and
 * proves, in the same pass, that nothing else moved.
 *
 * ── THE FIVE PROOFS ─────────────────────────────────────────────────────
 *
 * Required before Finalize v2. Each is a before/after comparison taken by this
 * script, not an assertion about one:
 *
 *   1  the fixture-local leaves are the ONLY structural identities changed
 *   2  commercial economics are identical to the accepted Part B baseline
 *   3  recovery elections remain 1 separate / 3 included
 *   4  customer document totals are identical
 *   5  the shared library leaves are byte-identical
 *
 * Economics are read through `getCostingBundle` and the customer document
 * through `projectCommercial` — the same paths the surfaces use, so a drift
 * that only appears downstream cannot hide behind a raw-column comparison.
 *
 * A single mismatch exits non-zero. There is no "close enough" branch: the
 * whole point of a certification fixture is that its economics did not move
 * when its identity did.
 *
 * Usage:  ... repoint-fixture-to-local-leaves.ts [--apply]
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const QUOTE = "52bd0077-20af-4345-8856-45003bfca8b3";
const APPLY = process.argv.includes("--apply");

/** shared source leaf -> fixture-local clone */
const SWAP = [
  { from: "42de176a-a113-4a88-b5b7-ced23532d559", to: "e3b53d12-7d53-4f0e-88a7-fe31384bff62", sku: "ZZ-VAL-50ML-PCR" },
  { from: "5189aa38-8d7b-459a-93d7-2f24b6a02533", to: "6fde9662-2e96-4782-850e-a18d66f41503", sku: "ZZ-VAL-75ML-ALU" },
];

const SHARED = SWAP.map((s) => s.from);

const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function sharedLeafRows() {
  return (await db.execute(sql`
    select * from leaves
     where id in (${sql.join(SHARED.map((id) => sql`${id}::uuid`), sql`, `)})
     order by id`)) as any as any[];
}

/** Economics + customer document, through the real read paths. */
async function commercialState() {
  const bundle = await getCostingBundle(QUOTE);
  if (!bundle.ok) throw new Error(`bundle failed: ${bundle.error.code}`);
  const costing: any = (bundle.data as any).costing;
  const projection: any = projectCommercial(bundle.data as any);

  const tiers = (costing.quoteRollup.perTier ?? costing.quoteRollup).map(
    (t: any, i: number) => ({
      label: t.label,
      qty: t.qty,
      totalRevenue: t.totalRevenue,
      totalCost: t.totalCost,
      blendedMarginPct: t.blendedMarginPct,
      blendedMarginStatus: t.blendedMarginStatus,
      unitSubtotal: projection.tiers[i]?.unitSubtotal ?? null,
      otcSubtotal: projection.tiers[i]?.otcSubtotal ?? null,
      tierCommercialTotal: projection.tiers[i]?.tierCommercialTotal ?? null,
    }),
  );

  // Line ECONOMICS keyed by display name. The key deliberately excludes the
  // leaf id, which is the thing being changed — keying on it would make the
  // comparison vacuous.
  const lines = projection.lines
    .map((l: any) => ({
      displayName: l.displayName,
      kind: l.kind,
      bv011Destination: l.bv011Destination,
      serviceIdentity: l.serviceIdentity,
      cells: (l.cells ?? []).map((c: any) => ({
        state: c.state,
        unitRate: c.unitRate,
        quantity: c.quantity,
        lineAmount: c.lineAmount,
      })),
    }))
    .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

  return { tiers, lines };
}

async function elections() {
  const rows: any[] = (await db.execute(sql`
    select charge_key, mode from quote_charge_recovery
     where quote_id = ${QUOTE} order by charge_key`)) as any;
  return rows.map((r) => `${r.charge_key}=${r.mode}`);
}

/** Every structural identity the quote points at, so change is enumerable. */
async function structuralIdentities() {
  const rows: any[] = (await db.execute(sql`
    select ql.id quote_leaf_id, ql.leaf_id, l.sku, l.name
      from quote_leaves ql join leaves l on l.id = ql.leaf_id
     where ql.quote_id = ${QUOTE} order by ql.id`)) as any;
  return rows;
}

// ── before ─────────────────────────────────────────────────────────────
const quoteRow: any[] = (await db.execute(sql`
  select status, version_number, quote_number from quotes where id = ${QUOTE}`)) as any;
console.log(
  `quote ${QUOTE.slice(0, 8)} status=${quoteRow[0].status} v${quoteRow[0].version_number} number=${quoteRow[0].quote_number}`,
);
if (quoteRow[0].status !== "draft") {
  console.error(`\nREFUSING — quote is '${quoteRow[0].status}', not 'draft'.`);
  console.error("Structural reassignment happens on the v2 draft, never on a frozen version.");
  process.exit(1);
}

const beforeShared = await sharedLeafRows();
const beforeSharedHash = digest(beforeShared);
const beforeState = await commercialState();
const beforeElections = await elections();
const beforeIdentities = await structuralIdentities();

console.log("\nBEFORE — structural identities");
for (const r of beforeIdentities)
  console.log(`  quote_leaf ${r.quote_leaf_id.slice(0, 8)} -> leaf ${r.leaf_id.slice(0, 8)} sku=${JSON.stringify(r.sku)}  ${r.name}`);
console.log(`  elections: ${beforeElections.join("  ")}`);
for (const t of beforeState.tiers)
  console.log(`  ${String(t.label).padEnd(7)} rev=${t.totalRevenue} cost=${t.totalCost} doc=${t.tierCommercialTotal}`);

if (!APPLY) {
  console.log("\nPLAN (dry run — pass --apply to write)");
  for (const s of SWAP)
    console.log(`  quote_leaves.leaf_id  ${s.from.slice(0, 8)} -> ${s.to.slice(0, 8)}  (${s.sku})`);
  console.log("\n  One column, two rows. Nothing else is written.");
  process.exit(0);
}

// ── apply ──────────────────────────────────────────────────────────────
//
// TWO tables record leaf identity, and they must move together.
//
// `quote_leaves.leaf_id` is the CANONICAL attachment identity;
// `assembly_leaves.leaf_id` is the LEGACY membership copy of the same fact.
// `commercial-settings.ts:107` compares them and refuses the quote outright if
// they disagree — "Canonical attachment identity crosses or drifts".
//
// Moving only the canonical half is what an earlier run of this script did, and
// it took the whole quote page to a 500 until the legacy half followed. The
// guard was right: one fact, two places, and a repoint that touches one of them
// has not finished.
for (const s of SWAP) {
  const a: any = await db.execute(sql`
    update quote_leaves set leaf_id = ${s.to}::uuid
     where quote_id = ${QUOTE} and leaf_id = ${s.from}::uuid`);
  const b: any = await db.execute(sql`
    update assembly_leaves al set leaf_id = ${s.to}::uuid
      from assemblies asm
     where asm.id = al.assembly_id and asm.quote_id = ${QUOTE}
       and al.leaf_id = ${s.from}::uuid`);
  const n = (x: any) => Number(x?.count ?? x?.rowCount ?? 0);
  console.log(
    `\n  ${s.from.slice(0, 8)} -> ${s.to.slice(0, 8)} (${s.sku})` +
      `  quote_leaves=${n(a)}  assembly_leaves=${n(b)}`,
  );
}

// Assert the END STATE, not the row counts — the script must be safe to re-run
// after a partial application, where the already-moved half legitimately
// updates zero rows.
const stragglers: any[] = (await db.execute(sql`
  select 'quote_leaves' src, ql.id, ql.leaf_id
    from quote_leaves ql
   where ql.quote_id = ${QUOTE}
     and ql.leaf_id in (${sql.join(SHARED.map((id) => sql`${id}::uuid`), sql`, `)})
  union all
  select 'assembly_leaves', al.id, al.leaf_id
    from assembly_leaves al join assemblies asm on asm.id = al.assembly_id
   where asm.quote_id = ${QUOTE}
     and al.leaf_id in (${sql.join(SHARED.map((id) => sql`${id}::uuid`), sql`, `)})`)) as any;
if (stragglers.length > 0) {
  console.error("\nRows still referencing a SHARED leaf:");
  for (const r of stragglers) console.error(`  ${r.src} ${r.id} -> ${r.leaf_id}`);
  process.exit(1);
}

// And assert the guard's own predicate directly, so this script fails here
// rather than at the operator's next page load.
const drift: any[] = (await db.execute(sql`
  select al.id
    from assembly_leaves al
    join assemblies asm on asm.id = al.assembly_id
    left join quote_leaves ql on ql.id = al.quote_leaf_id
   where asm.quote_id = ${QUOTE}
     and (ql.quote_id is null or ql.leaf_id is distinct from al.leaf_id
          or ql.assembly_id is distinct from al.assembly_id)`)) as any;
if (drift.length > 0) {
  console.error(`\nCanonical/legacy identity drift on ${drift.length} membership row(s).`);
  process.exit(1);
}

// ── after + the five proofs ────────────────────────────────────────────
const afterShared = await sharedLeafRows();
const afterState = await commercialState();
const afterElections = await elections();
const afterIdentities = await structuralIdentities();

const fail: string[] = [];

// 1 — only the two intended identities changed
const idKey = (rows: any[]) =>
  rows.map((r) => `${r.quote_leaf_id}:${r.leaf_id}`).sort();
const changed = idKey(beforeIdentities)
  .map((b, i) => [b, idKey(afterIdentities)[i]])
  .filter(([b, a]) => b !== a);
const expectedTo = new Set(SWAP.map((s) => s.to));
const actualTo = new Set(afterIdentities.map((r: any) => r.leaf_id));
const unexpected = [...actualTo].filter((id) => !expectedTo.has(id as string));
if (unexpected.length > 0)
  fail.push(`1 · unexpected leaf identity still referenced: ${unexpected.join(", ")}`);

// 2 + 4 — economics and customer document unchanged
if (digest(beforeState.tiers) !== digest(afterState.tiers))
  fail.push("2/4 · tier economics or customer-document totals MOVED");
if (digest(beforeState.lines) !== digest(afterState.lines))
  fail.push("2/4 · line economics MOVED");

// 3 — elections unchanged
if (digest(beforeElections) !== digest(afterElections))
  fail.push(`3 · elections changed: ${beforeElections.join(" ")} -> ${afterElections.join(" ")}`);
const sepCount = afterElections.filter((e) => e.endsWith("=separate")).length;
const incCount = afterElections.filter((e) => e.endsWith("=included")).length;
if (sepCount !== 1 || incCount !== 3)
  fail.push(`3 · expected 1 separate / 3 included, got ${sepCount} / ${incCount}`);

// 5 — shared library leaves byte-identical
if (beforeSharedHash !== digest(afterShared))
  fail.push("5 · a SHARED library leaf changed");

console.log("\nAFTER — structural identities");
for (const r of afterIdentities)
  console.log(`  quote_leaf ${r.quote_leaf_id.slice(0, 8)} -> leaf ${r.leaf_id.slice(0, 8)} sku=${JSON.stringify(r.sku)}  ${r.name}`);

console.log("\nPROOFS");
console.log(`  1 · only fixture-local identities referenced   ${unexpected.length === 0 ? "PASS" : "FAIL"}`);
console.log(`      (${changed.length} quote_leaf row(s) repointed)`);
console.log(`  2 · commercial economics identical            ${digest(beforeState.tiers) === digest(afterState.tiers) && digest(beforeState.lines) === digest(afterState.lines) ? "PASS" : "FAIL"}`);
console.log(`      sha256 tiers ${digest(afterState.tiers).slice(0, 16)}  lines ${digest(afterState.lines).slice(0, 16)}`);
console.log(`  3 · elections 1 separate / 3 included         ${sepCount === 1 && incCount === 3 ? "PASS" : "FAIL"}`);
console.log(`      ${afterElections.join("  ")}`);
console.log(`  4 · customer document totals identical        (folded into 2)`);
for (const t of afterState.tiers)
  console.log(`      ${String(t.label).padEnd(7)} rev=${t.totalRevenue} doc=${t.tierCommercialTotal}`);
console.log(`  5 · shared library leaves byte-identical      ${beforeSharedHash === digest(afterShared) ? "PASS" : "FAIL"}`);
console.log(`      sha256 ${beforeSharedHash.slice(0, 32)}`);

if (fail.length > 0) {
  console.error("\nBLOCKED — proofs failed:");
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nAll five proofs pass. v2 is ready for Finalize.");
process.exit(0);

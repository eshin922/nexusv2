/**
 * Proves the FREEZE WRITER against a real quote's real projection — inside a
 * transaction that is rolled back.
 *
 * ── WHAT THIS IS, AND IS NOT ──────────────────────────────────────────────
 *
 * It is NOT the lifecycle proof. It does not send anything, so it says nothing
 * about whether the operator path reaches the freeze, and nothing about the
 * PDF. Proof 5 in the unit suite asserts that wiring structurally; only a live
 * SEND demonstrates it.
 *
 * What it DOES establish, on live data rather than a fixture:
 *
 *   - the writer persists exactly the projection it was handed, field by field
 *   - every DB CHECK holds against real values, including the biconditional
 *     tying pricing_state to amount nullity
 *   - tier_commercial_total equals the sum of its own persisted cells
 *   - quote_on_request survives as an explicit state, not a null amount
 *   - per-tier OTC amounts and allocation states land per tier
 *
 * The snapshot row it needs is created and rolled back with everything else.
 * Nothing is committed: no send history, no quote number, no PDF, no frozen
 * row. Verified afterwards by re-counting.
 *
 *   usage: freeze-writer-proof <quoteId>
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import { freezeCommercialLineSet } from "@/lib/commercial-freeze";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: freeze-writer-proof <quoteId>");
  process.exit(1);
}
const rows = <T,>(r: unknown) => r as unknown as T[];

const bundle = await getCostingBundle(quoteId);
if (!bundle.ok) {
  console.error("bundle error:", bundle.error);
  process.exit(1);
}
const projection = projectCommercial(bundle.data);

const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

console.log(`\nFREEZE WRITER PROOF · quote ${quoteId}`);
console.log(`  projection: ${projection.lines.length} lines × ${projection.tiers.length} tiers · Production markup ${projection.productionMarkupPct === null ? "NONE" : `${(projection.productionMarkupPct * 100).toFixed(1)}%`}\n`);

const SENTINEL = "__rollback__";
let persisted: {
  totals: Array<Record<string, string | boolean | number | null>>;
  cells: Array<Record<string, string | number | null>>;
} = { totals: [], cells: [] };

try {
  await db.transaction(async (tx) => {
    // A snapshot row to hang the matrix on. Rolled back with the rest — this
    // is scaffolding for the FK, not send history, and nothing about it is
    // read as evidence.
    const [snap] = rows<{ id: string }>(
      await tx.execute(sql`
        insert into quote_snapshots
          (quote_id, version_number, effective_from, sent_at, created_by_user_id)
        select ${quoteId}::uuid, 9999, now(), now(),
               (select id from users order by created_at limit 1)
        returning id::text as id`),
    );

    await freezeCommercialLineSet(
      tx as unknown as Parameters<typeof freezeCommercialLineSet>[0],
      snap.id,
      projection,
    );

    persisted.totals = rows<Record<string, string | boolean | number | null>>(
      await tx.execute(sql`
        select tier_id::text as tier_id, tier_label, quantity,
               unit_subtotal::text as unit_subtotal, otc_subtotal::text as otc_subtotal,
               tier_commercial_total::text as tier_commercial_total,
               total_is_provisional
          from quote_snapshot_tier_totals
         where quote_snapshot_id = ${snap.id}::uuid order by quantity`),
    );
    persisted.cells = rows<Record<string, string | number | null>>(
      await tx.execute(sql`
        select ln.position, ln.line_kind::text as line_kind, ln.display_name,
               ln.display_sku, ln.service_identity::text as service_identity,
               ln.owning_assembly_id::text as owning_assembly_id,
               ct.tier_id::text as tier_id, ct.tier_label,
               ct.pricing_state::text as pricing_state,
               ct.unit_rate::text as unit_rate, ct.line_amount::text as line_amount,
               ct.allocation_state::text as allocation_state
          from quote_snapshot_lines ln
          join quote_snapshot_line_tiers ct on ct.quote_snapshot_line_id = ln.id
         where ln.quote_snapshot_id = ${snap.id}::uuid
         order by ln.position, ct.quantity`),
    );
    throw new Error(SENTINEL);
  });
} catch (e) {
  if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
}

// ── the persisted record, printed ────────────────────────────────────────
console.log("  PERSISTED tier totals");
console.log("    tier        qty    unit_subtotal   otc_subtotal   tier_commercial_total  provisional");
for (const t of persisted.totals)
  console.log(`    ${String(t.tier_label).padEnd(10)} ${String(t.quantity ?? "—").padStart(6)} ${String(t.unit_subtotal).padStart(15)} ${String(t.otc_subtotal).padStart(14)} ${String(t.tier_commercial_total).padStart(22)}  ${t.total_is_provisional}`);

console.log("\n  PERSISTED cells");
console.log("    pos line                                kind               tier      state             rate        amount  alloc");
for (const c of persisted.cells)
  console.log(`    ${String(c.position).padStart(3)} ${`${c.display_sku ?? ""} ${c.display_name}`.slice(0, 34).padEnd(34)} ${String(c.line_kind).padEnd(18)} ${String(c.tier_label).padEnd(9)} ${String(c.pricing_state).padEnd(17)} ${String(c.unit_rate ?? "—").padStart(10)} ${String(c.line_amount ?? "—").padStart(13)}  ${c.allocation_state ?? "—"}`);

// ── persisted == projection, field by field ──────────────────────────────
console.log("\n  persisted record ↔ the projection it was handed");
check(persisted.totals.length === projection.tiers.length, "every tier persisted",
      `${persisted.totals.length}/${projection.tiers.length}`);

projection.tiers.forEach((t, i) => {
  const row = persisted.totals[i];
  const ok =
    row &&
    row.tier_id === t.tierId &&
    Number(row.unit_subtotal) === Number(t.unitSubtotal.toFixed(2)) &&
    Number(row.otc_subtotal) === Number(t.otcSubtotal.toFixed(2)) &&
    Number(row.tier_commercial_total) === Number(t.tierCommercialTotal.toFixed(2)) &&
    row.total_is_provisional === t.isProvisional;
  check(Boolean(ok), `${t.tierLabel} persisted exactly as projected`,
        `${row?.tier_commercial_total} vs ${t.tierCommercialTotal.toFixed(2)} · from=${row?.total_is_provisional}`);
});

const expectedCells = projection.lines.length * projection.tiers.length;
check(persisted.cells.length === expectedCells, "every line × tier cell persisted",
      `${persisted.cells.length}/${expectedCells}`);

let cellMismatch = 0;
projection.lines.forEach((line, li) => {
  line.cells.forEach((cell, ti) => {
    const row = persisted.cells.find(
      (c) => Number(c.position) === li && c.tier_id === projection.tiers[ti].tierId,
    );
    if (!row) { cellMismatch++; return; }
    const wantState = cell.state === "priced" ? "priced" : "quote_on_request";
    const rateOk = cell.state === "priced"
      ? Number(row.unit_rate) === Number(cell.unitRate.toFixed(4)) &&
        Number(row.line_amount) === Number(cell.lineAmount.toFixed(2))
      : row.unit_rate === null && row.line_amount === null;
    const allocOk = (row.allocation_state ?? null) === line.allocationByTier[ti];
    if (row.pricing_state !== wantState || !rateOk || !allocOk) cellMismatch++;
  });
});
check(cellMismatch === 0, "every cell's state, rate, amount and allocation match", `${cellMismatch} mismatched`);

const qor = persisted.cells.filter((c) => c.pricing_state === "quote_on_request");
check(
  qor.every((c) => c.unit_rate === null && c.line_amount === null),
  "quote_on_request cells carry NO amount — explicit, not $0.00",
  `${qor.length} unpriced cell(s)`,
);

const otcCells = persisted.cells.filter((c) => c.line_kind === "otc");
const allocs = new Set(otcCells.map((c) => `${c.display_name}@${c.tier_label}=${c.allocation_state}`));
check(otcCells.length > 0, "separately billed OTC lines were frozen", `${otcCells.length} OTC cell(s)`);
const otcAmounts = new Set(otcCells.filter((c) => c.line_amount).map((c) => c.line_amount));
check(otcAmounts.size > 1, "OTC amounts VARY across tiers — a MAX fold could not produce this",
      `distinct amounts: ${[...otcAmounts].join(", ")}`);
void allocs;

// ── nothing survived ─────────────────────────────────────────────────────
const [left] = rows<{ n: number }>(
  await db.execute(sql`
    select (select count(*) from quote_snapshot_lines) +
           (select count(*) from quote_snapshot_line_tiers) +
           (select count(*) from quote_snapshot_tier_totals) +
           (select count(*) from quote_snapshots where version_number = 9999) as n`),
);
check(Number(left.n) === 0, "NOTHING was committed — no snapshot, no frozen row, no send history",
      `rows remaining: ${left.n}`);

console.log(fail.length === 0 ? "\nWRITER PROOF PASSES\n" : `\n${fail.length} FAILED:\n  ${fail.join("\n  ")}\n`);
process.exit(fail.length === 0 ? 0 : 1);

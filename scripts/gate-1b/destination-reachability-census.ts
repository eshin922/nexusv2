/**
 * ADJUDICATION · the exact destination reachability set.
 *
 * Written to correct a register claim of "four reachable destinations unmapped"
 * that named three, two of which are per-line BY DESIGN and not defects at all.
 *
 * The question is not "which enum values lack a firm row". It is:
 *
 *   PRODUCER    can any code path emit this destination onto a line?
 *   REACHABLE   can an ACTIVE operator control cause that producer to run?
 *   RESOLUTION  firm-level map row, per-line selection, or nothing?
 *
 * A destination with no producer is catalogue, not gap. A per-line destination
 * with no firm row is correct, not missing. Only a firm-level destination that
 * an operator can reach and that has no row is a genuine refusal waiting to
 * happen.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import {
  SERVICE_IDENTITY_DESTINATION,
  OTC_COLUMN_DESTINATION,
  LINE_KIND_DESTINATION,
  isPerLineDestination,
  type Bv011Destination,
} from "@/lib/netsuite/bv011-destinations";
import {
  COMPONENT_CHARGE_DESTINATION,
  TOOLING_CLASSIFICATION_DESTINATION,
} from "@/lib/netsuite/component-charge-destination";

type Producer = { via: string; kind: "component_charge" | "tooling_class" | "direct_service" | "legacy_otc_column" | "line_kind" };

const producers = new Map<Bv011Destination, Producer[]>();
const add = (d: Bv011Destination, p: Producer) => {
  if (!producers.has(d)) producers.set(d, []);
  producers.get(d)!.push(p);
};

for (const [k, v] of Object.entries(COMPONENT_CHARGE_DESTINATION)) add(v as Bv011Destination, { via: `chargeKey:${k}`, kind: "component_charge" });
for (const [k, v] of Object.entries(TOOLING_CLASSIFICATION_DESTINATION)) add(v as Bv011Destination, { via: `toolingClass:${k}`, kind: "tooling_class" });
for (const [k, v] of Object.entries(SERVICE_IDENTITY_DESTINATION)) add(v as Bv011Destination, { via: `serviceIdentity:${k}`, kind: "direct_service" });
for (const [k, v] of Object.entries(OTC_COLUMN_DESTINATION)) add(v as Bv011Destination, { via: `legacyOtcColumn:${k}`, kind: "legacy_otc_column" });
for (const [k, v] of Object.entries(LINE_KIND_DESTINATION)) add(v as Bv011Destination, { via: `lineKind:${k}`, kind: "line_kind" });

// ── the enum, the firm map, and live usage ──────────────────────────────
const enumRows = (await db.execute(
  sql`SELECT unnest(enum_range(NULL::bv011_destination))::text v`,
)) as unknown as Array<{ v: string }>;
const all = enumRows.map((r) => r.v as Bv011Destination);

const mapRows = (await db.execute(
  sql`SELECT destination::text d, netsuite_item_code c FROM netsuite_destination_item_map`,
)) as unknown as Array<{ d: string; c: string }>;
const firmMap = new Map(mapRows.map((r) => [r.d, r.c]));

// Live Direct Service leaves — a service identity is only REACHABLE if an
// active, non-archived seeded leaf carries it.
const svcRows = (await db.execute(
  sql`SELECT service_identity::text si, sku, archived FROM leaves WHERE service_identity IS NOT NULL`,
)) as unknown as Array<{ si: string; sku: string; archived: boolean }>;
const activeService = new Set(svcRows.filter((r) => !r.archived).map((r) => r.si));

// Per-line selections actually recorded.
const perLine = (await db.execute(
  sql`SELECT count(*)::text n FROM quote_other_service_items`,
).catch(() => [{ n: "n/a" }])) as unknown as Array<{ n: string }>;

// Destinations actually present on frozen lines today.
const usedRows = (await db.execute(
  sql`SELECT bv011_destination::text d, count(*)::text n FROM quote_snapshot_lines
       WHERE bv011_destination IS NOT NULL GROUP BY 1`,
)) as unknown as Array<{ d: string; n: string }>;
const used = new Map(usedRows.map((r) => [r.d, r.n]));

console.log(`enum destinations        ${all.length}`);
console.log(`firm map rows            ${firmMap.size}`);
console.log(`per-line selections rows ${perLine[0]?.n}`);
console.log("");

const buckets: Record<string, string[]> = {
  gap: [], perline: [], firm_ok: [], legacy_only: [], no_producer: [],
};

const W = 30;
for (const d of all) {
  const ps = producers.get(d) ?? [];
  const mapped = firmMap.get(d);
  const isPerLine = isPerLineDestination(d);

  // Reachability: a producer whose trigger is an ACTIVE operator control.
  const live = ps.filter((p) => {
    if (p.kind === "direct_service") return activeService.has(p.via.split(":")[1]);
    if (p.kind === "legacy_otc_column") return false; // retired by OD-032 authoring removal
    return true; // component charge / tooling class / line kind
  });

  let bucket: keyof typeof buckets;
  if (ps.length === 0) bucket = "no_producer";
  else if (live.length === 0) bucket = "legacy_only";
  else if (isPerLine) bucket = "perline";
  else if (mapped) bucket = "firm_ok";
  else bucket = "gap";
  buckets[bucket].push(d);

  const flag =
    bucket === "gap" ? "GAP        "
    : bucket === "perline" ? "per-line   "
    : bucket === "firm_ok" ? "firm ok    "
    : bucket === "legacy_only" ? "legacy only"
    : "no producer";

  console.log(
    `${flag} ${d.padEnd(W)} map=${(mapped ?? "-").padEnd(10)} used=${(used.get(d) ?? "0").padStart(3)}  ${live.map((p) => p.via).join(", ") || (ps.map((p) => p.via).join(", ") || "(none)")}`,
  );
}

console.log("");
console.log("── the exact sets ──────────────────────────────────────");
for (const [k, v] of Object.entries(buckets)) {
  console.log(`${k.padEnd(13)} ${v.length}  ${v.join(", ") || "-"}`);
}
console.log("");
console.log(
  buckets.gap.length === 0
    ? "NO reachable firm-level destination is unmapped."
    : `REACHABLE + FIRM-LEVEL + UNMAPPED: ${buckets.gap.join(", ")}`,
);
process.exit(0);

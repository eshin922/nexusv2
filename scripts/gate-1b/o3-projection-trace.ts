/**
 * The LIVE commercial projection for a quote, as its OTC lines and their
 * accounting destinations.
 *
 * Run BEFORE Send. The frozen snapshot is what the push reads, and a
 * destination only reaches it if the projection resolved one at freeze time —
 * so this is the last moment a missing classification can be corrected without
 * a second revision.
 *
 * READ-ONLY. It projects and prints; it freezes nothing and writes nothing.
 *
 * Usage:  o3-projection-trace.ts <quoteNumber> [tierLabel]
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const quoteNumber = process.argv[2] ?? "DPS-1074";
const wantTier = process.argv[3] ?? "Tier 2";

const [quote] = (await db.execute(sql`
  SELECT id, quote_number, status, version_number
    FROM quotes WHERE quote_number = ${quoteNumber}
   ORDER BY version_number DESC LIMIT 1
`)) as unknown as Array<{
  id: string;
  quote_number: string;
  status: string;
  version_number: number;
}>;

if (!quote) {
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

const bundle = await getCostingBundle(quote.id);
if (!bundle.ok) {
  console.log(`UNRESOLVED · costing bundle: ${bundle.error.message}`);
  process.exit(2);
}

console.log(`QUOTE ${quote.quote_number} · v${quote.version_number} · ${quote.status}`);
console.log("");

// What the loader actually carries, which is where the classification was lost.
console.log("COMPONENT CHARGE META (as the loader supplies it)");
for (const m of bundle.data.componentChargeMeta ?? []) {
  console.log(
    `  ${m.chargeInstanceId} ${String(m.chargeKey).padEnd(14)} classification=${m.toolingClassification ?? "NULL"}  label=${m.label ?? "(none)"}`,
  );
}
console.log("");

const projection = projectCommercial(bundle.data);

const tiers = projection.tiers ?? [];
const tierIdx = tiers.findIndex((t) => t.tierLabel === wantTier);
if (tierIdx < 0) {
  console.log(`UNRESOLVED · no tier labelled ${wantTier}; have ${tiers.map((t) => t.tierLabel).join(", ")}`);
  process.exit(2);
}
console.log(`TIER ${wantTier} (index ${tierIdx})`);
console.log("");

console.log("OTC LINES");
let separateTotal = 0;
for (const line of projection.lines) {
  if (line.kind !== "otc") continue;
  const cell = line.cells[tierIdx];
  const priced = cell && cell.state === "priced";
  const amount = priced ? cell.lineAmount : null;
  if (amount !== null) separateTotal += amount;
  console.log(
    [
      `  ${String(line.displayName).slice(0, 40).padEnd(40)}`,
      `dest=${(line.bv011Destination ?? "NULL").padEnd(18)}`,
      `reason=${(line.destinationUnresolvedReason ?? "-").padEnd(31)}`,
      priced ? `amount=${amount!.toFixed(2).padStart(10)}` : "NOT A SEPARATE LINE",
    ].join(" "),
  );
}

console.log("");
console.log(`ONE-TIME SEPARATE TOTAL AT ${wantTier} = ${separateTotal.toFixed(2)}`);
// The projection computes the same figure independently. If these disagree the
// walk above is reading something other than what the tier total records.
console.log(`PROJECTION otcSubtotal              = ${tiers[tierIdx].otcSubtotal.toFixed(2)}`);
process.exit(0);

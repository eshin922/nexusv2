/** PRE-SEND expectation for the #300 walk — READ-ONLY.
 *
 *  Computes the shared commercial projection for a quote WITHOUT sending it,
 *  and prints the matrix the freeze is expected to persist and the PDF is
 *  expected to render. Recorded before SEND so the comparison afterwards is
 *  against something written down in advance, not reconstructed to match. */
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const quoteId = process.argv[2];
const b = await getCostingBundle(quoteId);
if (!b.ok) { console.error("bundle error:", b.error); process.exit(1); }
const p = projectCommercial(b.data);

console.log(`\nPRE-SEND EXPECTATION · quote ${quoteId}`);
console.log(`  governed Production markup: ${p.productionMarkupPct === null ? "NONE" : `${(p.productionMarkupPct * 100).toFixed(1)}%`}`);
console.log("\n  tier         qty      unit_subtotal    otc_subtotal   tier_commercial_total  provisional");
for (const t of p.tiers)
  console.log(`  ${t.tierLabel.padEnd(11)} ${String(t.quantity ?? "—").padStart(6)} ${t.unitSubtotal.toFixed(2).padStart(16)} ${t.otcSubtotal.toFixed(2).padStart(15)} ${t.tierCommercialTotal.toFixed(2).padStart(22)}  ${t.isProvisional}`);

console.log("\n  line                                    kind               " + p.tiers.map((t) => t.tierLabel.padStart(14)).join(""));
for (const l of p.lines) {
  const cells = l.cells.map((c) =>
    (c.state === "priced" ? c.lineAmount.toFixed(2) : "on request").padStart(14)).join("");
  console.log(`  ${`${l.displaySku ?? ""} ${l.displayName}`.slice(0, 38).padEnd(38)} ${l.kind.padEnd(18)}${cells}`);
}
console.log("\n  per-unit rates");
for (const l of p.lines) {
  if (l.kind === "otc") continue;
  const cells = l.cells.map((c) =>
    (c.state === "priced" ? c.unitRate.toFixed(4) : "—").padStart(14)).join("");
  console.log(`  ${`${l.displaySku ?? ""} ${l.displayName}`.slice(0, 38).padEnd(38)} ${"".padEnd(18)}${cells}`);
}
console.log("\n  OTC allocation by tier");
for (const l of p.lines) {
  if (l.kind !== "otc") continue;
  console.log(`  ${l.displayName.padEnd(38)} ${l.allocationByTier.map((a) => (a ?? "—").padStart(20)).join("")}`);
}
process.exit(0);

/**
 * READ ONLY. Per-tier, per-charge, per-OWNER decomposition of a quote's
 * commercial reconciliation, from the governed construction.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * "Where did the $840 come from?" took a full investigation to answer, and the
 * answer was that nothing was wrong: $840 was Tooling's $700 plus Project
 * setup's $140 at Tier 1. The figure was correct and unexplained, and the two
 * representations an operator could see -- Card 1's QUOTE-LEVEL amounts and the
 * document's PER-TIER reconciliation -- had no stated relationship.
 *
 * The same shape had already cost one investigation (an unexplained $9.5676
 * "Pricing decision" that turned out to be a residual), and a third one found a
 * real defect hiding inside it: recovery on a Direct Service leaf that the
 * engine counted and the customer document could not bill.
 *
 * So this is certification tooling, not product behaviour. It answers "which
 * charge, on which owner, under which treatment, contributed what" without
 * anyone having to reconstruct it by hand.
 *
 * ── WHAT IT PROVES ───────────────────────────────────────────────────────
 *
 *   sum(embedded contributions)  == the unit price's embedded recovery
 *   sum(separate contributions)  == the document's separately billed total
 *   goods + embedded + separate  == the all-in tier total
 *   engine revenue - document    == any unbillable Direct Service placement
 *
 * Governed zeros are PRINTED, not filtered: a leaf carrying no embedded
 * recovery is a fact, and hiding it makes the sum look like it came from fewer
 * places than it did.
 *
 * Owners stay distinct throughout. `rd_formulation` can exist twice on one
 * quote -- once on an assembly, where it is a legitimate separate fee, and once
 * on a Direct Service, where it cannot be billed at all. Aggregating them
 * because they share a charge key would erase the difference that matters.
 *
 * Reads only. No writes, no mutation, no repair.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types  *     --conditions=react-server  *     --experimental-loader ./scripts/support/src-resolver.mjs  *     scripts/gate-1b/recovery-tier-reconciliation.ts <quoteId> [tierIndex]
 */import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const qid = process.argv[2]!;
const only = process.argv[3] ? Number(process.argv[3]) : null;
const b = await getCostingBundle(qid);
if (!b.ok) { console.log("bundle failed", b.error.code); process.exit(1); }
const c: any = (b.data as any).costing;
const p: any = projectCommercial(b.data as any);
const tiers = c.quoteRollup.perTier ?? c.quoteRollup;
const usd = (n: any) =>
  n === null || n === undefined ? "        —" : Number(n).toFixed(2).padStart(11);

console.log(`\nglobal price adj: ${c.quote?.globalPriceAdjPct ?? "?"}`);

tiers.forEach((t: any, ti: number) => {
  if (only !== null && ti !== only) return;
  console.log(`\n${"=".repeat(112)}\nTIER ${ti + 1}  ${t.tierId.slice(0, 8)}  qty ${t.qty}`);
  console.log("=".repeat(112));

  console.log("\nPLACED CHARGES (from the constructed state, one row per charge per owner)");
  console.log("charge                    owner              ownerKind       placement      source     cost      gov.recovery   separate$");
  let embSum = 0, sepAll = 0, sepDS = 0;
  for (const s of c.skuRollups) {
    if (s.parentSkuId) continue; // top-level owners only; children fold into the assembly
    const cell = s.perTier.find((x: any) => x.tierId === t.tierId);
    const k = cell?.constructed;
    if (!k) continue;
    for (const ch of k.charges ?? []) {
      console.log(
        `${String(ch.chargeKey).padEnd(25)} ${String(s.skuLabel || s.skuId.slice(0, 8)).padEnd(18)} ` +
        `${String(ch.ownerKind).padEnd(15)} ${String(ch.placement).padEnd(14)} ${String(ch.source).padEnd(10)} ` +
        `${usd(ch.cost)} ${usd(ch.recoverableSell)} ${usd(ch.separateInvoiceAmount)}`,
      );
      sepAll += ch.separateInvoiceAmount ?? 0;
      if (ch.placement === "separate_line" && ch.ownerKind === "direct_service") sepDS += ch.recoverableSell ?? 0;
    }
  }

  console.log("\nEMBEDDED RECOVERY (per leaf cell — what the ladder actually put in the unit price)");
  for (const s of c.skuRollups) {
    if (s.skuRole !== "leaf") continue;
    const cell = s.perTier.find((x: any) => x.tierId === t.tierId);
    if (!cell) continue;
    const v = cell.embeddedRecoveryTotal;
    const q = s.qtyPerParent ?? 1;
    if (v === null) { console.log(`  ${String(s.skuLabel || s.skuId.slice(0,8)).padEnd(20)} OVERRIDDEN — attribution unknown`); continue; }
    // Zero is PRINTED, not filtered. A governed zero is a fact — this leaf
    // carries no embedded recovery — and hiding it makes the sum look like it
    // came from fewer places than it did.
    console.log(
      `  ${String(s.skuLabel || s.productName || s.skuId.slice(0, 8)).padEnd(20)} ${usd(v)}` +
        `  x qtyPerParent ${q}${v === 0 ? "   (governed zero)" : ""}`,
    );
    embSum += v * q;
  }
  console.log(`  ${"SUM".padEnd(20)} ${usd(embSum)}`);

  console.log("\nPROJECTION — separately billed lines (what the customer document actually charges)");
  let otcSum = 0;
  for (const l of p.lines.filter((x: any) => x.kind === "otc")) {
    const a = l.cells[ti]?.lineAmount ?? 0;
    otcSum += a;
    console.log(`  ${String(l.displayName).padEnd(30)} ${usd(a)}   sku=${l.displaySku ?? "—"}`);
  }
  console.log(`  ${"SUM".padEnd(30)} ${usd(otcSum)}`);

  const pt = p.tiers[ti];
  console.log("\nTIER RECONCILIATION");
  console.log(`  unit-price subtotal            ${usd(pt.unitSubtotal)}`);
  console.log(`     of which embedded recovery  ${usd(embSum)}`);
  console.log(`     goods before recovery       ${usd(pt.unitSubtotal - embSum)}`);
  console.log(`  + separate charges (billed)    ${usd(pt.otcSubtotal)}`);
  console.log(`  = all-in / turnkey             ${usd(pt.tierCommercialTotal)}`);
  console.log(`  engine tier revenue            ${usd(t.totalRevenue)}`);
  console.log(`  engine - document              ${usd(t.totalRevenue - pt.tierCommercialTotal)}` +
    (Math.abs(sepDS) > 0.005 ? `   <- Direct Service separate_line, unbillable: ${usd(sepDS)}` : ""));
  console.log(`  constructed separate total     ${usd(sepAll)}  (billed ${usd(otcSum)} + unbillable ${usd(sepDS)})`);
});
process.exit(0);

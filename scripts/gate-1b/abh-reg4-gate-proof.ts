/**
 * ABH retry — the REG-4 gate, READ-ONLY.
 *
 * This is the exact gate that refused the send: `buildFrozenSalesOrder` runs
 * REG-4 link A (the frozen record agrees with itself) and link B (the emitted
 * order sums to the frozen total, AND every line's quantity x rate reproduces
 * its frozen amount) and returns blockers instead of posting.
 *
 * Nothing is POSTed and nothing is written. Running this before the real retry
 * is deliberate: a retry that fails would leave a partial order in NetSuite,
 * and the gate can answer the question without that risk.
 */
import { buildFrozenSalesOrder } from "@/lib/netsuite/frozen-sales-order";
import { productionNetSuite } from "@/lib/integrations/netsuite-production";

const QUOTE_ID = "cfa7b84d-18fb-4ef0-9bba-ce2a44cd266c";

const netsuite = productionNetSuite;
const memo = new Map<string, Awaited<ReturnType<typeof netsuite.resolveItem>>>();
const resolveSku = async (sku: string) => {
  const hit = memo.get(sku);
  if (hit) return hit;
  const fresh = await netsuite.resolveItem(sku);
  memo.set(sku, fresh);
  return fresh;
};

const result = await buildFrozenSalesOrder(QUOTE_ID, { resolveSku });

console.log(`ABH - Neoprene Bag · quote ${QUOTE_ID.slice(0, 8)}\n`);

if (!result.ok) {
  console.log("REG-4 GATE: STILL REFUSED\n");
  for (const b of result.blockers) console.log(`  blocker  ${b.kind}: ${"remediation" in b ? b.remediation : ""}`);
  for (const f of result.reg4) console.log(`  reg4     ${f.kind}: ${f.detail}`);
  process.exit(1);
}

let sum = 0;
console.log("line                                     |    qty | posted rate   | amount     | qty x rate");
console.log("-".repeat(100));
for (const l of result.lines) {
  const cents = Math.round(Number(l.amount) * 100);
  sum += cents;
  const product = Math.round(Number(l.rate) * l.quantity * 100);
  console.log(
    `${l.description.slice(0, 40).padEnd(40)} | ${String(l.quantity).padStart(6)} | ` +
      `${String(l.rate).padEnd(13)} | ${l.amount.padStart(10)} | ` +
      `${(product / 100).toFixed(2).padStart(10)}${product === cents ? "  EXACT" : "  DRIFT"}`,
  );
}

console.log(`\nlines                : ${result.lines.length}`);
console.log(`emitted sum          : ${(sum / 100).toFixed(2)}`);
console.log(`accepted tier        : ${result.acceptedTierId}`);
console.log(
  "\nREG-4 GATE: PASSED — link A and link B both hold, and every line's " +
    "quantity x rate reproduces its frozen amount exactly.",
);
process.exit(0);

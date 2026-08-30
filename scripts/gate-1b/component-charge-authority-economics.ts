/** READ-ONLY. Representative economics for every component charge type under
 *  the charge-type pricing authority: governed cost -> category -> rate ->
 *  derived recovery. Printed per key, including the unclassified refusal.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { componentChargeEconomics } from "@/lib/costing";
import {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  componentChargeMarkupAuthority,
} from "@/lib/commercial-recovery/registry";

type R = Record<string, string | null>;
const rows = (await db.execute(sql`
  select category, default_markup_pct::text pct from markup_defaults`)) as unknown as R[];
const defaults = Object.fromEntries(rows.map((r) => [String(r.category), Number(r.pct)]));

const COST = 1000;
console.log(`markup_defaults (live): ${Object.entries(defaults).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`\nrepresentative cost ${COST.toFixed(2)} per charge\n`);
console.log("charge_key        label                 authority        rate    recovery   margin");
console.log("-".repeat(84));

for (const key of COMPONENT_CHARGE_KEYS) {
  const [econ] = componentChargeEconomics(
    [{ chargeInstanceId: `ci-${key}`, tierId: "t", chargeKey: key, ownerRef: "leaf", cost: COST }],
    defaults,
  );
  const a = componentChargeMarkupAuthority(key);
  const auth = a.kind === "governed" ? a.category : "UNCLASSIFIED";
  const rate = econ?.ratePct === null || econ?.ratePct === undefined ? "  —  " : `${(econ.ratePct * 100).toFixed(0)}%`;
  const recovered = econ?.recoverableSell;
  const rec = recovered === null || recovered === undefined ? "UNPRICED" : recovered.toFixed(2);
  const margin =
    recovered === null || recovered === undefined ? "  —  " : `${(((recovered - COST) / recovered) * 100).toFixed(1)}%`;
  console.log(
    `${key.padEnd(17)} ${COMPONENT_CHARGE_LABELS[key].padEnd(21)} ${auth.padEnd(16)} ${rate.padStart(5)}  ${rec.padStart(9)}  ${margin.padStart(6)}`,
  );
}
console.log("\nUNPRICED is BV-013, reached deliberately: no governed rate, no price.");
console.log("An unpriced charge cannot be sent -- the recovery diagnostic refuses it.");
process.exit(0);

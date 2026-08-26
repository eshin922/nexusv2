/**
 * Soak run 2's finding, re-measured on the live quote it was found on.
 *
 * The engine is exercised twice over ONE loaded input, with only the placement
 * election differing. Read-only: nothing is written, and the quote's own stored
 * election is not touched.
 */
import { loadQuoteCostingInput } from "../../src/app/actions/costing.ts";
import { computeQuoteCosting } from "../../src/lib/costing.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";

const QUOTE = "b59cb2e3-dd70-4df0-8a1d-5961772e6242";

const loaded = await loadQuoteCostingInput(QUOTE);
if (!loaded.ok) throw new Error(loaded.error.message);
const base = loaded.data;

function turnkey(elections: { chargeKey: string; mode: string }[]) {
  const input = { ...base, chargeElections: elections } as typeof base;
  const costing = computeQuoteCosting(input);
  const bundle = {
    markupDefaults: input.markupDefaults,
    skus: input.skus,
    production: input.production,
    costing,
  } as never;
  const t = projectCommercial(bundle).tiers[0];
  return { total: t.tierCommercialTotal, otc: t.otcSubtotal };
}

const legacy = turnkey([]);
const included = turnkey([{ chargeKey: "project_setup", mode: "included" }]);
const separate = turnkey([{ chargeKey: "project_setup", mode: "separate" }]);

const c = (n: number) => Math.round(n * 100) / 100;
console.log(`legacy  (no election)  turnkey ${c(legacy.total)}  otc ${c(legacy.otc)}`);
console.log(`elected included       turnkey ${c(included.total)}  otc ${c(included.otc)}`);
console.log(`elected separate       turnkey ${c(separate.total)}  otc ${c(separate.otc)}`);
console.log(`RUN 2 DELTA legacy->separate  ${c(legacy.total - separate.total)}`);
console.log(`           included->separate ${c(included.total - separate.total)}`);
process.exit(0);

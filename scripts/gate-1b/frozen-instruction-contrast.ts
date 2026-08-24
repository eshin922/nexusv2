/**
 * Can Accounting tell the two contracts apart in the frozen artifact?
 *
 * Edward's requirement for the SEND walk: one LEGACY instruction carrying a
 * null amortization basis, and one ELECTED instruction carrying frozen
 * totalRecovered / tierQuantity / perUnit — side by side, on a real quote.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT ──────────────────────────────
 *
 * It runs the real engine on a real quote's real input with one charge
 * elected and its sibling left on legacy, then projects the frozen
 * instructions through the SAME function the send transaction writes from.
 * The two rows it prints are the rows a SEND would insert.
 *
 * It is NOT a SEND. `sendQuote` requires an authenticated operator and renders
 * and uploads a PDF before its transaction, so it belongs in the browser walk.
 * What remains untested here is only that `sendQuote` calls this projection —
 * which is asserted structurally in tests/unit/frozen-recovery-instruction.
 *
 * Nothing is written. No election is persisted; the election exists only in an
 * in-memory copy of the costing input.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadQuoteCostingInput, getCostingBundle } from "@/app/actions/costing";
import { computeQuoteCosting } from "@/lib/costing";
import {
  instructionSentence,
  projectFrozenInstructions,
  type FrozenRecoveryInstruction,
} from "@/lib/commercial-recovery/frozen-instruction";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";

const failures: string[] = [];

/**
 * A quote carrying at least two electable charges, at least one of which is
 * amortized under legacy pricing — otherwise there is no legacy row to
 * contrast against.
 */
const candidates = (await db.execute(sql`
  select q.id::text as quote_id, q.status,
         coalesce(q.global_price_adj_pct::float8, 0) as gpa
    from quotes q
   where exists (
     select 1 from assemblies a
       join assembly_production_inputs api on api.assembly_id = a.id
      where a.quote_id = q.id
        and api.allocate_service_fees_to_cost = true
        and coalesce(api.setup_fee_total, 0) > 0
        and coalesce(api.tooling_total, 0) > 0
   )
   order by q.id::text
`)) as unknown as { quote_id: string; status: string; gpa: number }[];

console.log(
  `\nFrozen instruction — legacy vs elected, side by side\n` +
    `${candidates.length} quote(s) carry two amortized charges under legacy pricing\n`,
);

if (candidates.length === 0) {
  failures.push(
    "no quote carries two allocated charges — the contrast cannot be shown on real data",
  );
}

const show = (label: string, i: FrozenRecoveryInstruction) => {
  console.log(`    ${label}`);
  console.log(`      charge          ${i.chargeKey}`);
  console.log(`      treatment       ${i.treatment} · ${i.treatmentSource}`);
  console.log(`      cost            ${i.cost}`);
  console.log(`      recovery        ${i.governedRecovery}`);
  console.log(`      invoice line    ${i.separateInvoiceAmount}`);
  console.log(`      per unit        ${i.amortizedPerUnit}`);
  console.log(`      tier quantity   ${i.tierQuantity}`);
  console.log(`      instruction     ${instructionSentence(i)}`);
};

for (const q of candidates.slice(0, 2)) {
  const built = await loadQuoteCostingInput(q.quote_id);
  const bundle = await getCostingBundle(q.quote_id);
  if (!built.ok || !bundle.ok) {
    failures.push(`${q.quote_id}: input or bundle unavailable`);
    continue;
  }

  const leafIds = new Set(
    ((bundle.data.skus ?? []) as { id: string; skuRole?: string }[])
      .filter((s) => s.skuRole === "leaf")
      .map((s) => s.id),
  );
  const isLeaf = (id: string) => leafIds.has(id);

  const rows = buildRecoveryWorkspace({
    costing: bundle.data.costing,
    isLeaf,
    elections: bundle.data.chargeElections ?? [],
    allocationStates: [
      ...new Set(
        ((bundle.data.production ?? []) as { allocateServiceFeesToCost?: boolean | null }[])
          .map((p) => p.allocateServiceFeesToCost === true),
      ),
    ],
  }).filter(
    (r) => r.present && r.options.some((o) => o.mode === "included" && o.available),
  );

  if (rows.length < 2) {
    failures.push(`${q.quote_id}: fewer than two electable charges present`);
    continue;
  }

  // Elect the FIRST; leave the SECOND on legacy. One quote, one SEND, two
  // contracts — which is the shape Accounting has to read.
  const electedKey = rows[0].chargeKey as RecoveryChargeKey;
  const legacyKey = rows[1].chargeKey as RecoveryChargeKey;

  const costing = computeQuoteCosting({
    ...built.data,
    chargeElections: [
      ...(built.data.chargeElections ?? []).filter((e) => e.chargeKey !== electedKey),
      { chargeKey: electedKey, mode: "included" },
    ],
  });

  const instructions = projectFrozenInstructions(costing, isLeaf);
  const elected = instructions.find(
    (i) => i.chargeKey === electedKey && i.treatmentSource === "election",
  );
  const legacy = instructions.find(
    (i) => i.chargeKey === legacyKey && i.treatmentSource === "legacy",
  );

  console.log(`  ${q.quote_id}  gpa=${q.gpa}  ${instructions.length} instructions\n`);

  if (!elected) {
    failures.push(`${q.quote_id}: the elected charge produced no elected instruction`);
  } else {
    show("ELECTED", elected);
    if (elected.amortizedPerUnit === null) {
      failures.push(
        `${q.quote_id} ${electedKey}: an elected amortization froze NO per-unit basis`,
      );
    }
    if (elected.tierQuantity === null) {
      failures.push(`${q.quote_id} ${electedKey}: an elected amortization froze no basis quantity`);
    }
    if (elected.separateInvoiceAmount !== 0) {
      failures.push(
        `${q.quote_id} ${electedKey}: an amortized charge carries a separate invoice amount`,
      );
    }
  }

  console.log("");

  if (!legacy) {
    failures.push(`${q.quote_id}: the un-elected charge produced no legacy instruction`);
  } else {
    show("LEGACY", legacy);
    if (legacy.treatment !== "unit_price") {
      failures.push(
        `${q.quote_id} ${legacyKey}: expected an amortized legacy charge, got ${legacy.treatment}`,
      );
    }
    if (legacy.amortizedPerUnit !== null) {
      failures.push(
        `${q.quote_id} ${legacyKey}: a legacy amortization froze a per-unit the ladder moves`,
      );
    }
  }

  // The distinction, stated as the property rather than inferred from the two
  // blocks above: an accountant reading these two rows must be able to tell
  // them apart, and the sentences must not be the same sentence.
  if (elected && legacy) {
    if (instructionSentence(elected) === instructionSentence(legacy)) {
      failures.push(`${q.quote_id}: the two contracts produce an identical instruction`);
    }
    if (elected.treatment === legacy.treatment && elected.treatmentSource === legacy.treatmentSource) {
      failures.push(`${q.quote_id}: the two contracts are indistinguishable by treatment`);
    }
  }
  console.log("");
}

console.log(
  failures.length === 0
    ? `PASS — a single quote's frozen artifact distinguishes an elected amortization\n       (recovery + basis + $0 invoice) from a legacy one (no fixed basis, and why)\n`
    : `FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

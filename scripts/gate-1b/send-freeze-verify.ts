/**
 * Did the SEND freeze both instruction forms?
 *
 * The DB-side half of the browser walk. Run it after an operator sends a quote
 * that carries one ELECTED amortized charge and one LEGACY amortized charge.
 *
 * The acceptance, stated as Edward set it:
 *
 *   one elected amortized charge   totalRecovered + tierQuantity + perUnit
 *                                  frozen, separate invoice amount $0
 *
 *   one legacy amortized charge    NULL basis, and an instruction that says
 *                                  why it cannot truthfully state a fixed
 *                                  per-unit amount
 *
 * Both in the SAME snapshot, because the point is that Accounting can tell two
 * contracts apart inside one artifact — not that each is expressible alone.
 *
 * Read-only.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  instructionSentence,
  type FrozenRecoveryInstruction,
} from "@/lib/commercial-recovery/frozen-instruction";

const QUOTE = process.argv[2];
if (!QUOTE) {
  console.error("usage: send-freeze-verify <quoteId>");
  process.exit(2);
}

const failures: string[] = [];

const q = (await db.execute(sql`
  select q.status, q.sent_at, q.pdf_url,
         p.deal_name, q.scenario_label
    from quotes q join projects p on p.id = q.project_id
   where q.id = ${QUOTE}::uuid
`)) as unknown as {
  status: string; sent_at: string | null; pdf_url: string | null;
  deal_name: string; scenario_label: string;
}[];

if (q.length === 0) {
  console.log(`\nquote ${QUOTE} not found\n`);
  process.exit(1);
}

console.log(`\nSEND freeze — ${q[0].deal_name} / ${q[0].scenario_label}`);
console.log(`  status ${q[0].status}   sent_at ${q[0].sent_at ?? "-"}   pdf ${q[0].pdf_url ? "stored" : "none"}\n`);

if (q[0].status === "draft") {
  failures.push("the quote is still a draft — nothing has been sent");
}

// The newest snapshot: the one the send just wrote.
const snap = (await db.execute(sql`
  select id::text as id, version_number, created_at
    from quote_snapshots where quote_id = ${QUOTE}::uuid
   order by created_at desc limit 1
`)) as unknown as { id: string; version_number: number; created_at: string }[];

if (snap.length === 0) {
  failures.push("the send produced no snapshot");
} else {
  const rows = (await db.execute(sql`
    select charge_key, owner_ref, tier_id::text as tier_id,
           treatment, treatment_source,
           cost::float8 as cost,
           governed_recovery::float8 as governed_recovery,
           separate_invoice_amount::float8 as separate_invoice_amount,
           amortized_per_unit::float8 as amortized_per_unit,
           tier_quantity
      from quote_snapshot_recovery_instructions
     where quote_snapshot_id = ${snap[0].id}::uuid
     order by treatment_source desc, charge_key
  `)) as unknown as {
    charge_key: string; owner_ref: string; tier_id: string;
    treatment: string; treatment_source: string;
    cost: number; governed_recovery: number | null;
    separate_invoice_amount: number | null;
    amortized_per_unit: number | null; tier_quantity: number | null;
  }[];

  console.log(`  snapshot v${snap[0].version_number} · ${rows.length} frozen instruction(s)\n`);

  const asInstruction = (r: (typeof rows)[number]): FrozenRecoveryInstruction => ({
    chargeKey: r.charge_key as FrozenRecoveryInstruction["chargeKey"],
    ownerRef: r.owner_ref,
    tierId: r.tier_id,
    treatment: r.treatment as FrozenRecoveryInstruction["treatment"],
    treatmentSource: r.treatment_source as "election" | "legacy",
    cost: r.cost,
    governedRecovery: r.governed_recovery,
    separateInvoiceAmount: r.separate_invoice_amount,
    amortizedPerUnit: r.amortized_per_unit,
    tierQuantity: r.tier_quantity,
  });

  for (const r of rows) {
    console.log(
      `    ${r.charge_key.padEnd(18)} ${r.treatment.padEnd(13)} ${r.treatment_source.padEnd(8)} ` +
        `cost=${r.cost} rec=${r.governed_recovery} inv=${r.separate_invoice_amount} ` +
        `perUnit=${r.amortized_per_unit} qty=${r.tier_quantity}`,
    );
    console.log(`      ${instructionSentence(asInstruction(r))}\n`);
  }

  const elected = rows.filter(
    (r) => r.treatment_source === "election" && r.treatment === "unit_price",
  );
  const legacy = rows.filter(
    (r) => r.treatment_source === "legacy" && r.treatment === "unit_price",
  );

  if (elected.length === 0) {
    failures.push("no ELECTED amortized instruction was frozen");
  } else {
    for (const e of elected) {
      if (e.amortized_per_unit === null) {
        failures.push(`${e.charge_key}: elected amortization froze no per-unit basis`);
      }
      if (e.tier_quantity === null) {
        failures.push(`${e.charge_key}: elected amortization froze no basis quantity`);
      }
      if (e.governed_recovery === null) {
        failures.push(`${e.charge_key}: elected amortization froze no recovered total`);
      }
      if (e.separate_invoice_amount !== 0) {
        failures.push(
          `${e.charge_key}: amortized charge carries a separate invoice amount of ${e.separate_invoice_amount}`,
        );
      }
    }
  }

  if (legacy.length === 0) {
    failures.push("no LEGACY amortized instruction was frozen — the contrast is absent");
  } else {
    for (const l of legacy) {
      if (l.amortized_per_unit !== null) {
        failures.push(
          `${l.charge_key}: legacy amortization froze a per-unit (${l.amortized_per_unit}) the ladder moves`,
        );
      }
      if (l.tier_quantity !== null) {
        failures.push(`${l.charge_key}: legacy amortization froze a basis quantity`);
      }
      const sentence = instructionSentence(asInstruction(l));
      if (!/not independently governed/.test(sentence)) {
        failures.push(`${l.charge_key}: the legacy instruction does not say why it states no basis`);
      }
    }
  }

  // Both forms in ONE artifact, which is the actual requirement.
  if (elected.length > 0 && legacy.length > 0) {
    console.log(
      `  contrast      ${elected.length} elected + ${legacy.length} legacy amortized, same snapshot`,
    );
  }

  // The elections mirror and the instruction must agree about what was elected.
  const mirror = (await db.execute(sql`
    select charge_key, mode from quote_snapshot_charge_recovery
     where quote_snapshot_id = ${snap[0].id}::uuid
  `)) as unknown as { charge_key: string; mode: string }[];
  const mirrored = new Set(mirror.map((m) => m.charge_key));
  for (const e of elected) {
    if (!mirrored.has(e.charge_key)) {
      failures.push(
        `${e.charge_key}: frozen as ELECTED but absent from the elections mirror — two records of one decision disagree`,
      );
    }
  }
  for (const l of legacy) {
    if (mirrored.has(l.charge_key)) {
      failures.push(
        `${l.charge_key}: frozen as LEGACY but present in the elections mirror`,
      );
    }
  }
  console.log(`  mirror        ${mirror.length} election(s) frozen alongside`);
}

console.log(
  failures.length === 0
    ? `\nPASS — the sent artifact carries both contracts, distinguishably\n`
    : `\nFAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

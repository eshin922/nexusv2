/** READ-ONLY. Does Production carry any residual validation component charge
 *  or election?
 *
 *  Population-wide, and stated as THREE outcomes: present / authoritatively
 *  absent / could-not-read. A sweep that reports "clean" because a query threw
 *  is worse than no sweep.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = <T,>(r: unknown) => r as unknown as T[];

type Probe = { label: string; q: string };
const probes: Probe[] = [
  {
    label: "component-owned charge instances (owner_quote_leaf_id IS NOT NULL)",
    q: `select count(*)::text n from quote_charge_instances where owner_quote_leaf_id is not null`,
  },
  {
    label: "per-tier amounts on component-owned charges",
    q: `select count(*)::text n from quote_charge_instance_tiers t
          join quote_charge_instances i on i.id = t.charge_instance_id
         where i.owner_quote_leaf_id is not null`,
  },
  {
    label: "recovery elections bound to a component-owned charge",
    q: `select count(*)::text n from quote_charge_recovery r
          join quote_charge_instances i on i.id = r.charge_instance_id
         where i.owner_quote_leaf_id is not null`,
  },
  {
    label: "charge instances labelled like a validation fixture",
    q: `select count(*)::text n from quote_charge_instances
         where label ilike '%proof%' or label ilike '%OD-032%' or label ilike '%validation%'
            or label ilike '%SMOKE%' or label ilike '%TEST%' or label ilike '%ZZ-%'`,
  },
  {
    label: "frozen recovery instructions carrying an instance id",
    q: `select count(*)::text n from quote_snapshot_recovery_instructions where charge_instance_id is not null`,
  },
];

let unreadable = 0;
let present = 0;
console.log("PRODUCTION RESIDUE SWEEP — population-wide\n");
for (const p of probes) {
  try {
    const r = rows<{ n: string }>(await db.execute(sql.raw(p.q)));
    const n = Number(r[0].n);
    if (n > 0) present++;
    console.log(`  ${n === 0 ? "ZERO   " : "PRESENT"}  ${p.label}: ${n}`);
  } catch (e) {
    unreadable++;
    console.log(`  UNREADABLE  ${p.label}: ${(e as Error).message.slice(0, 70)}`);
  }
}

// CONTROL: the sweep must be able to COUNT something that genuinely exists,
// or every zero above is a broken instrument reporting silence.
const ctl = rows<{ n: string }>(await db.execute(sql`select count(*)::text n from quote_charge_instances`));
console.log(`\n  CONTROL — total charge instances of ANY kind: ${ctl[0].n}`);
if (Number(ctl[0].n) === 0) {
  console.log("  (control is itself zero — table empty, so the zeros above are consistent but weakly evidenced)");
}

console.log(
  `\n${unreadable > 0 ? "INDETERMINATE — some probes could not be read" : present === 0 ? "CLEAN — zero residual component charges or elections" : `${present} probe(s) found residue`}`,
);
process.exit(unreadable === 0 && present === 0 ? 0 : 1);

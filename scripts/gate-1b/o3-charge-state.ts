/**
 * O3's component-charge state, captured as one canonical string.
 *
 * ── WHY A CAPTURE AND NOT A CHECKLIST ───────────────────────────────────
 *
 * The operator step this exists for changes exactly one field on one row:
 * `quote_charge_instances.tooling_classification`, on O3's Bottle Tooling
 * instance. Every other charge fact must be untouched — twelve tier costs, four
 * recovery elections, twelve null recovery asks, three sibling classifications.
 *
 * A checklist of "did X change?" can only ask what someone thought to ask. A
 * byte comparison of the whole captured surface reports a field nobody
 * anticipated, which is the point: this runs BEFORE and AFTER the operator
 * action and the diff must be the one field.
 *
 * Pattern 60: it captures everything the claim covers, and it distinguishes
 * absence from failure — a quote that does not resolve prints `UNRESOLVED` and
 * exits non-zero rather than printing an empty capture that compares equal to
 * another empty capture.
 *
 * READ-ONLY. It writes nothing, and must not: the operator states the fact
 * through the UI, and a script that could set it would be the shortcut the
 * certification exists to rule out.
 *
 * Usage:  o3-charge-state.ts <quoteNumber>   e.g. DPS-1074
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

const quoteNumber = process.argv[2] ?? "DPS-1074";

const [quote] = (await db.execute(sql`
  SELECT id, quote_number, status, version_number
    FROM quotes
   WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<{
  id: string;
  quote_number: string;
  status: string;
  version_number: number;
}>;

if (!quote) {
  // Authoritatively absent, not "captured nothing".
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

const instances = (await db.execute(sql`
  SELECT ci.id,
         ci.charge_key,
         COALESCE(ci.label, '(no label)')          AS label,
         COALESCE(ci.owner_quote_leaf_id::text, '(quote-owned)') AS owner,
         COALESCE(ci.tooling_classification::text, 'NULL')       AS classification
    FROM quote_charge_instances ci
   WHERE ci.quote_id = ${quote.id}
   ORDER BY ci.charge_key, ci.id
`)) as unknown as Array<Record<string, string>>;

const tiers = (await db.execute(sql`
  SELECT cit.charge_instance_id,
         t.label                                  AS tier_label,
         cit.cost_amount::text                    AS cost,
         COALESCE(cit.recovery_ask::text, 'NULL') AS ask
    FROM quote_charge_instance_tiers cit
    JOIN quote_charge_instances ci ON ci.id = cit.charge_instance_id
    JOIN quote_tiers t             ON t.id  = cit.tier_id
   WHERE ci.quote_id = ${quote.id}
   ORDER BY cit.charge_instance_id, t.qty
`)) as unknown as Array<Record<string, string>>;

const elections = (await db.execute(sql`
  SELECT charge_key,
         COALESCE(charge_instance_id::text, 'NULL') AS instance,
         mode
    FROM quote_charge_recovery
   WHERE quote_id = ${quote.id}
   ORDER BY charge_key, charge_instance_id
`)) as unknown as Array<Record<string, string>>;

const lines: string[] = [
  `QUOTE ${quote.quote_number} · v${quote.version_number} · ${quote.status}`,
  "",
  `INSTANCES (${instances.length})`,
  ...instances.map(
    (r) =>
      `  ${r.id} ${r.charge_key.padEnd(14)} ${r.classification.padEnd(13)} ${r.label} · owner ${r.owner}`,
  ),
  "",
  `TIER COSTS (${tiers.length})`,
  ...tiers.map(
    (r) =>
      `  ${r.charge_instance_id} ${String(r.tier_label).padEnd(10)} cost=${String(r.cost).padStart(12)} ask=${r.ask}`,
  ),
  "",
  `ELECTIONS (${elections.length})`,
  ...elections.map((r) => `  ${r.charge_key.padEnd(14)} ${r.mode.padEnd(10)} instance ${r.instance}`),
];

console.log(lines.join("\n"));
process.exit(0);

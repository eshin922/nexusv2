/**
 * O4's authored state, as one canonical string.
 *
 * The v1 -> v2 revision changes exactly ONE fact: `detail_level` from
 * `itemized` to `turnkey_only`. Everything else -- membership, multiplicity,
 * structure, every cost, both charges, both elections, the tiers -- must be
 * byte-identical across it.
 *
 * A checklist can only ask what someone thought to ask. A byte comparison of
 * the whole captured surface reports a field nobody anticipated, which is the
 * point: this runs before and after and the diff must be empty.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

const Q = process.argv[2] ?? "6c024fbd-77d4-4b9a-9e7a-5f6235489329";
const lines: string[] = [];

const members = (await db.execute(sql`
  SELECT l.sku, al.quantity::text q, al.position p
    FROM assembly_leaves al
    JOIN assemblies a ON a.id = al.assembly_id
    JOIN leaves l ON l.id = al.leaf_id
   WHERE a.quote_id = ${Q} ORDER BY al.position`)) as unknown as Array<Record<string, string>>;
lines.push("MEMBERS");
for (const m of members) lines.push(`  ${String(m.sku).padEnd(22)} qty/parent=${m.q} pos=${m.p}`);

const struct = (await db.execute(sql`
  SELECT l.sku, COALESCE(l.service_identity::text,'-') si,
         CASE WHEN EXISTS (SELECT 1 FROM assembly_leaves al WHERE al.quote_leaf_id = ql.id)
              THEN 'group_member' ELSE 'top_level' END pos
    FROM quote_leaves ql JOIN leaves l ON l.id = ql.leaf_id
   WHERE ql.quote_id = ${Q} ORDER BY l.sku`)) as unknown as Array<Record<string, string>>;
lines.push("STRUCTURE");
for (const s of struct) lines.push(`  ${String(s.sku).padEnd(22)} ${String(s.si).padEnd(18)} ${s.pos}`);

const tiers = (await db.execute(sql`
  SELECT label, qty::text q FROM quote_tiers WHERE quote_id = ${Q} ORDER BY qty`)) as unknown as Array<Record<string, string>>;
lines.push("TIERS");
for (const t of tiers) lines.push(`  ${String(t.label).padEnd(8)} ${t.q}`);

const pkg = (await db.execute(sql`
  SELECT l.sku, t.label, i.unit_cost::text uc, COALESCE(i.category,'-') cat, i.markup_pct::text mk
    FROM assembly_leaf_inputs i
    JOIN quote_tiers t ON t.id = i.tier_id
    JOIN quote_leaves ql ON ql.id = i.quote_leaf_id
    JOIN leaves l ON l.id = ql.leaf_id
   WHERE t.quote_id = ${Q} ORDER BY l.sku, t.qty`)) as unknown as Array<Record<string, string>>;
lines.push("PACKAGING COSTS");
for (const p of pkg) lines.push(`  ${String(p.sku).padEnd(22)} ${String(p.label).padEnd(8)} ${String(p.cat).padEnd(11)} uc=${String(p.uc).padStart(8)} mk=${p.mk}`);

const svc = (await db.execute(sql`
  SELECT l.sku, COALESCE(l.service_identity::text,'-') si, t.label,
         COALESCE(api.rd_total::text,'-') rd,
         COALESCE(api.filling_blending_cost::text,'-') fb,
         COALESCE(api.cm_assembly_total::text,'-') cm
    FROM assembly_production_inputs api
    JOIN quote_tiers t ON t.id = api.tier_id
    JOIN quote_leaves ql ON ql.id = api.quote_leaf_id
    JOIN leaves l ON l.id = ql.leaf_id
   WHERE t.quote_id = ${Q} ORDER BY l.sku, t.qty`)) as unknown as Array<Record<string, string>>;
lines.push("SERVICE COSTS");
for (const s of svc) lines.push(`  ${String(s.si).padEnd(18)} ${String(s.label).padEnd(8)} rd=${String(s.rd).padStart(9)} fb=${String(s.fb).padStart(9)} cm=${String(s.cm).padStart(9)}`);

const charges = (await db.execute(sql`
  SELECT ci.id, ci.charge_key, COALESCE(ci.tooling_classification::text,'-') tc, l.sku owner
    FROM quote_charge_instances ci
    JOIN quote_leaves ql ON ql.id = ci.owner_quote_leaf_id
    JOIN leaves l ON l.id = ql.leaf_id
   WHERE ci.quote_id = ${Q} ORDER BY ci.charge_key`)) as unknown as Array<Record<string, string>>;
lines.push("CHARGE INSTANCES");
for (const c of charges) lines.push(`  ${c.id} ${String(c.charge_key).padEnd(14)} ${String(c.tc).padEnd(13)} owner=${c.owner}`);

const chargeTiers = (await db.execute(sql`
  SELECT ci.charge_key ck, t.label, cit.cost_amount::text c, COALESCE(cit.recovery_ask::text,'NULL') a
    FROM quote_charge_instance_tiers cit
    JOIN quote_charge_instances ci ON ci.id = cit.charge_instance_id
    JOIN quote_tiers t ON t.id = cit.tier_id
   WHERE ci.quote_id = ${Q} ORDER BY ci.charge_key, t.qty`)) as unknown as Array<Record<string, string>>;
lines.push("CHARGE COSTS");
for (const c of chargeTiers) lines.push(`  ${String(c.ck).padEnd(14)} ${String(c.label).padEnd(8)} cost=${String(c.c).padStart(10)} ask=${c.a}`);

const elections = (await db.execute(sql`
  SELECT charge_key::text k, mode::text m, COALESCE(charge_instance_id::text,'NULL') i
    FROM quote_charge_recovery WHERE quote_id = ${Q} ORDER BY charge_key`)) as unknown as Array<Record<string, string>>;
lines.push("ELECTIONS");
for (const e of elections) lines.push(`  ${String(e.k).padEnd(14)} ${String(e.m).padEnd(10)} ${e.i}`);

console.log(lines.join("\n"));
process.exit(0);

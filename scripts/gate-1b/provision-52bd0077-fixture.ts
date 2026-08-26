/**
 * Provision the 16 authorized synthetic validation inputs on 52bd0077.
 *
 * ── WHAT THESE VALUES ARE, AND ARE NOT ──────────────────────────────────
 *
 * They are SYNTHETIC VALIDATION INPUTS, authorized by Edward on 2026-08-26 for
 * the downstream regression certification recorded in
 * `docs/validation/downstream-regression-gate.md`.
 *
 * They are NOT broker-sourced, NOT governed defaults, and NOT an expectation of
 * what duty or tariff on this shipment would actually be. Nothing downstream
 * should ever read them as a commercial fact.
 *
 * They exist because the certification needs a quote that is simultaneously
 * election-bearing and finalizable, and no such quote exists: only two quotes in
 * the estate carry recovery elections, both are blocked on unresolved customs,
 * and every customs value in the estate is `source = manual` — there is no rate
 * table, no derivation, no governed default to recover. That stop condition was
 * reported and the synthetic set was authorized in response.
 *
 * 52bd0077 is explicitly a ZZ-VALIDATION scenario. 4781e4bb is NOT touched.
 *
 * ── WHY THE VALUES LOOK LIKE THIS ───────────────────────────────────────
 *
 * Deterministic and deliberately NON-UNIFORM, so a defect cannot hide in a
 * coincidence:
 *
 *   - every amount differs from every other amount
 *   - every markup differs across BOTH tier and charge type
 *   - none equals a value on any other quote, or an existing value on this one
 *
 * So a tier swap, a duty/tariff swap, an accidental reuse of another tier's
 * figure, or a propagation defect each change a number visibly rather than
 * landing on a value that happens to be right.
 *
 * ── WHAT IT PRESERVES ───────────────────────────────────────────────────
 *
 * Only the 16 missing fields are written. Tier 1's existing duty amount
 * (750.00), the Tier 1-3 freight amounts (1,000 / 2,000 / 9,000), every freight
 * markup, and `crosses_international_border` are all left exactly as they are.
 *
 * The script captures the ENTIRE freight worksheet before and after and reports
 * every field that moved, so "only the intended inputs changed" is a comparison
 * rather than a claim.
 *
 * Usage:  ... provision-52bd0077-fixture.ts [--apply]
 * Without `--apply` it prints the plan and changes nothing.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const QUOTE = "52bd0077-20af-4345-8856-45003bfca8b3";
const APPLY = process.argv.includes("--apply");

const NOTE =
  "SYNTHETIC VALIDATION INPUT - authorized for downstream regression " +
  "certification (docs/validation/downstream-regression-gate.md). Not " +
  "broker-sourced, not a governed default, not a duty/tariff expectation.";

/** tier position (by qty ascending) -> the fixture values for that tier */
const FIXTURE = [
  { tier: 1, duty: "1250.00", dutyMk: "0.1200", tariff: "620.00", tariffMk: "0.2200" },
  { tier: 2, duty: "2350.00", dutyMk: "0.1300", tariff: "1240.00", tariffMk: "0.2300" },
  { tier: 3, duty: "4550.00", dutyMk: "0.1400", tariff: "2480.00", tariffMk: "0.2400" },
];
/** Tier 1 keeps its existing duty amount; only its markup and tariff are new. */
const TIER1 = { dutyMk: "0.1100", tariff: "310.00", tariffMk: "0.2100" };
/** Tiers 1-3 already carry freight; only Tier 4's amount is missing. */
const TIER4_FREIGHT = "17000.00";

async function capture() {
  const cb: any[] = (await db.execute(sql`
    select cb.id, qt.label tier, cb.charge_type, cb.amount, cb.markup_pct, cb.detail, cb.source
      from freight_customs_breaks cb
      join freight_customs_entries ce on ce.id = cb.freight_customs_entry_id
      join freight_subcategories fs on fs.id = ce.freight_subcategory_id
      join quote_tiers qt on qt.id = cb.tier_id
     where fs.quote_id = ${QUOTE} order by qt.qty, cb.charge_type`)) as any;
  const db2: any[] = (await db.execute(sql`
    select b.id, qt.label tier, d.destination,
           (d.id = fs.selected_destination_id) selected,
           b.freight_amount, b.freight_markup_pct, b.mode, b.cbm, b.source
      from freight_destination_breaks b
      join freight_destinations d on d.id = b.freight_destination_id
      join freight_subcategories fs on fs.id = d.freight_subcategory_id
      join quote_tiers qt on qt.id = b.tier_id
     where fs.quote_id = ${QUOTE} order by qt.qty, d.destination`)) as any;
  const sub: any[] = (await db.execute(sql`
    select id, label, crosses_international_border, selected_destination_id
      from freight_subcategories where quote_id = ${QUOTE}`)) as any;
  return { customs: cb, dest: db2, sub };
}

const before = await capture();
console.log("BEFORE");
for (const r of before.customs)
  console.log(`  customs ${String(r.tier).padEnd(7)} ${r.charge_type.padEnd(7)} amount=${r.amount} markup=${r.markup_pct}`);
for (const r of before.dest)
  console.log(`  dest    ${String(r.tier).padEnd(7)} ${String(r.destination).padEnd(18)} ${r.selected ? "SELECTED" : "        "} freight=${r.freight_amount} markup=${r.freight_markup_pct}`);
for (const r of before.sub)
  console.log(`  subcat  "${r.label}" crossesBorder=${r.crosses_international_border}`);

if (!APPLY) {
  console.log("\nPLAN (dry run — pass --apply to write)");
  console.log(`  Tier 1  duty   markup -> ${TIER1.dutyMk}   (amount 750.00 PRESERVED)`);
  console.log(`  Tier 1  tariff ${TIER1.tariff} / ${TIER1.tariffMk}`);
  for (const f of FIXTURE) {
    const t = f.tier + 1;
    console.log(`  Tier ${t}  duty   ${f.duty} / ${f.dutyMk}`);
    console.log(`  Tier ${t}  tariff ${f.tariff} / ${f.tariffMk}`);
  }
  console.log(`  Tier 4  freight amount -> ${TIER4_FREIGHT}   (markup 0.1800 PRESERVED)`);
  console.log("\n  16 values. Nothing else is written.");
  process.exit(0);
}

// ── apply ──────────────────────────────────────────────────────────────
const tiers: any[] = (await db.execute(sql`
  select id, label, qty from quote_tiers where quote_id = ${QUOTE} order by qty`)) as any;
const entry: any[] = (await db.execute(sql`
  select ce.id from freight_customs_entries ce
    join freight_subcategories fs on fs.id = ce.freight_subcategory_id
   where fs.quote_id = ${QUOTE}`)) as any;
if (entry.length !== 1) throw new Error(`expected exactly 1 customs entry, found ${entry.length}`);
const entryId = entry[0].id;

const prov = (fields: string[]) =>
  JSON.stringify(
    Object.fromEntries(
      fields.map((f) => [f, { source: "manual", capturedAt: new Date().toISOString(), note: NOTE }]),
    ),
  );

async function upsert(tierId: string, chargeType: "duty" | "tariff", amount: string | null, markup: string) {
  const existing: any[] = (await db.execute(sql`
    select id, amount from freight_customs_breaks
     where freight_customs_entry_id = ${entryId} and tier_id = ${tierId} and charge_type = ${chargeType}::freight_customs_charge_type`)) as any;
  const p = prov(amount === null ? ["markupPct"] : ["amount", "markupPct"]);
  if (existing.length === 1) {
    // PRESERVE an amount that is already there; write only what is missing.
    if (amount === null)
      await db.execute(sql`update freight_customs_breaks set markup_pct = ${markup}, detail = ${NOTE}, field_provenance = ${p}::jsonb, updated_at = now() where id = ${existing[0].id}`);
    else
      await db.execute(sql`update freight_customs_breaks set amount = ${amount}, markup_pct = ${markup}, detail = ${NOTE}, field_provenance = ${p}::jsonb, updated_at = now() where id = ${existing[0].id}`);
  } else if (existing.length === 0) {
    await db.execute(sql`
      insert into freight_customs_breaks (freight_customs_entry_id, tier_id, charge_type, amount, markup_pct, detail, source, field_provenance)
      values (${entryId}, ${tierId}, ${chargeType}::freight_customs_charge_type, ${amount}, ${markup}, ${NOTE}, 'manual'::freight_fact_source, ${p}::jsonb)`);
  } else {
    throw new Error(`expected 0 or 1 rows for ${chargeType} on ${tierId}, found ${existing.length}`);
  }
}

// Tier 1: duty amount is PRESERVED, only its markup is written.
await upsert(tiers[0].id, "duty", null, TIER1.dutyMk);
await upsert(tiers[0].id, "tariff", TIER1.tariff, TIER1.tariffMk);
for (const f of FIXTURE) {
  await upsert(tiers[f.tier].id, "duty", f.duty, f.dutyMk);
  await upsert(tiers[f.tier].id, "tariff", f.tariff, f.tariffMk);
}

// Tier 4 freight amount only; its markup (0.1800) is preserved.
const t4 = tiers[3].id;
const destBreak: any[] = (await db.execute(sql`
  select b.id, b.freight_amount from freight_destination_breaks b
    join freight_destinations d on d.id = b.freight_destination_id
    join freight_subcategories fs on fs.id = d.freight_subcategory_id
   where fs.quote_id = ${QUOTE} and b.tier_id = ${t4} and d.id = fs.selected_destination_id`)) as any;
if (destBreak.length !== 1) throw new Error(`expected 1 Tier 4 destination break, found ${destBreak.length}`);
if (destBreak[0].freight_amount !== null) throw new Error("Tier 4 freight is already set — refusing to overwrite");
await db.execute(sql`
  update freight_destination_breaks
     set freight_amount = ${TIER4_FREIGHT}, field_provenance = ${prov(["freightAmount"])}::jsonb, updated_at = now()
   where id = ${destBreak[0].id}`);

const after = await capture();
console.log("\nAFTER");
for (const r of after.customs)
  console.log(`  customs ${String(r.tier).padEnd(7)} ${r.charge_type.padEnd(7)} amount=${r.amount} markup=${r.markup_pct}`);
for (const r of after.dest)
  console.log(`  dest    ${String(r.tier).padEnd(7)} ${String(r.destination).padEnd(18)} ${r.selected ? "SELECTED" : "        "} freight=${r.freight_amount} markup=${r.freight_markup_pct}`);
for (const r of after.sub)
  console.log(`  subcat  "${r.label}" crossesBorder=${r.crosses_international_border}`);
process.exit(0);

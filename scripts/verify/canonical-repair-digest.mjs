/**
 * Commercial + structural digests for the canonical-attachment repair.
 *
 * The repair populates `quote_leaves` and links `assembly_leaves.quote_leaf_id`
 * on quotes that include sent, accepted and complete ones. Those are frozen
 * commitments, so the burden is to PROVE the repair is commercially neutral
 * rather than to argue it. This script is the before/after evidence.
 *
 * Three digests per quote, deliberately separated:
 *
 *   commercial — every value a customer or the business could see or be held
 *                to: status, accepted tier, snapshots, tier quantities, unit
 *                costs, markups, overrides, targets, production and freight.
 *                MUST be byte-identical across the repair.
 *
 *   structural — the legacy membership tree WITHOUT the canonical pointer:
 *                ids, parentage, quantity, position. MUST also be identical;
 *                the repair adds a pointer, it does not restructure anything.
 *
 *   pointer    — the pointer column and canonical rows. This one is EXPECTED
 *                to change. Kept separate so a change here can never be
 *                mistaken for a commercial change, and vice versa.
 *
 * Usage:
 *   node scripts/verify/canonical-repair-digest.mjs before > /tmp/before.json
 *   node scripts/verify/canonical-repair-digest.mjs after  > /tmp/after.json
 *   node scripts/verify/canonical-repair-digest.mjs compare /tmp/before.json /tmp/after.json
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const mode = process.argv[2] ?? "before";

if (mode === "compare") {
  const a = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const b = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const ids = [...new Set([...Object.keys(a.quotes), ...Object.keys(b.quotes)])].sort();
  let commercialDrift = 0;
  let structuralDrift = 0;
  console.log("quote                                 status     commercial structural pointer");
  for (const id of ids) {
    const x = a.quotes[id];
    const y = b.quotes[id];
    if (!x || !y) {
      console.log(`${id}  MISSING ON ONE SIDE`);
      commercialDrift++;
      continue;
    }
    const c = x.commercial === y.commercial ? "same" : "CHANGED";
    const s = x.structural === y.structural ? "same" : "CHANGED";
    const p = x.pointer === y.pointer ? "same" : "changed";
    if (c === "CHANGED") commercialDrift++;
    if (s === "CHANGED") structuralDrift++;
    console.log(`${id}  ${String(y.status).padEnd(10)} ${c.padEnd(10)} ${s.padEnd(10)} ${p}`);
  }
  console.log("");
  console.log(`commercial drift: ${commercialDrift}  (must be 0)`);
  console.log(`structural drift: ${structuralDrift}  (must be 0)`);
  process.exitCode = commercialDrift === 0 && structuralDrift === 0 ? 0 : 1;
} else {
  for (const line of readFileSync("C:/Code/nexusv2/.env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL, {
    prepare: false,
    max: 2,
  });

  const md5 = (rows) => createHash("md5").update(JSON.stringify(rows)).digest("hex");

  // Every quote that owns at least one legacy membership row — not just the
  // orphaned ones, so an unexpected change to an already-clean quote is caught
  // too.
  const quotes = await sql`
    SELECT DISTINCT q.id, q.status
    FROM quotes q
    JOIN assemblies a ON a.quote_id = q.id
    JOIN assembly_leaves al ON al.assembly_id = a.id
    ORDER BY q.id`;

  const out = { capturedAt: new Date().toISOString(), quotes: {} };

  for (const q of quotes) {
    const id = q.id;

    const commercial = md5([
      await sql`SELECT status, accepted_at, sent_at, accepted_tier_id, accept_source,
                       customer_accepted_at, customer_accepted_tier_id,
                       global_price_adj_pct, target_margin_pct, freight_markup_pct,
                       quote_number, pdf_url, accepted_snapshot_json,
                       payment_terms_snapshot, lead_time_snapshot, incoterms_snapshot,
                       tcs_snapshot, days_valid_snapshot, netsuite_so_id,
                       netsuite_so_tranid, netsuite_so_push_status,
                       pdf_layout, detail_level, include_spec_addendum,
                       scenario_status, version_number, is_recommended
                FROM quotes WHERE id = ${id}`,
      await sql`SELECT id, label, qty, sort_order, tier_price_adj_pct, recommended
                FROM quote_tiers WHERE quote_id = ${id} ORDER BY id`,
      await sql`SELECT id, sku, name, unit_price, unit_cost, margin_pct, markup_pct, position
                FROM assemblies WHERE quote_id = ${id} ORDER BY id`,
      await sql`SELECT ali.id, ali.tier_id, ali.line_group_id, ali.supplier,
                       ali.qty_per_sellable_unit, ali.category, ali.markup_pct,
                       ali.markup_pct_source, ali.inventory_eligible, ali.unit_cost,
                       ali.purchase_qty, ali.pricing_vendor_hubspot_company_id
                FROM assembly_leaf_inputs ali
                JOIN assembly_leaves al ON al.id = ali.assembly_leaf_id
                JOIN assemblies a ON a.id = al.assembly_id
                WHERE a.quote_id = ${id} ORDER BY ali.id`,
      await sql`SELECT api.id, api.tier_id, api.customer_ships_raws,
                       api.allocate_service_fees_to_cost, api.filling_blending_cost,
                       api.cm_assembly_total, api.setup_fee_total,
                       api.tooling_artwork_total, api.rd_total, api.other_service_total,
                       api.bulk_raw_cost, api.actual_units_produced
                FROM assembly_production_inputs api
                JOIN assemblies a ON a.id = api.assembly_id
                WHERE a.quote_id = ${id} ORDER BY api.id`,
      await sql`SELECT o.assembly_leaf_id, o.tier_id, o.sell_price_override
                FROM assembly_leaf_overrides o
                JOIN assembly_leaves al ON al.id = o.assembly_leaf_id
                JOIN assemblies a ON a.id = al.assembly_id
                WHERE a.quote_id = ${id} ORDER BY o.assembly_leaf_id, o.tier_id`,
      await sql`SELECT t.assembly_leaf_id, t.tier_id, t.client_target_price_per_unit
                FROM assembly_leaf_targets t
                JOIN assembly_leaves al ON al.id = t.assembly_leaf_id
                JOIN assemblies a ON a.id = al.assembly_id
                WHERE a.quote_id = ${id} ORDER BY t.assembly_leaf_id, t.tier_id`,
    ]);

    // Deliberately EXCLUDES quote_leaf_id — that is the pointer digest's job.
    const structural = md5([
      await sql`SELECT al.id, al.assembly_id, al.leaf_id, al.quantity, al.position,
                       al.parent_assembly_leaf_id, al.created_at
                FROM assembly_leaves al
                JOIN assemblies a ON a.id = al.assembly_id
                WHERE a.quote_id = ${id} ORDER BY al.id`,
    ]);

    const pointer = md5([
      await sql`SELECT al.id, al.quote_leaf_id
                FROM assembly_leaves al
                JOIN assemblies a ON a.id = al.assembly_id
                WHERE a.quote_id = ${id} ORDER BY al.id`,
      await sql`SELECT id, assembly_id, leaf_id, leaf_spec_version_id, pinned_at,
                       quantity, position
                FROM quote_leaves WHERE quote_id = ${id} ORDER BY id`,
    ]);

    out.quotes[id] = { status: q.status, commercial, structural, pointer };
  }

  await sql.end();
  console.log(JSON.stringify(out, null, 1));
}

// Backfill — worksheet Freight break rows for tiers added after a destination.
//
// `addTier` / `applyTierPreset` fanned out to packaging inputs, production
// inputs and the legacy freight LEG model, but never to
// `freight_destination_breaks`. Destinations created before a tier existed
// therefore have no break row at that tier, and Design Authority Row 04
// (amount x markup -> sell per unit at the actual Quote break) cannot compute
// there — there is no row to price.
//
// The action layer is fixed forward; this repairs destinations already
// stranded.
//
// SAFETY
//
//   - Additive only. Inserts (destination, tier) pairs that have no row.
//     Never updates or deletes, so an entered amount or markup cannot be
//     touched.
//   - Idempotent. A second run inserts nothing.
//   - Inherits `mode`, `freightMarkupPct` and `shipmentNote` from the
//     destination's own existing breaks, matching the action-layer rule.
//     `freightAmount` is deliberately left NULL: an amount is negotiated for a
//     specific quantity break and must be entered, never carried across
//     quantities.
//   - Draft-only by default, mirroring the assertDraft mutability contract.
//     Pass --include-sent to repair frozen revisions, which is normally wrong:
//     a sent quote's freight was priced against the tiers it had.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/backfill/worksheet-freight-tier-breaks.ts [--apply] [--include-sent]

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const INCLUDE_SENT = process.argv.includes("--include-sent");
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });

try {
  const missing = await sql<
    {
      quoteId: string;
      scenarioLabel: string | null;
      status: string;
      destinationId: string;
      destination: string;
      tierId: string;
      tierLabel: string;
    }[]
  >`
    select q.id as "quoteId", q.scenario_label as "scenarioLabel", q.status,
           d.id as "destinationId", d.destination, t.id as "tierId", t.label as "tierLabel"
    from freight_destinations d
    join freight_subcategories s on s.id = d.freight_subcategory_id
    join quotes q on q.id = s.quote_id
    join quote_tiers t on t.quote_id = q.id
    where (${INCLUDE_SENT} or q.status = 'draft')
      and not exists (
        select 1 from freight_destination_breaks b
        where b.freight_destination_id = d.id and b.tier_id = t.id
      )
    order by q.created_at, d.display_order, t.sort_order`;

  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${missing.length} missing (destination, tier) break rows` +
      `${INCLUDE_SENT ? " [including sent]" : " [draft only]"}\n`,
  );

  const byQuote = new Map<string, typeof missing>();
  for (const row of missing) {
    const list = byQuote.get(row.quoteId) ?? [];
    list.push(row);
    byQuote.set(row.quoteId, list);
  }
  for (const [quoteId, rows] of byQuote) {
    console.log(
      `  ${quoteId.slice(0, 8)}  ${String(rows[0].scenarioLabel ?? "").slice(0, 26).padEnd(26)} [${rows[0].status}]  +${rows.length}`,
    );
    for (const r of rows.slice(0, 4)) {
      console.log(`      ${r.destination} @ ${r.tierLabel}`);
    }
    if (rows.length > 4) console.log(`      ... +${rows.length - 4} more`);
  }

  if (APPLY && missing.length > 0) {
    // Inherit from any existing break on the same destination; amount stays
    // NULL so the operator enters the figure for that quantity.
    const inserted = await sql`
      insert into freight_destination_breaks
        (freight_destination_id, tier_id, mode, freight_markup_pct, shipment_note)
      select d.id, t.id, prior.mode, prior.freight_markup_pct, prior.shipment_note
      from freight_destinations d
      join freight_subcategories s on s.id = d.freight_subcategory_id
      join quotes q on q.id = s.quote_id
      join quote_tiers t on t.quote_id = q.id
      left join lateral (
        select b.mode, b.freight_markup_pct, b.shipment_note
        from freight_destination_breaks b
        where b.freight_destination_id = d.id
        order by b.created_at
        limit 1
      ) prior on true
      where (${INCLUDE_SENT} or q.status = 'draft')
        and not exists (
          select 1 from freight_destination_breaks b
          where b.freight_destination_id = d.id and b.tier_id = t.id
        )
      returning id`;
    console.log(`\ninserted ${inserted.length} break rows`);
  } else if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
  }
} finally {
  await sql.end();
}

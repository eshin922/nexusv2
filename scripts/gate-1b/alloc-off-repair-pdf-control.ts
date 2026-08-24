/**
 * Allocation-OFF repair — the CUSTOMER-FACING CONTROL.
 *
 * The repair's central claim is that it moves nothing the customer sees: same
 * lines, same amounts, same totals. That claim is only worth something if it is
 * captured from the code on BOTH sides of the change, so this dumps the
 * commercial projection for every affected quote to a JSON file that can be
 * diffed across the repair.
 *
 *     git stash            # remove the repair
 *     ...run, writing before.json
 *     git stash pop        # restore it
 *     ...run, writing after.json
 *     diff
 *
 * A structural argument — "the projection reads only fields the repair did not
 * change" — is how the double-count in the NetSuite cost basis nearly shipped.
 * The control is captured, not reasoned.
 *
 * Usage: node ... alloc-off-repair-pdf-control.ts <out.json>
 * Read-only apart from the named output file.
 */

import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveCustomerView } from "@/lib/customer-view-resolver";

const out = process.argv[2];
if (!out) {
  console.error("usage: alloc-off-repair-pdf-control.ts <out.json>");
  process.exit(2);
}

const quotes = (await db.execute(sql`
  select distinct q.id::text as quote_id, q.status
    from quotes q
    join assemblies a on a.quote_id = q.id
    join assembly_production_inputs api on api.assembly_id = a.id
   where api.allocate_service_fees_to_cost = false
   order by q.id::text
`)) as unknown as { quote_id: string; status: string }[];

const captured: Record<string, unknown> = {};

for (const q of quotes) {
  try {
    const res = await resolveCustomerView({ quoteId: q.quote_id });
    // `ResolveCustomerViewResult` is a discriminated union — the `not_found`
    // arm carries no projection. Narrowing on `ok` rather than reaching for
    // `?.commercial` keeps "the quote could not be resolved" distinguishable
    // from "the quote resolved and its projection was empty". Recording those
    // as the same thing is how a capture silently loses a quote.
    if (!res.ok) {
      captured[q.quote_id] = { status: q.status, unresolved: res.kind };
      continue;
    }
    const c = res.commercial;
    captured[q.quote_id] = {
      status: q.status,
      // Every number a customer can read off the document: the per-tier totals
      // and each line's per-tier cell. Labels included — a moved label is a
      // moved document even when the arithmetic holds.
      tiers: c.tiers.map((t) => ({
        tierId: t.tierId,
        label: t.tierLabel,
        quantity: t.quantity,
        unitSubtotal: t.unitSubtotal,
        otcSubtotal: t.otcSubtotal,
        total: t.tierCommercialTotal,
        provisional: t.isProvisional,
      })),
      // Every customer-visible string on the line, not just a name: display
      // copy is part of the document, and a moved sub-caption or quantity
      // label is a moved document even when the arithmetic holds.
      lines: c.lines.map((l) => ({
        key: l.key,
        kind: l.kind,
        displayName: l.displayName,
        displaySku: l.displaySku,
        displaySub: l.displaySub,
        displayQtyLabel: l.displayQtyLabel,
        cells: l.cells,
      })),
      productionMarkupPct: c.productionMarkupPct,
    };
  } catch (e) {
    captured[q.quote_id] = { status: q.status, error: String(e) };
  }
}

writeFileSync(out, JSON.stringify(captured, null, 2));
console.log(`captured ${quotes.length} quote(s) -> ${out}`);
process.exit(0);

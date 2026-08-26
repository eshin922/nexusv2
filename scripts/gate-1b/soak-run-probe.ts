/**
 * Soak walk verification probe. READ-ONLY.
 *
 * Reads the frozen state of one quote so a walk step can be verified against
 * the database rather than against a screenshot. Registered rather than
 * scratch: the cutover guard scans `scripts/`, and an unclassified temp file
 * fails it — correctly, which is how this file came to exist.
 *
 *   usage: soak-run-probe <quoteId>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
const Q = process.argv[2];
if (!Q) { console.error("usage: soak-run-probe <quoteId>"); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(8000);
console.log("quote:", JSON.stringify(await db.execute(sql`
  SELECT status, quote_number, version_number, customer_name_snapshot,
         netsuite_so_tranid, sent_at IS NOT NULL AS sent, accepted_at IS NOT NULL AS accepted
    FROM quotes WHERE id = ${Q}`)));
console.log("tier_totals:", JSON.stringify(await db.execute(sql`
  SELECT tt.tier_label, tt.quantity, tt.unit_subtotal, tt.otc_subtotal, tt.tier_commercial_total
    FROM quote_snapshot_tier_totals tt JOIN quote_snapshots s ON s.id = tt.quote_snapshot_id
   WHERE s.quote_id = ${Q} AND s.superseded_at IS NULL`)));
console.log("lines:", JSON.stringify(await db.execute(sql`
  SELECT sl.display_name, sl.line_kind, lt.unit_rate, lt.line_amount
    FROM quote_snapshot_lines sl JOIN quote_snapshots s ON s.id = sl.quote_snapshot_id
    JOIN quote_snapshot_line_tiers lt ON lt.quote_snapshot_line_id = sl.id
   WHERE s.quote_id = ${Q} AND s.superseded_at IS NULL ORDER BY sl.position`)));
process.exit(0);

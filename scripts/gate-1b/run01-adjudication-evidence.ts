// Run 1 adjudication evidence — three questions, one connection.
// Read-only. Writes nothing.
import { db } from "../../src/db/index.ts";
import { sql } from "drizzle-orm";

const out = (label: string, rows: unknown) =>
  console.log(`\n== ${label} ==\n` + JSON.stringify(rows, null, 2));

// ITEM 1 — does any HubSpot deal carry more than one Nexus-pushed Sales Order?
const dealSos = await db.execute(sql`
  SELECT p.hubspot_deal_id,
         count(*) FILTER (WHERE q.netsuite_so_id IS NOT NULL) AS pushed,
         count(*)                                             AS quotes
    FROM quotes q JOIN projects p ON p.id = q.project_id
   WHERE p.hubspot_deal_id IS NOT NULL
   GROUP BY p.hubspot_deal_id
  HAVING count(*) FILTER (WHERE q.netsuite_so_id IS NOT NULL) > 0
   ORDER BY pushed DESC, quotes DESC`);
out("item1 · deals with at least one pushed SO", dealSos);

const consumed = await db.execute(sql`
  SELECT count(*) AS accepted_on_consumed_deal
    FROM quotes q JOIN projects p ON p.id = q.project_id
   WHERE q.status = 'accepted' AND q.netsuite_so_id IS NULL
     AND EXISTS (SELECT 1 FROM quotes s JOIN projects sp ON sp.id = s.project_id
                  WHERE sp.hubspot_deal_id = p.hubspot_deal_id
                    AND s.id <> q.id AND s.netsuite_so_id IS NOT NULL)`);
out("item1 · accepted quotes standing on an already-consumed deal", consumed);

// ITEM 2 — how many attachments carry cost a Remove would cascade away?
const exposure = await db.execute(sql`
  SELECT count(DISTINCT ql.id) AS leaves_with_cost,
         count(DISTINCT ql.quote_id) AS quotes_affected,
         count(DISTINCT ql.id) FILTER (WHERE ql.assembly_id IS NULL) AS direct_with_cost
    FROM quote_leaves ql
    JOIN quotes q ON q.id = ql.quote_id
   WHERE q.status = 'draft'
     AND EXISTS (SELECT 1 FROM assembly_leaf_inputs i WHERE i.quote_leaf_id = ql.id)`);
out("item2 · draft attachments whose Remove would cascade cost away", exposure);

const moves = await db.execute(sql`
  SELECT action, count(*) FROM audit_log
   WHERE action IN ('product_membership_moved','quote_product_detach','quote_product_attach')
   GROUP BY action ORDER BY 2 DESC`);
out("item2 · governed move vs detach in the audit record", moves);

// ITEM 3 — elections, and whether copies carry them.
const elections = await db.execute(sql`
  SELECT count(*) AS election_rows, count(DISTINCT quote_id) AS quotes_with_elections
    FROM quote_charge_recovery`);
out("item3 · elections in the estate", elections);

const copies = await db.execute(sql`
  SELECT c.id AS copy_id, c.scenario_label,
         (SELECT count(*) FROM quote_charge_recovery r WHERE r.quote_id = c.copied_from_quote_id) AS source_elections,
         (SELECT count(*) FROM quote_charge_recovery r WHERE r.quote_id = c.id)                   AS copy_elections
    FROM quotes c
   WHERE c.copied_from_quote_id IS NOT NULL
   ORDER BY c.created_at DESC LIMIT 20`);
out("item3 · every copy, source elections vs copy elections", copies);

process.exit(0);

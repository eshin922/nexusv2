/**
 * Decision 3's condition — the FINAL full-history count for Tooling. READ ONLY.
 *
 * The disposition is "map Tooling to OTC-0005 unless a final full-history count
 * materially contradicts the evidence already gathered", so the count has to be
 * measured on a stated basis rather than repeated from the earlier probe.
 *
 * The earlier figure (23 vs 15) counted rows in `transactionline` across ALL
 * transaction types. That is one defensible basis, but not the only one — a
 * single Sales Order can carry the same item on several lines, and quotes,
 * purchase orders and invoices all live in the same table. So this reports
 * three bases side by side and says which one the mapping was decided on.
 *
 * If the bases disagree about which item leads, that IS the material
 * contradiction the disposition anticipates, and it goes back to Accounting.
 */
import { suiteQL } from "@/lib/netsuite/client";

const CANDIDATES = "4077, 54062"; // OTC-0005, OTC-0046

async function show(title: string, sql: string) {
  console.log(`\n── ${title} ──`);
  try {
    const r = await suiteQL<Record<string, unknown>>(sql);
    if (r.items.length === 0) {
      console.log(`no rows · READ SUCCEEDED · totalResults=${r.totalResults ?? "?"}`);
      return;
    }
    console.table(r.items);
    if (r.hasMore) console.log("… more rows exist; this is a page, not the set.");
  } catch (e) {
    console.log(
      "READ FAILED (indeterminate, NOT absence):",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// Control — both records exist and this shape reaches them.
await show(
  "CONTROL · both candidate item records",
  `SELECT id, itemid, displayname, itemtype, isinactive FROM item WHERE id IN (${CANDIDATES})`,
);

await show(
  "BASIS A · every transaction line, all transaction types (the earlier figure)",
  `SELECT tl.item, COUNT(*) AS lines,
          MIN(t.trandate) AS first_used, MAX(t.trandate) AS last_used
     FROM transactionline tl JOIN transaction t ON t.id = tl.transaction
    WHERE tl.item IN (${CANDIDATES})
    GROUP BY tl.item`,
);

await show(
  "BASIS B · distinct transactions, so one order carrying it twice counts once",
  `SELECT tl.item, COUNT(DISTINCT tl.transaction) AS transactions
     FROM transactionline tl
    WHERE tl.item IN (${CANDIDATES})
    GROUP BY tl.item`,
);

await show(
  "BASIS C · split by transaction type — is either item only used off the SO path?",
  // `t.type` is not selectable directly in SuiteQL here — it failed as an
  // unsupported search. `recordtype` is, and gives the same split.
  `SELECT tl.item, t.recordtype AS kind, COUNT(*) AS lines
     FROM transactionline tl JOIN transaction t ON t.id = tl.transaction
    WHERE tl.item IN (${CANDIDATES})
    GROUP BY tl.item, t.recordtype`,
);

await show(
  "RECENCY · last 12 months only, in case the lead has changed hands",
  `SELECT tl.item, COUNT(*) AS lines, MAX(t.trandate) AS last_used
     FROM transactionline tl JOIN transaction t ON t.id = tl.transaction
    WHERE tl.item IN (${CANDIDATES})
      AND t.trandate >= TO_DATE('2025-08-19', 'YYYY-MM-DD')
    GROUP BY tl.item`,
);

console.log(
  "\nRead the bases against each other. The mapping is written only if they " +
    "AGREE on which item leads; a disagreement is the material contradiction " +
    "the disposition anticipates and goes back to Accounting.",
);

process.exit(0);

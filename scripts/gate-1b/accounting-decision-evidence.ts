/**
 * Evidence for the five Accounting policy decisions — READ ONLY.
 *
 * These are Accounting's calls, not engineering's. What engineering can do is
 * make each one answerable from DPS's own history rather than from an opinion:
 * which item the firm actually uses, whether a cost basis is carried today,
 * what tax behaviour existing orders show.
 *
 * ── EVERY ABSENCE CLAIM NEEDS ITS OWN EVIDENCE ───────────────────────────
 *
 * Decision 4 asks Accounting to CREATE a NetSuite item, on the strength of a
 * claim that none exists. That claim has to be worth acting on, so the artwork
 * search below runs several independent terms and reports a control. A single
 * `LIKE '%ARTWORK%'` returning nothing is not evidence of absence — it is
 * evidence about one word (OD-027).
 *
 * Nothing here writes, maps, or creates anything.
 */
import { suiteQL } from "@/lib/netsuite/client";

type Row = Record<string, unknown>;

async function q(title: string, sql: string): Promise<Row[]> {
  console.log(`\n── ${title} ──`);
  try {
    const r = await suiteQL<Row>(sql);
    if (r.items.length === 0) {
      console.log(`no rows · READ SUCCEEDED · totalResults=${r.totalResults ?? "?"}`);
      return [];
    }
    console.table(r.items);
    if (r.hasMore) console.log("… more rows exist; this is a page, not the set.");
    return r.items;
  } catch (e) {
    console.log(
      "READ FAILED (indeterminate, NOT absence):",
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}

console.log("=".repeat(70));
console.log("DECISION 1 · cost basis carried on fee / service lines today");
console.log("=".repeat(70));
console.log(
  "SO2716 shows costestimatetype LASTPURCHPRICE / rate 2500 on a $5,600 service\n" +
    "line, because Nexus sends no unitCost for a fee. What do the firm's OWN\n" +
    "historical orders carry on the same items?",
);
await q(
  "historical lines on the mapped fee items (59157 Formulation, 26348 Setup, 14525 Filling)",
  `SELECT tl.item, COUNT(*) AS lines,
          MIN(tl.costestimaterate) AS min_cost, MAX(tl.costestimaterate) AS max_cost,
          MIN(tl.costestimatetype) AS a_type, MAX(tl.costestimatetype) AS b_type
     FROM transactionline tl
    WHERE tl.item IN (59157, 26348, 14525)
    GROUP BY tl.item`,
);
await q(
  "how OTC-coded fee lines are costed across the whole account",
  `SELECT tl.costestimatetype, COUNT(*) AS lines
     FROM transactionline tl JOIN item i ON i.id = tl.item
    WHERE UPPER(i.itemid) LIKE 'OTC-%'
    GROUP BY tl.costestimatetype`,
);

console.log("\n" + "=".repeat(70));
console.log("DECISION 2 · tax behaviour on existing Sales Orders");
console.log("=".repeat(70));
await q(
  "SO2716's own tax line",
  `SELECT tl.id, tl.item, tl.rate, tl.netamount, tl.taxline
     FROM transactionline tl
    WHERE tl.transaction = 362441 AND tl.taxline = 'T'`,
);
await q(
  "do recent Sales Orders carry an explicit taxcode, or derive it?",
  `SELECT t.tranid, t.trandate, COUNT(tl.id) AS taxlines
     FROM transaction t JOIN transactionline tl ON tl.transaction = t.id
    WHERE t.type = 'SalesOrd' AND tl.taxline = 'T'
    GROUP BY t.tranid, t.trandate
    ORDER BY t.trandate DESC`,
);

console.log("\n" + "=".repeat(70));
console.log("DECISION 3 · which item governs otc_tooling");
console.log("=".repeat(70));
await q(
  "the two identically-named candidates, with usage and date range",
  `SELECT tl.item, COUNT(*) AS lines,
          MIN(t.trandate) AS first_used, MAX(t.trandate) AS last_used
     FROM transactionline tl JOIN transaction t ON t.id = tl.transaction
    WHERE tl.item IN (4077, 54062)
    GROUP BY tl.item`,
);
await q(
  "their item records side by side",
  `SELECT id, itemid, displayname, itemtype, isinactive, description
     FROM item WHERE id IN (4077, 54062)`,
);

console.log("\n" + "=".repeat(70));
console.log("DECISION 4 · does ANY artwork fee item exist?");
console.log("=".repeat(70));
console.log(
  "An absence claim strong enough to justify creating a record needs more than\n" +
    "one search term. Control first, then five independent terms.",
);
await q(
  "CONTROL · OTC-coded items exist and this query shape finds them",
  `SELECT COUNT(*) AS otc_items FROM item WHERE UPPER(itemid) LIKE 'OTC-%'`,
);
for (const term of ["ARTWORK", "ART ", "DESIGN", "PROOF", "PREPRESS", "GRAPHIC"]) {
  await q(
    `artwork probe · "${term}"`,
    `SELECT id, itemid, displayname, itemtype FROM item
      WHERE (UPPER(itemid) LIKE '%${term}%' OR UPPER(displayname) LIKE '%${term}%')
        AND (isinactive = 'F' OR isinactive IS NULL)`,
  );
}

console.log("\n" + "=".repeat(70));
console.log("DECISION 5 · firm-wide vs per-line for multi-candidate destinations");
console.log("=".repeat(70));
console.log(
  "If the several items under one destination are all genuinely USED, a single\n" +
    "firm-wide mapping forces a choice that loses information. If only one is\n" +
    "used, the others are legacy and a firm-wide mapping is fine.",
);
for (const [dest, ids] of [
  ["otc_testing", "11000, 15323, 36681, 73855, 73549"],
  ["otc_dies", "4081, 4075, 4074, 4072, 18062"],
  ["otc_samples", "7792, 15622, 24650, 24651, 48654"],
  ["otc_cartons", "72636, 72637"],
  ["otc_print_plates", "4078, 38450"],
] as const) {
  await q(
    `${dest} · usage per candidate`,
    `SELECT i.itemid, i.displayname, COUNT(tl.id) AS lines,
            MIN(t.trandate) AS first_used, MAX(t.trandate) AS last_used
       FROM item i
       LEFT JOIN transactionline tl ON tl.item = i.id
       LEFT JOIN transaction t ON t.id = tl.transaction
      WHERE i.id IN (${ids})
      GROUP BY i.itemid, i.displayname
      ORDER BY lines DESC`,
  );
}

process.exit(0);

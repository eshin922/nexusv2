/**
 * Candidate NetSuite items for the two unmapped BV-011 destinations — READ ONLY.
 *
 * `OTC - Setup` and `OTC - Formulation` are both declared Non-inventory by
 * BV-011, so the mapping must land on a record whose type matches what the
 * destination MEANS. Picking by name alone is how a fee ends up on an
 * inventory part and NetSuite starts tracking stock for a service charge.
 *
 * SuiteQL only. No record is created, patched or mapped here — the output is a
 * shortlist for a human decision.
 *
 * ── TWO INSTRUMENT FAULTS THIS ALREADY CAUGHT ────────────────────────────
 *
 * The first draft treated `suiteQL`'s `{ items, hasMore }` envelope as a bare
 * array, so EVERY query printed "(none)" — including the control row, which is
 * known to exist. It also swallowed errors into the same "(none)", so a failed
 * read was indistinguishable from an empty catalog (OD-027).
 *
 * Both are fixed below, and the control query stays: a probe that cannot find
 * a row it is known to be able to find is measuring nothing, and the only way
 * to notice is to ask it for something whose answer you already know.
 */
import { suiteQL } from "@/lib/netsuite/client";

const LIKE = process.argv[2] ?? null;

type Row = {
  id: string;
  itemid: string;
  displayname: string | null;
  itemtype: string | null;
  isinactive: string | null;
};

/**
 * A read that FAILED and a read that found nothing are different answers, and
 * collapsing them is how "(none)" gets reported as evidence of absence.
 * Errors are surfaced as INDETERMINATE; absence is stated only when the read
 * demonstrably succeeded.
 */
async function show(title: string, sql: string) {
  console.log(`\n── ${title} ──────────────────────────────────`);
  let res;
  try {
    res = await suiteQL<Row>(sql);
  } catch (e) {
    console.log(
      "READ FAILED (indeterminate, NOT absence):",
      e instanceof Error ? e.message : String(e),
    );
    return;
  }
  const rows = res.items;
  if (rows.length === 0) {
    console.log(`no rows · read succeeded · totalResults=${res.totalResults ?? "?"}`);
    return;
  }
  console.table(
    rows.map((r) => ({
      id: r.id,
      itemid: r.itemid,
      name: (r.displayname ?? "").slice(0, 40),
      type: r.itemtype,
      inactive: r.isinactive,
    })),
  );
  if (res.hasMore) console.log("… more rows exist; this is a page, not the set.");
}

// The control. If this comes back empty the query shape is wrong, not the
// catalog — item 14525 is the live `OTC - Filling` / `BLD-FILL` mapping.
await show(
  "CONTROL · the already-mapped OTC - Filling item (internal id 14525)",
  `SELECT id, itemid, displayname, itemtype, isinactive FROM item WHERE id = 14525`,
);

await show(
  "Items whose code or name mentions SETUP",
  `SELECT id, itemid, displayname, itemtype, isinactive FROM item
    WHERE (UPPER(itemid) LIKE '%SETUP%' OR UPPER(displayname) LIKE '%SETUP%')`,
);

await show(
  "Items whose code or name mentions FORMULATION / RND",
  `SELECT id, itemid, displayname, itemtype, isinactive FROM item
    WHERE (UPPER(itemid) LIKE '%FORMUL%' OR UPPER(displayname) LIKE '%FORMUL%'
        OR UPPER(itemid) LIKE '%RND%'    OR UPPER(displayname) LIKE '%R&D%')`,
);

await show(
  "The eligible pool · active non-inventory / other-charge / service items",
  `SELECT id, itemid, displayname, itemtype, isinactive FROM item
    WHERE itemtype IN ('NonInvtPart', 'OthCharge', 'Service')
      AND (isinactive = 'F' OR isinactive IS NULL)`,
);

await show(
  "What item types this account actually uses",
  `SELECT itemtype AS id, itemtype AS itemid, COUNT(*) AS displayname,
          itemtype, MIN(isinactive) AS isinactive
     FROM item GROUP BY itemtype`,
);

if (LIKE) {
  await show(
    `Free-text probe · %${LIKE}%`,
    `SELECT id, itemid, displayname, itemtype, isinactive FROM item
      WHERE (UPPER(itemid) LIKE '%${LIKE.toUpperCase()}%'
          OR UPPER(displayname) LIKE '%${LIKE.toUpperCase()}%')`,
  );
}

process.exit(0);

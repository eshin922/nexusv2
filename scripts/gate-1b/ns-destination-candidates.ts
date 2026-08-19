/**
 * NetSuite item candidates for each UNMAPPED BV-011 destination — READ ONLY.
 *
 * Accounting has to choose one item per destination. This narrows the catalog
 * to a shortlist per destination; it does not choose, and it maps nothing.
 *
 * ── READ THE OUTPUT CAREFULLY, IT LIES BY SUBSTRING ──────────────────────
 *
 * The search is `LIKE '%TERM%'` over itemid and displayname, so it matches
 * inside words. A real example from the first run: searching RAW for
 * `otc_raws` returned "OTC - Ink Drawdowns", because D-`raw`-downs contains
 * the term. It is not a raws candidate.
 *
 * So the OTC-coded subset is printed separately — DPS's fee items are coded
 * `OTC-NNNN`, and a candidate that is not OTC-coded is almost always a
 * substring accident rather than a fee item. Treat the non-OTC rows as noise
 * unless a human recognises one.
 *
 * ── THE CONTROL IS LOAD-BEARING ──────────────────────────────────────────
 *
 * A query shape that silently returns nothing looks exactly like an empty
 * catalog. The control asks for something known to exist through the SAME
 * shape; if it returns zero, every "no candidates" below is meaningless.
 */
import { suiteQL } from "@/lib/netsuite/client";

/** destination -> the search term most likely to surface its fee item. */
const DESTINATIONS: Array<[string, string]> = [
  ["otc_tooling", "TOOL"],
  ["otc_artwork", "ARTWORK"],
  ["otc_freight_duties_tariffs", "FREIGHT"],
  ["otc_customs", "CUSTOM"],
  ["otc_packout", "PACKOUT"],
  ["otc_raws", "RAW"],
  ["otc_testing", "TEST"],
  ["otc_dies", "DIE"],
  ["otc_print_plates", "PLATE"],
  ["otc_samples", "SAMPLE"],
  ["otc_processing_fee", "PROCESSING"],
  ["otc_cartons", "CARTON"],
];

type Row = {
  id: string;
  itemid: string;
  displayname: string | null;
  itemtype: string | null;
};

const control = await suiteQL<Row>(
  `SELECT id, itemid, displayname, itemtype FROM item WHERE UPPER(itemid) LIKE '%OTC-00%'`,
);
console.log(
  `CONTROL · 'OTC-00' returned ${control.items.length} rows` +
    (control.items.length === 0
      ? "  ← ZERO. The query shape is broken; ignore everything below."
      : "  ← non-zero, so the shape works and absences below are real."),
);

for (const [destination, term] of DESTINATIONS) {
  try {
    const r = await suiteQL<Row>(
      `SELECT id, itemid, displayname, itemtype, isinactive FROM item
        WHERE (UPPER(itemid) LIKE '%${term}%' OR UPPER(displayname) LIKE '%${term}%')
          AND (isinactive = 'F' OR isinactive IS NULL)
          AND itemtype IN ('NonInvtPart','OthCharge','Service','InvtPart')`,
    );
    const otcCoded = r.items.filter((x) =>
      String(x.itemid ?? "").toUpperCase().startsWith("OTC-"),
    );
    console.log(
      `\n${destination}  (term "${term}")  ${r.items.length} match(es), ${otcCoded.length} OTC-coded`,
    );
    if (otcCoded.length === 0) {
      console.log("   NO OTC-coded candidate — Accounting must name or create the item.");
    }
    for (const x of (otcCoded.length ? otcCoded : r.items).slice(0, 6)) {
      console.log(
        `   ${String(x.itemid).padEnd(22)} ${String(x.itemtype).padEnd(12)} ` +
          `${String(x.displayname ?? "").slice(0, 40)}   id=${x.id}`,
      );
    }
    if (otcCoded.length > 1)
      console.log("   ^ AMBIGUOUS — more than one fee item; Accounting chooses.");
  } catch (e) {
    console.log(
      `\n${destination}  READ FAILED (indeterminate, NOT absence):`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

process.exit(0);

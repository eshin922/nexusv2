/**
 * O5 · specifications are NOT an accounting or item-resolution authority.
 *
 * ── WHY THIS NEEDS PROVING AT ALL ───────────────────────────────────────
 *
 * A specification is a customer-facing commercial statement. It is the kind of
 * data that looks usable: `tp_units_per_case` is a number, it is true, and it
 * relates to quantity. The failure this guards against is not someone deciding
 * to make specs authoritative — it is a spec value quietly acquiring a second
 * job because it happened to be in scope and happened to fit.
 *
 * O5 is the first order that carries specifications at all, so it is the first
 * one where the question can be asked with real data on both sides.
 *
 * ── WHAT WOULD COUNT AS THE FAILURE ─────────────────────────────────────
 *
 * Three distinct ways a spec could become an authority, checked separately
 * because they fail separately:
 *
 *   ACCOUNTING     a spec value appears as a rate, amount, quantity or cost,
 *                  or is used to derive one (24 units/case turning 6,000
 *                  units into 250 cases would be the obvious form)
 *   ITEM RESOLUTION a spec value selects or influences which NetSuite item a
 *                  line resolves to
 *   LEAKAGE        a spec value or key reaches the ERP payload at all, in a
 *                  description, memo or custom field nobody intended
 *
 * ── THE INSTRUMENT, AND ITS LIMIT ───────────────────────────────────────
 *
 * This scans the FULL projection payload for every frozen spec value and key.
 * Absence is the finding. So the scan must be able to express presence, or it
 * proves nothing (the lesson from the grep that could not match a numeric
 * difference) — which is why it runs a POSITIVE CONTROL first: it searches the
 * same payload for a string that is definitely in it. If the control fails to
 * find what is certainly there, the scan is broken and the run is INDETERMINATE
 * rather than a pass.
 */
import { loadSalesOrderPreview } from "@/lib/netsuite/planned-sales-order-preview";
import { readOrderPacket } from "@/lib/order-packet/reader";
import { O5_EXPECTED_ALL } from "./o5-spec-verify.ts";
import { O5_LEAVES, O5_NUMERIC_FIELD, O5_TP_SPEC } from "./o5-expected.ts";

const QUOTE_ID = "081532d7-89c0-4708-bbd2-160130680009";
const SNAPSHOT_ID = "1b419a5b-8dc0-4a75-a99c-670d6a159f27";

const preview = await loadSalesOrderPreview(QUOTE_ID);
if (preview.status !== "ok") {
  console.log(`INDETERMINATE - preview status ${preview.status}; nothing to scan.`);
  process.exit(2);
}
const payload = JSON.stringify(preview.planned);

// ── POSITIVE CONTROL ────────────────────────────────────────────────────
// If the scan cannot find a string that is certainly present, every "absent"
// below is meaningless. SKUs are in the payload by construction.
const control = O5_LEAVES.TP.sku;
if (!payload.includes(control)) {
  console.log(`INDETERMINATE - positive control ${control} not found in the payload.`);
  console.log("The scan cannot express presence, so it cannot establish absence.");
  process.exit(2);
}
console.log(`positive control      "${control}" found - the scan can see the payload`);
console.log(`payload size          ${payload.length} chars`);

let failures = 0;

/**
 * Whole-token match for SHORT values.
 *
 * Escapes regex metacharacters, then requires a non-alphanumeric neighbour on
 * each side. A leak into a description ("24 units per case") still matches; two
 * digits inside a UUID do not.
 */
function boundedMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
  return new RegExp("(^|[^A-Za-z0-9])" + escaped + "([^A-Za-z0-9]|$)").test(haystack);
}

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────
//
// The positive control proves the scan can see the payload. It does NOT prove
// the bounded matcher can still catch a leak after being narrowed to stop
// matching UUID interiors — narrowing a filter until it stops reporting is
// exactly how a control becomes decorative. So: inject the short spec value as
// a real JSON value and as prose, and require BOTH to be caught.
{
  const short = O5_TP_SPEC[O5_NUMERIC_FIELD];
  const asValue = payload.replace(/"quantity":6000/, `"quantity":${short}`);
  const asProse = payload.replace(/"description":"/, `"description":"${short} units per case `);
  const uuidOnly = payload; // the real payload, whose only "24" is inside a UUID
  const caught = boundedMatch(asValue, short) && boundedMatch(asProse, short);
  const quiet = !boundedMatch(uuidOnly, short);
  console.log(`negative control      leak-as-value + leak-as-prose ${caught ? "both caught" : "NOT CAUGHT"}; UUID-only payload ${quiet ? "correctly quiet" : "still flagged"}`);
  if (!caught || !quiet) {
    console.log("INDETERMINATE - the matcher cannot both catch a leak and ignore a UUID.");
    process.exit(2);
  }
}
console.log("");

// ── 1 · LEAKAGE ─────────────────────────────────────────────────────────
const valueHits: string[] = [];
const keyHits: string[] = [];
for (const [key, value] of Object.entries(O5_EXPECTED_ALL)) {
  if (payload.includes(key)) keyHits.push(key);
  // Blanks are the empty string; `includes("")` is always true, and treating
  // that as a hit would fail every run for the wrong reason.
  //
  // SHORT VALUES NEED A BOUNDARY. `tp_units_per_case` is "24", and a raw
  // substring scan matched it inside the UUID `...aaa1-242362996f39` -- a
  // snapshot line id, not a leak. A scan that cannot tell a value from two
  // digits of a UUID reports a leak that is not there, which is the same
  // instrument failure as one that misses a leak that is. Long values cannot
  // collide, so they stay a plain substring test; short ones are matched on
  // word boundaries, which still finds a genuine leak (a spec inside a
  // description reads as a whole token) while ignoring UUID interiors.
  if (value === "") continue;
  const found = value.length >= 8 ? payload.includes(value) : boundedMatch(payload, value);
  if (found) valueHits.push(key);
}
console.log(`spec VALUES in the ERP projection   ${valueHits.length === 0 ? "none" : "FOUND: " + valueHits.join(", ")}`);
console.log(`spec KEYS in the ERP projection     ${keyHits.length === 0 ? "none" : "FOUND: " + keyHits.join(", ")}`);
if (valueHits.length || keyHits.length) failures++;

// ── 2 · ACCOUNTING ──────────────────────────────────────────────────────
//
// The specific arithmetic that would betray `tp_units_per_case` as an
// authority: 6,000 units at 24 per case is 250 cases. If 250 appears as a
// quantity anywhere, the spec moved money.
const unitsPerCase = Number(O5_TP_SPEC[O5_NUMERIC_FIELD]);
const tierQty = preview.planned.tierQty;
if (tierQty === null || tierQty === undefined) {
  // Not a pass. Without a tier quantity there is no arithmetic to check, so
  // the accounting dimension cannot be established either way.
  console.log("INDETERMINATE - no tier quantity on the plan; accounting dimension unverifiable.");
  process.exit(2);
}
const derivedCases = tierQty / unitsPerCase;
const lines = [
  ...(preview.planned.lines ?? []),
  ...(preview.planned.directLines ?? []),
  ...(preview.planned.accountingLines ?? []),
] as { sku?: string; quantity?: number; rate?: number; unitCost?: number }[];

const quantities = lines.map((l) => l.quantity);
const badQty = quantities.filter((q) => q === derivedCases);
console.log(`\ntier quantity                       ${tierQty}`);
console.log(`${O5_NUMERIC_FIELD} (spec)               ${unitsPerCase}`);
console.log(`cases IF the spec were authoritative ${derivedCases}`);
console.log(`line quantities actually projected  ${JSON.stringify(quantities)}`);
if (badQty.length) {
  console.log(`  FAIL - ${badQty.length} line(s) carry the spec-derived case count`);
  failures++;
} else {
  console.log(`  every line carries the tier quantity; the spec divided nothing`);
}

// No rate or cost may equal a spec-derived figure either.
const numericSpecValues = new Set(
  Object.values(O5_EXPECTED_ALL)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n !== 0),
);
const rateHits = lines.filter(
  (l) => numericSpecValues.has(Number(l.rate)) || numericSpecValues.has(Number(l.unitCost)),
);
console.log(`rates/costs equal to a spec number  ${rateHits.length === 0 ? "none" : "FOUND " + rateHits.length}`);
if (rateHits.length) failures++;

// ── 3 · ITEM RESOLUTION ─────────────────────────────────────────────────
//
// Each line's NetSuite item must be the one mapped to that LEAF, independent
// of anything the leaf's specification says.
console.log(`\nitem resolution - each line against its leaf's own mapping:`);
const expectedItem: Record<string, string> = {
  [O5_LEAVES.PP.sku]: O5_LEAVES.PP.netsuiteInternalId,
  [O5_LEAVES.SP.sku]: O5_LEAVES.SP.netsuiteInternalId,
  [O5_LEAVES.TP.sku]: O5_LEAVES.TP.netsuiteInternalId,
};
for (const l of preview.planned.lines ?? []) {
  const want = expectedItem[l.sku];
  const ok = String(l.netsuiteItemId) === want;
  if (!ok) failures++;
  console.log(`  ${l.sku.padEnd(20)} item ${l.netsuiteItemId} expected ${want}  ${ok ? "resolved from the leaf" : "MISMATCH"}`);
}

// ── 4 · AND THE SPECS DO STILL EXIST ────────────────────────────────────
//
// The negative result above is only meaningful if the specifications were
// actually present on this order. An order with no specs would pass every
// check above trivially, which is the same class of vacuous pass as a filter
// that cannot match.
const packet = await readOrderPacket(SNAPSHOT_ID);
if (packet === null) {
  console.log("INDETERMINATE - order packet did not resolve; cannot confirm specs exist on this order.");
  process.exit(2);
}
const specCount = packet.items.reduce((n, it) => n + Object.keys(it.spec?.values ?? {}).length, 0);
console.log(`\nspecifications frozen on this order ${specCount} values across ${packet.items.length} items`);
if (specCount === 0) {
  console.log("  INDETERMINATE - no specs on the order; the absence above proves nothing.");
  process.exit(2);
}

console.log(
  `\n${failures === 0 ? "PASS - specifications are carried, and are authority for nothing in the ERP projection" : `FAIL - ${failures} dimension(s) show specification influence`}`,
);
process.exit(failures === 0 ? 0 : 1);

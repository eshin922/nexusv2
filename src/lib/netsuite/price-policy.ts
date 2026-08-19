/**
 * Governed price-level policy — a Nexus-priced line is CUSTOM, never Base Price.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 *
 * Nexus supplies the accepted commercial rate. It does not select a NetSuite
 * item-master base price, and the two claims are different: a line labelled
 * "Base Price" says the number came from the item record, when it came from a
 * quote the customer accepted.
 *
 * Nexus never set `price`, so NetSuite filled it — every line on SO2716,
 * SO2717 and SO2718 posted as price level 1 "Base Price" while carrying a rate
 * Nexus supplied. The amounts were always right; only the provenance the label
 * asserts was wrong.
 *
 * ── MEASURED, NOT ASSUMED ────────────────────────────────────────────────
 *
 * `-1` is NetSuite's Custom sentinel. Its `refName` comes back EMPTY and the
 * `pricelevel` record is not SuiteQL-queryable in this account (a failed read,
 * not an empty catalog), so it is identified by behaviour rather than by label:
 * it is accepted, it persists, and it is not level 1.
 *
 * Two probes, both against the sandbox:
 *
 *   CREATE  (SO2720, disposable, no deal id — outside the duplicate-deal rule)
 *           7 × 123.45 with price -1  →  accepted
 *           price level -1 · rate 123.45 · qty 7 · amount 864.15 · tax 0
 *
 *   PATCH   (SO2715 member line, with SO2714 as untouched control)
 *           { price: -1 }              →  REFUSED, "Please enter a value for Amount"
 *           { price: -1, rate: … }     →  accepted
 *           rate, amount and BOTH order totals byte-identical afterwards
 *
 * ── THE RULE THE REFUSAL IMPLIES ─────────────────────────────────────────
 *
 * Never send a price level without the governed rate. NetSuite refuses it
 * outright today, so this is currently belt-and-braces — but a future version
 * that accepted it would be free to source the rate itself, which is the exact
 * outcome setting Custom exists to prevent. `patchSalesOrderLine` enforces it.
 *
 * ── WHERE IT APPLIES ─────────────────────────────────────────────────────
 *
 *   flat lines at CREATE   — products, Direct Services, OTC charges
 *   Item Group MEMBERS     — on the existing rate PATCH, alongside the rate
 *
 * NOT the Item Group HEADER or EndGroup. Neither carries a rate: the header's
 * price is ignored in favour of the members NetSuite expands beneath it, so a
 * price level there would assert provenance for a number that does not exist.
 */

/**
 * NetSuite's "Custom" price level.
 *
 * A string because every other NetSuite reference id in this codebase is one,
 * and the REST API accepts `{ id: "-1" }`.
 */
export const CUSTOM_PRICE_LEVEL_ID = "-1";

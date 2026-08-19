/**
 * Does a quote carry something to sell? The SEND structural gate.
 *
 * A LEAF MODULE on purpose: no database, no imports at all — the same reason
 * `frozen-cents.ts` is one. `quote-guards.ts` pulls in `@/db`, which a unit
 * test cannot load, so a predicate living there can only ever be grepped for
 * rather than exercised. This one is called with the five governed shapes.
 */
/**
 * The rule.
 *
 * ── WHAT THIS REPLACED, AND WHY IT WAS WRONG ─────────────────────────────
 *
 * The gate counted rows in `assemblies` — the Item Group table — while
 * refusing with "Quote needs at least one SKU". The message said SKU; the
 * query said Item Group. SKUs live in `quote_leaves`, so any quote whose
 * structure carried no Item Group was refused however many products or
 * services it held:
 *
 *   Direct Product only    leaves >= 1, assemblies 0   wrongly REFUSED
 *   Direct Service only    leaves >= 1, assemblies 0   wrongly REFUSED
 *
 * Both are governed V1 cases. It never surfaced because every quote certified
 * so far carries an Item Group.
 *
 * ── WHY A BARE LEAF COUNT IS THE RIGHT PREDICATE ─────────────────────────
 *
 * Verified against the live population before the change: `quote_leaves` holds
 * only `product` (175 rows) and `service` (4) — every row is a sendable
 * commercial line, so counting them needs no filter. A third `commercial_kind`
 * would change that, which is why the population check is kept as
 * `scripts/gate-1b/send-predicate-population.ts` rather than discarded.
 *
 * ── THE EDGE THIS DELIBERATELY REFUSES ───────────────────────────────────
 *
 * An Item Group carrying NO members has `assemblies > 0` and
 * `quote_leaves = 0`. It used to send and now does not — correctly: nothing is
 * being sold, which is the "empty quote" the gate exists to refuse. Four such
 * groups exist (all `TEST-LFC5-ASY`), and none sits on a quote that would
 * change verdict, so no live quote loses sendability.
 */
export function hasSendableCommercialStructure(counts: {
  /** Rows in `quote_leaves` — every product and service, grouped or top-level. */
  commercialLines: number;
}): boolean {
  return counts.commercialLines > 0;
}

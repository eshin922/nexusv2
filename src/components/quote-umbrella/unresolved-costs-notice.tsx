import type { UnresolvedQuoteCost } from "@/lib/quote-cost-completeness-contract";

/**
 * Why Send is unavailable, as a work list.
 *
 * The cost guard has always been authoritative and correct. What was wrong is
 * that its refusal only existed at the moment of sending, as a thrown
 * exception — so the operator learned about it by pressing a button and
 * receiving a server error. This states the same refusal before the gesture,
 * in terms of what to go and fix.
 *
 * NO INTERNAL IDENTITY. The raw exception concatenates every attachment, line
 * and tier UUID; none of that reaches the page. Product, tier and the missing
 * action are what an operator can act on.
 */

/** Rows for one product, collapsed to the distinct actions per tier. */
type Grouped = { product: string; sku: string | null; tiers: Map<string, Set<string>> };

/**
 * `description` is the only machine-readable statement of WHAT is missing that
 * the payload carries — there is no category or reason field on
 * `UnresolvedQuoteCost`. Freight and customs rows populate it; packaging rows
 * do not.
 *
 * For those, the fallback is deliberately neutral. Inferring a category from
 * the product name would be a guess presented as fact, and the operator would
 * act on it. "Cost unresolved" is less useful and true.
 *
 * Enriching the payload so packaging rows can name their own missing field is
 * worth doing, but it belongs to the costing layer, not to this repair.
 */
const FALLBACK = "Cost unresolved";

function groupRows(rows: ReadonlyArray<UnresolvedQuoteCost>): Grouped[] {
  const byProduct = new Map<string, Grouped>();
  for (const row of rows) {
    const key = `${row.leafName}|${row.leafSku ?? ""}`;
    let g = byProduct.get(key);
    if (!g) {
      g = { product: row.leafName, sku: row.leafSku, tiers: new Map() };
      byProduct.set(key, g);
    }
    const actions = g.tiers.get(row.tierLabel) ?? new Set<string>();
    // The description already names product and tier; strip that prefix so the
    // row does not repeat what its own grouping just said.
    const action = row.description
      ? row.description.replace(/^.*?:\s*/, "").trim() || FALLBACK
      : FALLBACK;
    actions.add(action);
    g.tiers.set(row.tierLabel, actions);
  }
  return [...byProduct.values()];
}

export function UnresolvedCostsNotice({
  unresolved,
}: {
  unresolved: ReadonlyArray<UnresolvedQuoteCost>;
}) {
  if (unresolved.length === 0) return null;
  const grouped = groupRows(unresolved);

  return (
    <div className="r8-unresolved" role="status">
      <div className="r8-unresolved-head">
        <strong>Resolve costs before sending.</strong>
        <span className="r8-unresolved-count">
          {grouped.length} {grouped.length === 1 ? "product" : "products"}
        </span>
      </div>
      <ul className="r8-unresolved-list">
        {grouped.map((g) => (
          <li key={`${g.product}-${g.sku ?? ""}`}>
            <span className="r8-unresolved-product">
              {g.product}
              {g.sku ? <span className="r8-unresolved-sku"> · {g.sku}</span> : null}
            </span>
            <ul className="r8-unresolved-tiers">
              {[...g.tiers.entries()].map(([tier, actions]) => (
                <li key={tier}>
                  <span className="r8-unresolved-tier">{tier}</span>
                  <span className="r8-unresolved-action">
                    {[...actions].join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

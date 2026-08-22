/**
 * Which part of the cost model raised the row.
 *
 * DECLARED BY THE PRODUCER, never inferred by a reader. `loadUnresolvedQuoteCosts`
 * builds three separate arrays and so knows each row's origin with certainty;
 * without this field that certainty was thrown away at the return statement and
 * every consumer had to reconstruct it.
 *
 * WHY A FIELD AND NOT A NULL-PATTERN. `quoteLeafId === null && assemblyLeafId
 * !== null` does select exactly the freight rows on today's data (35/35, zero
 * collisions across 89 quotes). It is still the wrong thing to read, for two
 * reasons that outlive the current data:
 *
 *   1. `assemblyLeafId` is OVERLOADED — it holds an `assembly_leaves.id` for a
 *      packaging row and a `freight_subcategories.id` for a freight row, two
 *      different tables in one nullable column. The pattern works only because
 *      the OTHER field happens to be null, not because the field means freight.
 *
 *   2. The failure is plausible and SILENT. `freight_subcategory_items.
 *      quote_leaf_id` is NOT NULL — every freight membership already has a
 *      governed commercial leaf (OD-017/Pattern 58). The day a freight row
 *      carries it, so that the operator can be told WHICH product's shipment is
 *      short an amount, every freight row moves into the packaging pattern.
 *      Nothing throws. Freight work simply stops reaching Logistics.
 *
 * REQUIRED, deliberately: a producer cannot emit a row without saying where it
 * came from.
 */
export type UnresolvedCostSource = "configuration" | "packaging" | "freight";

export type UnresolvedQuoteCost = {
  source: UnresolvedCostSource;
  quoteLeafId: string | null;
  /** Legacy junction id, or a freight container id. NULL for a Direct Component. */
  assemblyLeafId: string | null;
  tierId: string;
  tierLabel: string;
  lineGroupId: string;
  leafSku: string | null;
  leafName: string;
  description?: string;
};

export class UnresolvedQuoteCostsError extends Error {
  readonly unresolved: ReadonlyArray<UnresolvedQuoteCost>;

  constructor(unresolved: ReadonlyArray<UnresolvedQuoteCost>) {
    const details = unresolved.map((row) => {
      const attachmentId = row.quoteLeafId ?? row.assemblyLeafId ?? row.lineGroupId;
      if (row.description) return row.description;
      return `${row.leafName} (${row.leafSku ?? "no SKU"}) — attachment ${attachmentId}, tier ${row.tierLabel} (${row.tierId}), line ${row.lineGroupId}`;
    });
    super(
      `Cannot send this Quote with unresolved costs: ${details.join("; ")}. Enter every missing cost and try again.`,
    );
    this.name = "UnresolvedQuoteCostsError";
    this.unresolved = unresolved;
  }
}

export function assertQuoteCostsResolved(
  unresolved: ReadonlyArray<UnresolvedQuoteCost>,
): void {
  if (unresolved.length > 0) {
    throw new UnresolvedQuoteCostsError(unresolved);
  }
}

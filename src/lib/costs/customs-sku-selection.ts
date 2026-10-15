/**
 * A complete set of SKU amounts replaces the pooled legacy amount as one
 * pricing transition. Partial entry must not make an existing quote lose cost.
 */
export function selectCustomsMemberCharge<T extends { quoteLeafId: string | null; amount: string | number | null; markupPct?: string | number | null }>(
  rows: readonly T[],
  memberId: string,
  memberIds: readonly string[],
): { row: T | undefined; perSku: boolean } {
  const perSku = memberIds.length > 0 && memberIds.every((id) => rows.some((row) => row.quoteLeafId === id && row.amount != null && row.markupPct != null));
  return { row: rows.find((row) => perSku ? row.quoteLeafId === memberId : row.quoteLeafId == null), perSku };
}

/** Return only costs for SKUs currently selected in this shipment. */
export function activeCustomsChargeRows<T extends { quoteLeafId: string | null; amount: string | number | null; markupPct?: string | number | null }>(
  rows: readonly T[], memberIds: readonly string[],
): T[] {
  const selected = rows.filter((row) => row.quoteLeafId != null && memberIds.includes(row.quoteLeafId));
  const complete = memberIds.length > 0 && memberIds.every((id) => selected.some((row) => row.quoteLeafId === id && row.amount != null && row.markupPct != null));
  return complete ? selected : rows.filter((row) => row.quoteLeafId == null);
}

/** Keep the customer's priced Item Group members together without changing their economics. */
export function orderCustomerItemGroupRows<T extends { id?: string; itemGroup?: { id: string } | null }>(
  rows: readonly T[],
  directServiceIds: ReadonlySet<string> = new Set(),
): T[] {
  const byGroup = new Map<string, T[]>();
  for (const row of rows) {
    const id = row.itemGroup?.id;
    if (!id) continue;
    const members = byGroup.get(id) ?? [];
    members.push(row);
    byGroup.set(id, members);
  }

  const ordered: T[] = [];
  const emitted = new Set<string>();
  for (const row of rows) {
    const id = row.itemGroup?.id;
    if (!id) {
      ordered.push(row);
    } else if (!emitted.has(id)) {
      ordered.push(...(byGroup.get(id) ?? []));
      emitted.add(id);
    }
  }
  // Direct services are still priced unit lines, but the customer should read
  // the main products first. A stable partition puts services after all
  // products while retaining their amounts and their relative order.
  return [
    ...ordered.filter((row) => !directServiceIds.has(row.id ?? "")),
    ...ordered.filter((row) => directServiceIds.has(row.id ?? "")),
  ];
}

/** Presentation-only subtotals over the already-priced member lines. */
export function summarizeCustomerItemGroups(
  rows: readonly {
    itemGroup?: { id: string } | null;
    tierLineTotals: ReadonlyArray<number | null>;
  }[],
  tierQuantitiesByGroup: ReadonlyMap<string, ReadonlyArray<number | null>>,
): Map<string, ReadonlyArray<{ unitPrice: number | null; lineTotal: number | null }>> {
  const grouped = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const id = row.itemGroup?.id;
    if (!id) continue;
    const members = grouped.get(id) ?? [];
    members.push(row);
    grouped.set(id, members);
  }

  const summaries = new Map<string, ReadonlyArray<{ unitPrice: number | null; lineTotal: number | null }>>();
  for (const [id, members] of grouped) {
    const quantities = tierQuantitiesByGroup.get(id) ?? [];
    summaries.set(id, quantities.map((quantity, tierIndex) => {
      let lineTotal = 0;
      for (const member of members) {
        const amount = member.tierLineTotals[tierIndex];
        if (amount == null) return { lineTotal: null, unitPrice: null };
        lineTotal += amount;
      }
      return {
        lineTotal,
        unitPrice: quantity != null && quantity > 0 ? lineTotal / quantity : null,
      };
    }));
  }
  return summaries;
}

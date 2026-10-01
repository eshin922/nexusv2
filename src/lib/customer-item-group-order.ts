/** Keep the customer's priced Item Group members together without changing their economics. */
export function orderCustomerItemGroupRows<T extends { itemGroup?: { id: string } | null }>(
  rows: readonly T[],
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
  return ordered;
}

export type UnresolvedQuoteCost = {
  quoteLeafId: string | null;
  assemblyLeafId: string;
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
      const attachmentId = row.quoteLeafId ?? row.assemblyLeafId;
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

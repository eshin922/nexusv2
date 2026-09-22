import type { FreightWorkbook } from "../freight-workbook";
import { fmtPct1 } from "../money-display";

export type FreightSummaryInput = {
  workbook: FreightWorkbook;
  handoff: { status: "open" | "completed" | "withdrawn"; assignedToEmail: string | null } | null;
  statusAvailable: boolean;
};

/** Recorded selected-destination costs only. No extension, allocation or rollup. */
export function freightSummaryShipments(workbook: FreightWorkbook, tierIds: readonly string[]) {
  return workbook.subcategories.map((shipment) => {
    const destination = workbook.destinations.find((d) =>
      d.freightSubcategoryId === shipment.id && d.id === shipment.selectedDestinationId);
    const customs = workbook.customsEntries.filter((c) => c.freightSubcategoryId === shipment.id);
    const members = workbook.memberships.filter((m) => m.freightSubcategoryId === shipment.id).length;
    const rows = (["freight", "duty", "tariff"] as const).map((kind) => {
      const cells = tierIds.map((tierId) => {
        if (kind !== "freight" && !shipment.crossesInternationalBorder)
          return { tierId, amount: null, markup: null, state: "not-applicable" as const };
        if (!destination) return { tierId, amount: null, markup: null, state: "selection-needed" as const };
        const matches = kind === "freight"
          ? workbook.breaks.filter((b) => b.freightDestinationId === destination.id && b.tierId === tierId)
            .map((b) => ({ amount: b.freightAmount, markup: b.freightMarkupPct }))
          : workbook.customsBreaks.filter((b) => customs.length === 1 && b.freightCustomsEntryId === customs[0].id && b.tierId === tierId && b.chargeType === kind)
            .map((b) => ({ amount: b.amount, markup: b.markupPct }));
        const value = matches.length === 1 ? matches[0] : { amount: null, markup: null };
        return { tierId, ...value, state: value.amount === null || value.markup === null ? "unpriced" as const : "priced" as const };
      });
      const states = cells.map((cell) => cell.state);
      const markups = cells.map((cell) => cell.markup);
      const markupDetail = cells.map((cell, index) => `${tierIds[index]}: ${cell.markup === null ? "not set" : fmtPct1(Number(cell.markup))}`).join(" · ");
      const markupSummary = states.every((state) => state === "not-applicable") ? "Not applicable"
        : states.some((state) => state === "selection-needed") ? "Awaiting selection"
        : markups.some((markup) => markup === null) ? "Markup needed"
        : new Set(markups.map((markup) => Number(markup))).size === 1
          ? fmtPct1(Number(markups[0]))
          : markups.map((markup) => fmtPct1(Number(markup))).join(" · ");
      return { kind, cells, markupSummary, markupDetail };
    });
    return { id: shipment.id, label: shipment.label, destination: destination?.destination ?? null,
      origin: shipment.origin, members, rows,
      needsInput: !destination || members === 0 || rows.some((r) => r.cells.some((c) => c.state === "unpriced")),
    };
  });
}

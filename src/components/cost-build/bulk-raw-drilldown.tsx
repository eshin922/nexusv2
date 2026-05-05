import { ModeSelector } from "./mode-selector";

// Slice RI.4 — Bulk Raw drill-down panel.
//
// Per Designer audit C-1 (block-boundary): Bulk Raw is a peer
// section that ALWAYS renders; the mode selector lives INSIDE the
// drilldown as the mode-declaration zone. When raws-mode !=
// dps_sources, the drilldown shows mode selector + INACTIVE message;
// when dps_sources, the full categories + ingredients UI.
//
// v1 ships:
//   - Mode selector at top (functional via setRawsMode action)
//   - Mode-aware body: INACTIVE explanation OR categories + ingredients
//   - Read-only ingredient table when dps_sources
//   - Add Category / Add Ingredient = DISABLED placeholders
//     (CRUD action layer lands in RI.4 follow-up)
//
// Deferred to RI.4 follow-up (UX_BACKLOG):
//   - Add/edit/delete categories + ingredients
//   - Section deposit lifecycle UI (deposit badge state reads from
//     cost_section_deposits already; UPDATE affordance deferred)
//   - HTS code lookup integration
//   - Supplier picker

type BulkRawCategory = {
  id: string;
  quoteId: string;
  name: string;
  markupPct: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type BulkRawIngredient = {
  id: string;
  categoryId: string;
  name: string;
  nativeUnit: "kg" | "L" | "mL" | "oz" | "g" | "lb";
  costPerNativeUnit: string | null;
  usagePerFilledUnit: string | null;
  perFilledUnitCost: string | null;
  htsCode: string | null;
  supplierId: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function fmtCurr4(n: string | null): string {
  if (n === null) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function fmtPct(n: string | null): string {
  if (n === null) return "inherit firm";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

export function BulkRawDrilldown({
  quoteId,
  rawsMode,
  categories,
  ingredients,
  editable,
}: {
  quoteId: string;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
  categories: BulkRawCategory[];
  ingredients: BulkRawIngredient[];
  editable: boolean;
}) {
  const ingsByCategory = new Map<string, BulkRawIngredient[]>();
  for (const ing of ingredients) {
    const arr = ingsByCategory.get(ing.categoryId) ?? [];
    arr.push(ing);
    ingsByCategory.set(ing.categoryId, arr);
  }

  // Mode selector always renders at top of drilldown (mode-declaration
  // zone per Round 6 + Bulk Raw correction).
  const modeSelector = (
    <ModeSelector
      quoteId={quoteId}
      currentMode={rawsMode}
      disabled={!editable}
    />
  );

  // INACTIVE state: when raws-mode != dps_sources, show mode selector
  // + explanation. No categories/ingredients UI.
  if (rawsMode !== "dps_sources") {
    return (
      <div className="flex flex-col gap-4">
        {modeSelector}
        <div className="rounded border border-rule bg-paper-2 p-6 text-center">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
            Bulk Raw inactive
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            {rawsMode === "cm_sources"
              ? "Contract manufacturer sources the bulk raws. Raws cost enters via the Production section's bulk-raw-cost field."
              : "Customer supplies the raws. Raws are excluded from landed cost; production covers labor + overhead only."}
          </p>
          <p className="mt-3 text-xs text-ink-4">
            Switch to{" "}
            <span className="font-mono">DPS sources raws</span>{" "}
            above to enter ingredient-level Bulk Raw data.
          </p>
        </div>
      </div>
    );
  }

  // DPS_SOURCES state: full categories + ingredients UI.
  if (categories.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {modeSelector}
        <div className="flex flex-col items-center gap-3 rounded border border-dashed border-rule bg-paper-2 px-6 py-12 text-center">
        <div className="font-display text-lg text-ink">
          No categories yet
        </div>
        <p className="max-w-md text-sm text-ink-3">
          Categories group ingredients by type (e.g., "Active ingredients",
          "Carriers", "Preservatives"). Each category can carry an optional
          markup % override.
        </p>
        <button
          type="button"
          disabled
          title="Add category — coming in RI.4 follow-up"
          className="rounded border border-rule bg-paper px-3 py-1.5 text-sm font-medium text-ink-3 disabled:cursor-not-allowed"
        >
          + New category
        </button>
        <p className="font-mono text-[10px] uppercase tracking-wide text-ink-4">
          CRUD UI ships in RI.4 follow-up · schema is in place
        </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {modeSelector}
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-3">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} ·{" "}
          {ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          disabled={!editable}
          title="Add category — coming in RI.4 follow-up"
          className="rounded border border-rule bg-paper px-2.5 py-1 text-xs text-ink-3 disabled:cursor-not-allowed hover:border-rule-2 hover:text-ink"
        >
          + New category
        </button>
      </div>

      {categories.map((cat) => {
        const ings = ingsByCategory.get(cat.id) ?? [];
        return (
          <article
            key={cat.id}
            className="overflow-hidden rounded border border-rule bg-paper"
          >
            <header className="flex items-center justify-between gap-3 border-b border-rule bg-paper-2 px-4 py-2.5">
              <div>
                <h3 className="font-display text-base text-ink">
                  {cat.name}
                </h3>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-ink-3">
                  <span>
                    {ings.length} ingredient{ings.length === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>markup {fmtPct(cat.markupPct)}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={!editable}
                title="Add ingredient — coming in RI.4 follow-up"
                className="rounded border border-rule bg-paper px-2.5 py-1 text-xs text-ink-3 disabled:cursor-not-allowed hover:border-rule-2 hover:text-ink"
              >
                + New ingredient
              </button>
            </header>

            {ings.length === 0 ? (
              <p className="py-6 text-center text-sm italic text-ink-4">
                No ingredients in this category yet.
              </p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper-3 text-left font-mono text-[10px] uppercase tracking-[0.13em] text-ink-3">
                    <th className="px-3 py-2 font-normal">Ingredient</th>
                    <th className="px-3 py-2 font-normal">Native unit</th>
                    <th className="px-3 py-2 text-right font-normal">
                      Cost / native
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      Usage / filled unit
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      Per filled unit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ings.map((ing) => (
                    <tr
                      key={ing.id}
                      className="border-b border-rule last:border-b-0 hover:bg-paper-2"
                    >
                      <td className="px-3 py-2 text-sm">
                        <div className="font-medium text-ink">{ing.name}</div>
                        {ing.htsCode && (
                          <div className="font-mono text-[10px] text-ink-4">
                            HTS {ing.htsCode}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-2">
                        {ing.nativeUnit}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-ink-2">
                        {fmtCurr4(ing.costPerNativeUnit)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-ink-2">
                        {ing.usagePerFilledUnit ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-ink">
                        {fmtCurr4(ing.perFilledUnitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        );
      })}

      <p className="text-center font-mono text-[10px] uppercase tracking-wide text-ink-4">
        Edit + delete affordances ship in RI.4 follow-up · schema is in place
      </p>
    </div>
  );
}

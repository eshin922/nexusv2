"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteAssemblyLeafInputLine,
  searchPricingVendors,
  updateAssemblyLeafInputCell,
  updateAssemblyLeafInputLineMeta,
} from "@/app/actions/assembly-leaf-inputs";
import { AddLineButton } from "@/app/projects/[id]/quotes/[quoteId]/packaging/add-line-button";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectPackaging,
  selectUpdatePackagingCell,
  selectUpdatePackagingLineMeta,
} from "@/lib/costing-store";

// SKU shape consumed by this drilldown — fed via the Costs page's
// synthetic wrapper (assemblies + assembly_leaves from NEW model
// reshaped). Step 8 — inlined the shape so the drilldown no longer
// depends on the OLD `quote_skus` schema type.
type QuoteSku = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
  parentSkuId: string | null;
  qtyPerParent: string | null;
  sortOrder: number;
  // Setup-owned. NULL when the component was never typed in Setup.
  productTypeId?: string | null;
};

// Slice RI.4 — Packaging drill-down per R6 source
// (`docs/design-prototypes/dist/source/round-6/packaging-drawer.jsx`).
//
// Structure:
//   .r6-empty-drawer when no lines exist
//   .drawer-toolbar — line count + summary + + Line / From inventory
//   .r6-dt.pkg — flat table:
//     Component (name + sub) | Category | Pricing vendor | Markup | per-tier | actions
//   Total row at bottom
//
// One flat list across all SKUs (R6 anchor-SKU pattern). When the
// quote has multiple SKUs, the SKU label appears in the row's name
// sub-text. v1 ships display + inline number inputs for tier cells +
// governed Pricing Vendor inputs and inline numeric inputs for markup.

type PackagingInputRow = {
  packaging_inputs: {
    id: string;
    quoteSkuId: string;
    tierId: string;
    lineGroupId: string;
    sortOrder: number;
    pricingVendorHubspotCompanyId: string | null;
    pricingVendorNameSnapshot: string | null;
    supplier: string | null;
    qtyPerSellableUnit: string | null;
    category: string | null;
    markupPct: string | null;
    markupPctSource: "category_default" | "manual_override" | null;
    inventoryEligible: boolean;
    notes: string | null;
    unitCost: string | null;
    purchaseQty: string | null;
  };
};

type LineForUI = {
  lineGroupId: string;
  sortOrder: number;
  quoteSkuId: string;
  pricingVendorHubspotCompanyId: string | null;
  pricingVendorNameSnapshot: string | null;
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
  cells: Map<string, { rowId: string; unitCost: string | null }>;
};

const DEBOUNCE_MS = 500;

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Compute per-line per-tier landed packaging value:
//   unit_cost × (1 + markup) × qty_per_sellable_unit
function lineValueForTier(line: LineForUI, tierId: string): number | null {
  const cell = line.cells.get(tierId);
  const unit = num(cell?.unitCost ?? null);
  const markup = num(line.markupPct) ?? 0;
  const qty = num(line.qtyPerSellableUnit) ?? 1;
  if (unit === null) return null;
  return unit * (1 + markup) * qty;
}

export function PackagingDrilldown({
  skus,
  tiers,
  inputRows,
  categories,
  editable,
}: {
  skus: QuoteSku[];
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  inputRows: PackagingInputRow[];
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  editable: boolean;
}) {
  const skuMap = new Map(skus.map((s) => [s.id, s]));
  const linesById = new Map<string, LineForUI>();
  for (const r of inputRows) {
    const row = r.packaging_inputs;
    let line = linesById.get(row.lineGroupId);
    if (!line) {
      line = {
        lineGroupId: row.lineGroupId,
        sortOrder: row.sortOrder,
        quoteSkuId: row.quoteSkuId,
        pricingVendorHubspotCompanyId: row.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: row.pricingVendorNameSnapshot,
        supplier: row.supplier,
        qtyPerSellableUnit: row.qtyPerSellableUnit,
        category: row.category,
        markupPct: row.markupPct,
        markupPctSource: row.markupPctSource,
        inventoryEligible: row.inventoryEligible,
        notes: row.notes,
        cells: new Map(),
      };
      linesById.set(row.lineGroupId, line);
    }
    line.cells.set(row.tierId, {
      rowId: row.id,
      unitCost: row.unitCost,
    });
  }
  const lines = Array.from(linesById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  if (tiers.length === 0) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "var(--warn-soft)",
          border: "1px solid oklch(from var(--warn) l c h / 0.40)",
          borderRadius: 6,
          fontSize: 13,
          color: "var(--warn)",
        }}
      >
        Add at least one tier to the quote before entering packaging inputs.
      </div>
    );
  }

  const leafSkus = skus.filter((s) => s.skuRole === "leaf");
  if (leafSkus.length === 0) {
    return (
      <EmptyDrawer
        title="No leaf SKUs yet"
        body="Add at least one leaf SKU to the quote before entering packaging inputs."
      />
    );
  }

  if (lines.length === 0) {
    // Setup owns product structure; Costs inherits it. Attaching a component
    // in Setup materialises its cost rows here, so a quote whose Setup is
    // populated is never empty on this surface.
    //
    // The previous treatment rendered one "Add line · <component>" button per
    // leaf, which invited the operator to re-declare structure Setup already
    // owned — and on a 15-component quote produced a wall of fifteen buttons.
    // It is deliberately not replaced with a different add affordance: the
    // correct remedy for an empty Costs surface is to populate Setup.
    return (
      <EmptyDrawer
        title="No components in Setup yet"
        body="Packaging lines are inherited from the components on this quote's Setup. Add components there and they will appear here with a cost cell for every tier."
      />
    );
  }

  // Governed warning for inherited components with no Setup product type.
  // Inheritance is never suppressed by a missing type — the line still appears
  // and is still costable — but the category-derived markup default cannot
  // resolve without one, so the gap is surfaced rather than silently absorbed.
  // The fix belongs in Setup, which owns the type.
  const untypedLeaves = leafSkus.filter((s) => !s.productTypeId);

  const inventoryEligibleCount = lines.filter((l) => l.inventoryEligible).length;
  const vendorSet = new Set(
    lines
      .map((line) => line.pricingVendorNameSnapshot ?? line.supplier)
      .filter((value): value is string => !!value),
  );

  // Tier sums for foot
  const tierSums = tiers.map((t) => {
    let sum = 0;
    let anyValue = false;
    for (const l of lines) {
      const v = lineValueForTier(l, t.id);
      if (v !== null) {
        sum += v;
        anyValue = true;
      }
    }
    return { tierId: t.id, value: anyValue ? sum : null };
  });

  return (
    <div>
      {untypedLeaves.length > 0 && (
        <div
          role="status"
          aria-label="Components missing a Setup product type"
          className="mb-2 rounded border border-warn bg-warn-soft px-3 py-2 text-xs text-warn"
        >
          <strong>
            {untypedLeaves.length}{" "}
            {untypedLeaves.length === 1 ? "component has" : "components have"}
          </strong>{" "}
          no product type set in Setup
          {": "}
          {untypedLeaves.map((s) => s.productName).join(", ")}. These lines are
          still costable, but markup defaults can&rsquo;t resolve from a
          category until the type is set in Setup.
        </div>
      )}
      {/* Drawer toolbar — canonical .drawer-toolbar inside .r6-drawer
          (parent SectionWithDrilldown applies .r6-drawer to the
          collapsible region). 10/14 padding / paper bg / 1px rule /
          8px radius; .lhs flex baseline mono 11 / 0.04em ink-3 with
          strong ink 500 highlights; .rhs flex 6px gap. */}
      <div className="drawer-toolbar">
        <div className="lhs">
          <span>
            <strong>{lines.length}</strong> components
          </span>
          <span>·</span>
          <span>
            Markup defaults: <strong>per category</strong>
          </span>
          <span>·</span>
          <span>{inventoryEligibleCount} inventory-eligible · {vendorSet.size} pricing vendor{vendorSet.size === 1 ? "" : "s"}</span>
        </div>
        <div className="rhs">
          <PackagingAddLineActions leafSkus={leafSkus} editable={editable} />
        </div>
      </div>

      {/* Flat table */}
      <div
        className="r6-dt pkg"
        style={
          { ["--cols" as string]: tiers.length } as React.CSSProperties
        }
      >
        <div className="r6-dt-head">
          <span>Component</span>
          <span>Category</span>
          <span>
            Pricing Source{" "}
            <span
              className="pricing-source-info"
              title="The HubSpot Vendor whose pricing was used for this quote; not the awarded or purchasing vendor."
              aria-label="About Pricing Source"
              tabIndex={0}
            >
              ⓘ
            </span>
          </span>
          <span className="num">Markup</span>
          {tiers.map((t) => (
            <span key={t.id} className="num">
              {t.label}
              <br />
              <span
                style={{
                  fontSize: "9px",
                  letterSpacing: "0.04em",
                  opacity: 0.7,
                }}
              >
                {t.qty !== null ? t.qty.toLocaleString() : "—"}
              </span>
            </span>
          ))}
          <span></span>
        </div>

        {lines.map((line) => (
          <PackagingRow
            key={line.lineGroupId}
            line={line}
            tiers={tiers}
            sku={skuMap.get(line.quoteSkuId)}
            categories={categories}
            disabled={!editable}
          />
        ))}

        <div className="r6-dt-foot">
          <span className="total-lab">Total — packaging</span>
          <span></span>
          <span></span>
          <span></span>
          {tierSums.map((s) => (
            <span
              key={s.tierId}
              className={`num ${s.value === null ? "empty" : ""}`}
            >
              {s.value === null ? "—" : fmtCurr2(s.value)}
            </span>
          ))}
          <span></span>
        </div>
      </div>
    </div>
  );
}

function PackagingAddLineActions({
  leafSkus,
  editable,
}: {
  leafSkus: QuoteSku[];
  editable: boolean;
}) {
  const multipleSkus = leafSkus.length > 1;

  return (
    <div
      className="flex flex-wrap justify-end gap-2"
      aria-label="Add packaging line by SKU"
    >
      {leafSkus.map((sku) => (
        <AddLineButton
          key={sku.id}
          quoteSkuId={sku.id}
          disabled={!editable}
          label={multipleSkus ? `Add line · ${sku.skuLabel}` : "Add line"}
          tooltip={multipleSkus ? `Adds to ${sku.skuLabel}` : undefined}
        />
      ))}
    </div>
  );
}

function EmptyDrawer({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="r6-empty-drawer">
      <div className="glyph">∅</div>
      <h4>{title}</h4>
      <p>{body}</p>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

function PackagingRow({
  line,
  tiers,
  sku,
  categories,
  disabled,
}: {
  line: LineForUI;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sku: QuoteSku | undefined;
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const activeTierId = useCostingStore(selectActiveTierId);
  const updateLineMeta = useCostingStore(selectUpdatePackagingLineMeta);

  // Subscribe to the local store so governed pricing provenance and pricing
  // inputs reflect the canonical server receipt and realtime reconciliation.
  // The legacy supplier remains prop-only because it is immutable evidence.
  const storePackaging = useCostingStore(selectPackaging);
  const storeLineRow = storePackaging.find(
    (p) => p.lineGroupId === line.lineGroupId,
  );
  const storeCategory: string = storeLineRow?.category ?? line.category ?? "";
  const storeMarkupPct: string =
    storeLineRow?.markupPct !== null && storeLineRow?.markupPct !== undefined
      ? String(storeLineRow.markupPct)
      : (line.markupPct ?? "");

  const storeVendorId =
    storeLineRow?.pricingVendorHubspotCompanyId ??
    line.pricingVendorHubspotCompanyId;
  const storeVendorName =
    storeLineRow?.pricingVendorNameSnapshot ?? line.pricingVendorNameSnapshot;
  const [vendorId, setVendorId] = useState(storeVendorId);
  const [vendorName, setVendorName] = useState(storeVendorName);
  const [vendorQuery, setVendorQuery] = useState(storeVendorName ?? "");
  const [vendorEditing, setVendorEditing] = useState(false);
  const [vendorResults, setVendorResults] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [vendorSearchComplete, setVendorSearchComplete] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [searching, startSearchTransition] = useTransition();
  const [category, setCategory] = useState(storeCategory);
  const [markupPct, setMarkupPct] = useState(storeMarkupPct);
  const metaDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({
    vendorId,
    vendorName,
    category,
    markupPct,
  });
  stateRef.current = {
    vendorId,
    vendorName,
    category,
    markupPct,
  };
  const canonicalRef = useRef(stateRef.current);

  // Sync local input state on either line identity or canonical value change.
  // Wait-for-quiet at the provider level (QUIET_PERIOD_MS=800ms)
  // prevents mid-typing clobber.
  useEffect(() => {
    setVendorId(storeVendorId);
    setVendorName(storeVendorName);
    setVendorQuery(storeVendorName ?? "");
    setVendorEditing(false);
    setVendorSearchComplete(false);
    setCategory(storeCategory);
    setMarkupPct(storeMarkupPct);
    canonicalRef.current = {
      vendorId: storeVendorId,
      vendorName: storeVendorName,
      category: storeCategory,
      markupPct: storeMarkupPct,
    };
  }, [
    line.lineGroupId,
    storeVendorId,
    storeVendorName,
    storeCategory,
    storeMarkupPct,
  ]);

  useEffect(
    () => () => {
      if (metaDebounce.current) clearTimeout(metaDebounce.current);
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    },
    [],
  );

  function fireMetaSave(overrides: Partial<{
    vendorId: string | null;
    vendorName: string | null;
    category: string;
    markupPct: string;
  }> = {}) {
    const s = { ...stateRef.current, ...overrides };
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("pricingVendorHubspotCompanyId", s.vendorId ?? "");
    fd.set("category", s.category);
    fd.set("markupPct", s.markupPct);
    fd.set("qtyPerSellableUnit", line.qtyPerSellableUnit ?? "");
    fd.set("inventoryEligible", line.inventoryEligible ? "true" : "false");
    fd.set("notes", line.notes ?? "");
    startTransition(async () => {
      const result = await updateAssemblyLeafInputLineMeta(fd);
      if (!result.ok) {
        const previous = canonicalRef.current;
        setVendorId(previous.vendorId);
        setVendorName(previous.vendorName);
        setVendorQuery(previous.vendorName ?? "");
        setVendorEditing(false);
        setCategory(previous.category);
        setMarkupPct(previous.markupPct);
        updateLineMeta(line.lineGroupId, {
          pricingVendorHubspotCompanyId: previous.vendorId,
          pricingVendorNameSnapshot: previous.vendorName,
          category: previous.category || null,
          markupPct: num(previous.markupPct),
          qtyPerSellableUnit: num(line.qtyPerSellableUnit),
        });
        setVendorError(result.error.message);
        return;
      }
      setVendorId(result.data.pricingVendorHubspotCompanyId);
      setVendorName(result.data.pricingVendorNameSnapshot);
      setVendorQuery(result.data.pricingVendorNameSnapshot ?? "");
      setVendorEditing(false);
      canonicalRef.current = {
        vendorId: result.data.pricingVendorHubspotCompanyId,
        vendorName: result.data.pricingVendorNameSnapshot,
        category: result.data.category ?? "",
        markupPct: result.data.markupPct ?? "",
      };
      updateLineMeta(line.lineGroupId, {
        pricingVendorHubspotCompanyId:
          result.data.pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot: result.data.pricingVendorNameSnapshot,
        category: result.data.category,
        markupPct: num(result.data.markupPct),
        qtyPerSellableUnit: num(result.data.qtyPerSellableUnit),
      });
      setVendorError(null);
    });
  }

  function scheduleMetaSave(overrides: Partial<{
    vendorId: string | null;
    vendorName: string | null;
    category: string;
    markupPct: string;
  }>) {
    if (metaDebounce.current) clearTimeout(metaDebounce.current);
    metaDebounce.current = setTimeout(() => fireMetaSave(overrides), DEBOUNCE_MS);
  }

  function scheduleVendorSearch(query: string) {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (query.trim().length < 2) {
      setVendorResults([]);
      setVendorSearchComplete(false);
      return;
    }
    setVendorSearchComplete(false);
    searchDebounce.current = setTimeout(() => {
      startSearchTransition(async () => {
        try {
          setVendorResults(await searchPricingVendors(query));
          setVendorSearchComplete(true);
          setVendorError(null);
        } catch {
          setVendorResults([]);
          setVendorSearchComplete(false);
          setVendorError("Pricing Vendors could not be loaded.");
        }
      });
    }, 250);
  }

  function handleDelete() {
    if (!confirm("Delete this packaging line?")) return;
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    startTransition(async () => {
      await deleteAssemblyLeafInputLine(fd);
    });
  }

  const skuLabel = sku?.skuLabel ?? "";
  const productName = sku?.productName ?? "";
  // The library LEAF is the cost-bearing component identity. Pricing Vendor
  // remains provenance in its own column and must never replace what is being
  // costed. `quoteSkuId` resolves through assembly_leaves to this LEAF.
  const componentName = productName || skuLabel || "Unknown component";

  return (
    <div className="r6-dt-row">
      {/* Component name + sub (SKU + qty/unit + inv-eligible badge) */}
      <div className="name">
        <span className="lab">{componentName}</span>
        {(skuLabel || line.qtyPerSellableUnit) && (
          <span className="sub">
            {skuLabel}
            {skuLabel && line.qtyPerSellableUnit ? " · " : ""}
            {line.qtyPerSellableUnit ? `${line.qtyPerSellableUnit}/unit` : ""}
          </span>
        )}
        {line.inventoryEligible && (
          <div className="r6-badges" style={{ marginTop: 4 }}>
            <span className="r6-badge accent">inventory-eligible</span>
          </div>
        )}
      </div>

      {/* Category — inline editable select */}
      <div className="cat">
        <select
          value={category}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setCategory(v);
            // Auto-fill markup from category default
            const cat = categories.find((c) => c.category === v);
            if (cat) {
              setMarkupPct(cat.defaultMarkupPct);
              scheduleMetaSave({ category: v, markupPct: cat.defaultMarkupPct });
            } else {
              scheduleMetaSave({ category: v });
            }
          }}
          style={{
            background: "transparent",
            border: "none",
            font: "inherit",
            color: "inherit",
            letterSpacing: "inherit",
            cursor: disabled ? "not-allowed" : "pointer",
            padding: 0,
            width: "100%",
          }}
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category}
            </option>
          ))}
        </select>
      </div>

      {/* Governed Pricing Vendor with compatibility-only legacy evidence. */}
      <div className="sup pricing-source">
        {vendorId && !vendorEditing ? (
          <div className="pricing-source-selected">
            <span className="pricing-source-label">Selected vendor</span>
            <span className="pricing-source-name">{vendorName}</span>
            {!disabled && (
              <span className="pricing-source-actions">
                <button
                  type="button"
                  onClick={() => {
                    setVendorEditing(true);
                    setVendorQuery("");
                    setVendorResults([]);
                    setVendorSearchComplete(false);
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  aria-label="Clear Pricing Vendor"
                  onClick={() => {
                    stateRef.current = {
                      ...stateRef.current,
                      vendorId: null,
                      vendorName: null,
                    };
                    setVendorId(null);
                    setVendorName(null);
                    setVendorQuery("");
                    setVendorResults([]);
                    setVendorSearchComplete(false);
                    scheduleMetaSave({ vendorId: null, vendorName: null });
                  }}
                >
                  Clear
                </button>
              </span>
            )}
          </div>
        ) : (
          <div className="pricing-source-search">
            <input
              type="search"
              aria-label="Pricing Vendor"
              value={vendorQuery}
              disabled={disabled}
              onChange={(event) => {
                const query = event.target.value;
                setVendorQuery(query);
                scheduleVendorSearch(query);
              }}
              placeholder="Search HubSpot Vendors"
              autoComplete="off"
            />
            {vendorId && !disabled && (
              <button
                type="button"
                onClick={() => {
                  setVendorEditing(false);
                  setVendorQuery(vendorName ?? "");
                  setVendorResults([]);
                  setVendorSearchComplete(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {searching && <span className="sub">Searching…</span>}
        {!disabled && (!vendorId || vendorEditing) && vendorResults.length > 0 && (
          <div
            role="listbox"
            aria-label="Pricing Vendor results"
            style={{
              position: "absolute",
              zIndex: 20,
              top: "24px",
              left: 0,
              minWidth: "240px",
              padding: "4px",
              border: "1px solid var(--line)",
              background: "var(--paper)",
              boxShadow: "var(--shadow)",
            }}
          >
            {vendorResults.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                role="option"
                aria-selected={vendor.id === vendorId}
                onClick={() => {
                  stateRef.current = {
                    ...stateRef.current,
                    vendorId: vendor.id,
                    vendorName: vendor.name,
                  };
                  setVendorId(vendor.id);
                  setVendorName(vendor.name);
                  setVendorQuery(vendor.name);
                  setVendorEditing(false);
                  setVendorResults([]);
                  setVendorSearchComplete(false);
                  scheduleMetaSave({
                    vendorId: vendor.id,
                    vendorName: vendor.name,
                  });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px",
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                {vendor.name}
              </button>
            ))}
          </div>
        )}
        {!vendorId && line.supplier && (
          <div className="pricing-source-legacy">
            <span className="pricing-source-label">Historical supplier</span>
            <span>{line.supplier}</span>
          </div>
        )}
        {!searching &&
          vendorSearchComplete &&
          vendorResults.length === 0 &&
          !vendorError && (
            <span className="pricing-source-empty" role="status">
              No eligible HubSpot Vendors match “{vendorQuery.trim()}”.
            </span>
        )}
        {vendorError && (
          <span role="alert" className="sub">
            {vendorError}
          </span>
        )}
      </div>

      {/* Markup % chip — inline editable number */}
      <div className="num">
        <span className="markup">
          <input
            type="number"
            step="0.01"
            min={0}
            value={markupPct === "" ? "" : (Number(markupPct) * 100).toString()}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              const decimal = v === "" ? "" : (Number(v) / 100).toString();
              setMarkupPct(decimal);
              scheduleMetaSave({ markupPct: decimal });
            }}
            placeholder="—"
            style={{
              background: "transparent",
              border: "none",
              font: "inherit",
              color: "inherit",
              width: "32px",
              textAlign: "right",
              padding: 0,
            }}
          />
          %
        </span>
      </div>

      {/* Per-tier cells */}
      {tiers.map((t) => (
        <PackagingTierCell
          key={t.id}
          tierId={t.id}
          line={line}
          markupPct={markupPct}
          isActive={activeTierId === t.id}
          disabled={disabled}
        />
      ))}

      {/* Actions */}
      <div className="actions">
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled || pending}
          title="Delete line"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
            padding: "0 4px",
            fontFamily: "var(--mono)",
            fontSize: "14px",
          }}
        >
          ···
        </button>
      </div>
    </div>
  );
}

function PackagingTierCell({
  tierId,
  line,
  markupPct,
  isActive,
  disabled,
}: {
  tierId: string;
  line: LineForUI;
  markupPct: string;
  isActive: boolean;
  disabled: boolean;
}) {
  const cell = line.cells.get(tierId);
  const [pending, startTransition] = useTransition();
  const updatePackagingCell = useCostingStore(selectUpdatePackagingCell);

  // Slice 11.5.1 MIG-8 close-gate — subscribe to the store's
  // packaging slice to pick up cross-tab realtime reconciles.
  // The `cell` from `line.cells.get(tierId)` is derived from the
  // page-level `inputRows` prop, which is an RSC server snapshot
  // and does NOT refresh when the store reconciles. Cross-tab
  // edits would update the store but leave the cell input
  // rendering its stale prop value until a server-side
  // revalidation. Subscribing here makes the cell input
  // store-driven for its unit cost.
  const storePackaging = useCostingStore(selectPackaging);
  const storeUnitCost: string | null = cell?.rowId
    ? (() => {
        const row = storePackaging.find((p) => p.rowId === cell.rowId);
        if (!row) return cell.unitCost;
        return row.unitCost !== null ? String(row.unitCost) : null;
      })()
    : null;

  const [unitCost, setUnitCost] = useState(storeUnitCost ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(unitCost);
  valueRef.current = unitCost;

  // Sync local input state to the store-tracked value on EITHER:
  //   - row identity change (different cell mounted in this slot)
  //   - same row, value changed in the store (own edit, own
  //     reconcile, or cross-tab realtime reconcile)
  //
  // The wait-for-quiet pipe in CostingStoreProvider's
  // scheduleReconcile (QUIET_PERIOD_MS=800ms) guarantees this
  // effect doesn't fire mid-typing — store reconciles defer
  // while the user is actively typing in any cell on this quote.
  useEffect(() => {
    setUnitCost(storeUnitCost ?? "");
  }, [cell?.rowId, storeUnitCost]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  if (!cell) {
    return <span className="cell-num empty">—</span>;
  }

  function fireSave() {
    if (!cell) return;
    const fd = new FormData();
    fd.set("rowId", cell.rowId);
    fd.set("unitCost", valueRef.current);
    fd.set("purchaseQty", "");
    startTransition(async () => {
      await updateAssemblyLeafInputCell(fd);
    });
  }

  function handleChange(value: string) {
    setUnitCost(value);
    if (cell) {
      const numeric = num(value);
      updatePackagingCell(cell.rowId, { unitCost: numeric });
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  // Computed per-tier landed value displayed alongside the unit_cost input
  const u = num(unitCost);
  const m = num(markupPct) ?? 0;
  const q = num(line.qtyPerSellableUnit) ?? 1;
  const landed = u !== null ? u * (1 + m) * q : null;

  const isEmpty = u === null;

  return (
    <span
      className={`cell-num ${isEmpty ? "empty" : ""}`}
      style={isActive ? { background: "var(--accent-soft)" } : undefined}
    >
      <input
        type="number"
        step="0.0001"
        min={0}
        value={unitCost}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="—"
        style={{
          background: "transparent",
          border: "none",
          font: "inherit",
          color: "inherit",
          width: "100%",
          textAlign: "right",
          padding: 0,
        }}
      />
      {landed !== null && (
        <span
          className="raw"
          title={`Landed: cost × (1+${(m * 100).toFixed(0)}%) × ${q}/unit`}
        >
          → {fmtCurr2(landed)}
        </span>
      )}
    </span>
  );
}

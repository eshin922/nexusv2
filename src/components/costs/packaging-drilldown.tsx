"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  searchPricingVendors,
  updateAssemblyLeafInputCell,
  updateAssemblyLeafInputLineMeta,
} from "@/app/actions/assembly-leaf-inputs";
import { useCostingStore } from "@/components/costing-store-provider";
import { nodeKey, resolveNodes } from "@/lib/costing-nodes";
import {
  selectActiveTierId,
  selectGraph,
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

/**
 * What one packaging line contributes at one tier, and where it comes from.
 *
 * ── Gate 1B · A-6 ─────────────────────────────────────────────────────────
 * This used to be computed here as `unit x (1 + line.markupPct ?? 0) x qty`.
 * The engine has owned the same quantity since increment 1, as a `markup` node
 * at `{sku}/{tier}/pkg/{lineGroupId}`, and the two DID NOT AGREE.
 *
 * The engine resolves markup through a ladder — line override, then category
 * default, then Other, then a firm fallback. The display fell through to ZERO.
 * On production that split 283 line nodes into 268 agreeing and 15 disagreeing,
 * every one of the fifteen a line with no category and no explicit markup,
 * where the engine applied the Other default of 30% and this file applied none.
 * Operators were reading a landed value 30% below what the quote prices at.
 *
 * The fallback was never the bug on its own — reimplementing a resolution the
 * engine already performs was, and a wrong fallback is what that always
 * eventually looks like. So the value is read, and `markup` is read too, rather
 * than the ladder being copied here correctly this time.
 */
type LineTierRead = {
  /** The governed landed value. Null when the graph has no single answer. */
  value: number | null;
  /** The engine's RESOLVED markup for this line — the ladder's outcome, read
   *  off the node's own resolution operand rather than recomputed. */
  markup: number | null;
};

const NO_READ: LineTierRead = { value: null, markup: null };

/** Map key. `\u0000` cannot occur in a UUID, so it cannot collide. */
function readKey(lineGroupId: string, tierId: string): string {
  return `${lineGroupId}\u0000${tierId}`;
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

  // One traversal for the whole drawer. `resolveNodes` fails closed per key on
  // both missing and duplicate, so a cell with no single answer renders a dash
  // rather than a number nobody computed.
  //
  // `line.quoteSkuId` is the assembly_leaf id, which IS the id the engine keys
  // its SKU rollups on for a grouped attachment — the same `mathSkuId` the
  // adapter emits. Cost inputs are keyed on assembly_leaf_id today (OD-017), so
  // every line that has cost data has one.
  const graph = useCostingStore(selectGraph);
  const reads = (() => {
    const keys: string[] = [];
    const keyOf = new Map<string, string>();
    for (const line of lines) {
      for (const t of tiers) {
        const k = nodeKey(line.quoteSkuId, t.id, "pkg", line.lineGroupId);
        keys.push(k);
        keyOf.set(readKey(line.lineGroupId, t.id), k);
      }
    }
    const resolved = resolveNodes(graph.nodes, keys);
    const out = new Map<string, LineTierRead>();
    for (const [mapKey, nodeK] of keyOf) {
      const node = resolved.get(nodeK) ?? null;
      if (!node || node.kind === "flagged-out") {
        out.set(mapKey, NO_READ);
        continue;
      }
      // Operand 1 is the `resolution` node the engine built for this line's
      // markup. Reading its value is how the preview below gets the ladder's
      // answer without re-walking the ladder.
      const markupOperand = node.operands?.[1];
      out.set(mapKey, {
        value: node.value,
        markup: markupOperand ? markupOperand.value : null,
      });
    }
    return out;
  })();

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
  // Setup owns packaging structure; Costs prices it. There is no author-here
  // path, so the only empty state that can legitimately persist is "Setup has
  // no components yet" — and the remedy is Setup, not this surface.
  if (leafSkus.length === 0) {
    return (
      <EmptyDrawer
        title="No components in Setup yet"
        body="Packaging prices the components defined in Setup. Add the bottle, dropper, label and any cartons there — each is its own component — and they will appear here automatically, ready to price."
      />
    );
  }

  if (lines.length === 0) {
    // Components exist but their priced rows do not. Materialization runs on
    // both attach and tier creation, so this should be unreachable; if it is
    // reached, the structure is present and the rows are the thing missing.
    return (
      <EmptyDrawer
        title="Packaging rows have not been created for these components"
        body="Setup defines these components, so their cost rows should exist. Add or re-save a tier to materialize them; if they still do not appear, report this quote."
      />
    );
  }

  const inventoryEligibleCount = lines.filter((l) => l.inventoryEligible).length;
  const vendorSet = new Set(
    lines
      .map((line) => line.pricingVendorNameSnapshot ?? line.supplier)
      .filter((value): value is string => !!value),
  );

  // Tier sums for foot.
  //
  // ── DELIBERATELY NOT MIGRATED · Gate 1B ───────────────────────────────────
  // Its INPUTS are now governed — each addend is a value read from the graph —
  // but the AGGREGATION is not, and cannot be until someone says what it means.
  //
  // This sums every line in the QUOTE, not per SKU. On a multi-SKU quote that
  // is a sum of per-unit packaging across different products: "one of each",
  // which is not obviously what an operator reads a column total as. 14 of 23
  // production quotes with packaging lines span more than one SKU, up to 15.
  //
  // The Pricing blend, the Costs header subtotal and this row have now each
  // turned out to be a different aggregation over a different population, and
  // in all three cases the population was a BUSINESS question rather than an
  // implementation detail. Emitting a node here before that question is settled
  // would freeze a guess into the authority — which is exactly how increment 7
  // shipped a blend over the wrong population. See OPEN_DECISIONS OD-018.
  const tierSums = tiers.map((t) => {
    let sum = 0;
    let anyValue = false;
    for (const l of lines) {
      const v = reads.get(readKey(l.lineGroupId, t.id))?.value ?? null;
      if (v !== null) {
        sum += v;
        anyValue = true;
      }
    }
    return { tierId: t.id, value: anyValue ? sum : null };
  });

  return (
    <div>
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
            reads={reads}
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
  reads,
  disabled,
}: {
  line: LineForUI;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sku: QuoteSku | undefined;
  categories: Array<{ category: string; defaultMarkupPct: string }>;
  /** Governed per-(line, tier) values, resolved once for the whole drawer. */
  reads: Map<string, LineTierRead>;
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
      // `canonicalRef` is the last SERVER-CONFIRMED state, captured before the
      // optimistic projection was applied — so it is the correct thing to
      // restore on any failure, not the pre-keystroke local value.
      const rollback = (message: string) => {
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
        setVendorError(message);
      };

      let result: Awaited<ReturnType<typeof updateAssemblyLeafInputLineMeta>>;
      try {
        result = await updateAssemblyLeafInputLineMeta(fd);
      } catch {
        // A THROWN failure — rejected request, transport error, or a server
        // exception that escaped runAction — never reaches the !result.ok
        // branch below. Without this catch the optimistic projection stays on
        // screen for a write that never happened, which is exactly how an
        // unpersisted markup edit came to look saved. Roll back and say so.
        rollback(
          "The edit could not be saved and has been reverted. Please try again; if this keeps happening, report this quote.",
        );
        return;
      }
      if (!result.ok) {
        rollback(result.error.message);
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
          markupDirty={markupPct !== storeMarkupPct}
          read={reads.get(readKey(line.lineGroupId, t.id)) ?? NO_READ}
          isActive={activeTierId === t.id}
          disabled={disabled}
        />
      ))}

    </div>
  );
}

function PackagingTierCell({
  tierId,
  line,
  markupPct,
  markupDirty,
  read,
  isActive,
  disabled,
}: {
  tierId: string;
  line: LineForUI;
  markupPct: string;
  /** True while the row's markup input holds an uncommitted edit. */
  markupDirty: boolean;
  /** This (line, tier)'s governed value and resolved markup. */
  read: LineTierRead;
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
  const [cellError, setCellError] = useState<string | null>(null);
  // Last SERVER-CONFIRMED value for this cell, captured at the first keystroke
  // of an edit burst — before the optimistic store write. It cannot be read
  // back from the store at failure time, because the optimistic write has
  // already overwritten it there. Null means "no edit in flight".
  const preEditRef = useRef<string | null>(null);
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
    const rowId = cell.rowId;
    const restore = preEditRef.current;
    const fd = new FormData();
    fd.set("rowId", rowId);
    fd.set("unitCost", valueRef.current);
    fd.set("purchaseQty", "");
    startTransition(async () => {
      // Restore the pre-edit value in BOTH places the operator can see it —
      // the local input and the store the Cost Stack derives from — so a
      // failed write leaves nothing behind that looks saved.
      const rollback = (message: string) => {
        preEditRef.current = null;
        setUnitCost(restore ?? "");
        updatePackagingCell(rowId, { unitCost: num(restore ?? "") });
        setCellError(message);
      };
      let result: Awaited<ReturnType<typeof updateAssemblyLeafInputCell>>;
      try {
        result = await updateAssemblyLeafInputCell(fd);
      } catch {
        // Thrown failures bypass any ok-check. Previously this call discarded
        // its result entirely, so neither a governed error nor a thrown one
        // could roll the optimistic cell back.
        rollback(
          "The cost could not be saved and has been reverted. Please try again; if this keeps happening, report this quote.",
        );
        return;
      }
      if (!result.ok) {
        rollback(result.error.message);
        return;
      }
      preEditRef.current = null;
      setCellError(null);
    });
  }

  function handleChange(value: string) {
    if (preEditRef.current === null) preEditRef.current = storeUnitCost ?? "";
    setCellError(null);
    setUnitCost(value);
    if (cell) {
      const numeric = num(value);
      updatePackagingCell(cell.rowId, { unitCost: numeric });
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(fireSave, DEBOUNCE_MS);
  }

  // The landed value beside the input.
  //
  // AT REST this is READ, not computed: the governed node for this (line, tier).
  // While the operator is mid-edit there is no committed value to read, because
  // the state being priced does not exist yet — that is a legitimate preview
  // rather than a duplicated derivation, and it is the one case in this file
  // where arithmetic is still correct to do.
  //
  // Even the preview does not reimplement markup resolution. It prefers the
  // operator's uncommitted markup, then the ENGINE'S RESOLVED markup read off
  // the node. The old `?? 0` fallback is what put 15 production cells 30% low.
  const u = num(unitCost);
  const q = num(line.qtyPerSellableUnit) ?? 1;
  const isPreview = u !== num(storeUnitCost) || markupDirty;
  const m = num(markupPct) ?? read.markup ?? 0;
  // AN UNPRICED CELL HAS NO LANDED VALUE — not a landed value of zero.
  //
  // The engine still emits a line node for it, correctly valued 0, and reading
  // that node put `→ $0.00` under four empty inputs in production: a component
  // nobody has costed asserting that it costs nothing. Caught by smoke, and the
  // same error Pattern 57 names one level up — the fail-closed read handles
  // "no node", and this handles "a node whose zero is the absence of an input
  // rather than a fact about one".
  const landed =
    u === null ? null : isPreview ? u * (1 + m) * q : read.value;

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
          title={
            isPreview
              ? `Preview of an unsaved edit: cost × (1+${(m * 100).toFixed(0)}%) × ${q}/unit`
              : `Landed cost × (1+${((read.markup ?? 0) * 100).toFixed(0)}%) × ${q}/unit`
          }
        >
          → {fmtCurr2(landed)}
        </span>
      )}
      {cellError && (
        <span
          className="raw"
          role="alert"
          title={cellError}
          style={{ color: "var(--danger, #b3261e)", whiteSpace: "normal" }}
        >
          {cellError}
        </span>
      )}
    </span>
  );
}

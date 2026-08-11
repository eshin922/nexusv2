"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  searchPricingVendors,
  updateAssemblyLeafInputCell,
  updateAssemblyLeafInputLineMeta,
} from "@/app/actions/assembly-leaf-inputs";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  nodeKey,
  quoteScopeKey,
  readNodeValue,
  resolveNodes,
} from "@/lib/costing-nodes";
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
  /** WHICH RUNG of the ladder supplied that markup — "Line override",
   *  "Category default", and so on. The resolution node records which candidate
   *  it chose, so the surface can tell an operator where a rate came from
   *  instead of leaving them to infer it. */
  markupSource: string | null;
  /** What would apply IF THE LINE HAD NO OVERRIDE — the ladder's answer with
   *  its top rung removed. This is what a placeholder must show: a placeholder
   *  says "what you get if you leave this empty", so on a line that HAS an
   *  override the resolved rate is the wrong number to offer. */
  inheritedMarkup: number | null;
  inheritedSource: string | null;
};

const NO_READ: LineTierRead = {
  value: null,
  markup: null,
  markupSource: null,
  inheritedMarkup: null,
  inheritedSource: null,
};

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
    const resolved = resolveNodes(graph, keys);
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
      const candidates = markupOperand?.candidates ?? [];
      const chosen = candidates.find((c) => c.chosen) ?? null;
      // The ladder minus its top rung: the first rung BELOW the line override
      // that could supply a value. Read from the engine's own candidate list,
      // so the fallback order stays the engine's rather than a copy of it.
      const belowOverride = candidates.find(
        (c) => c.label !== "Line override" && c.value !== null,
      );
      out.set(mapKey, {
        value: node.value,
        markup: markupOperand ? markupOperand.value : null,
        markupSource: chosen ? chosen.label : null,
        inheritedMarkup: belowOverride ? belowOverride.value : null,
        inheritedSource: belowOverride ? belowOverride.label : null,
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

  // Tier sums for foot — READ, not summed here.
  //
  // ── OD-018, settled ───────────────────────────────────────────────────────
  // The business meaning is: the simple sum of every governed SKU's packaging
  // contribution at this tier, because the row exists to show what Packaging
  // contributes to the Cost Stack. Not a mean, not weighted. The engine now
  // owns it as `quote/{tier}/cost-stack/pkg-total`.
  //
  // That key is deliberately unlike `quote/{tier}/pkg`, which is the PRICING
  // BLEND over the same population — a mean, differing from this by a factor of
  // the SKU count. Reading the wrong one would put the Pricing number under the
  // Costs column, which is the confusion OD-018 existed to end.
  //
  // TWO DIFFERENT QUESTIONS, ANSWERED SEPARATELY. Whether a total may be shown
  // is a question about INPUTS: a drawer where nothing has been costed shows a
  // dash, not zero — the same distinction that put `$0.00` under empty cells
  // when it was collapsed into the value lookup. What the total IS, once it may
  // be shown, is a question for the graph. So existence is decided from the
  // cells and only the number is read.
  const tierSums = tiers.map((t) => {
    const anyPriced = lines.some(
      (l) => num(l.cells.get(t.id)?.unitCost ?? null) !== null,
    );
    if (!anyPriced) return { tierId: t.id, value: null };
    return {
      tierId: t.id,
      value: readNodeValue(graph,
        quoteScopeKey(t.id, "cost-stack/pkg-total"),
      ),
    };
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
  // Pattern 47 authoring contract for line markup.
  //
  // Markup is the only line-meta field an operator TYPES; category and vendor
  // are chosen, and commit on change. A typed value needs a dirty flag,
  // because between the first keystroke and the commit there is a local value
  // that is more current than the store, and the store must not win.
  //
  // A ref shadows the state because the sync effect below reads dirtiness at
  // store-change time, and a state read there would be the value from the
  // render that scheduled the effect.
  const [markupDirty, setMarkupDirtyState] = useState(false);
  const markupDirtyRef = useRef(false);
  const setMarkupDirty = (next: boolean) => {
    markupDirtyRef.current = next;
    setMarkupDirtyState(next);
  };

  // The rate this line inherits when it has none of its own. Markup is
  // per-line, so every tier's read carries the same answer — the first one that
  // resolved is the answer. (Verified: no line group in production disagrees
  // with itself across tiers.)
  const inherited = tiers
    .map((t) => reads.get(readKey(line.lineGroupId, t.id)))
    .find((r) => r !== undefined && r.inheritedMarkup !== null);
  const inheritedMarkup = inherited?.inheritedMarkup ?? null;
  const inheritedSource = inherited?.inheritedSource ?? null;
  const isInheriting = markupPct === "" && inheritedMarkup !== null;
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ownership boundary for the Pricing Vendor control (VAL-104).
  //
  // The control holds two kinds of state, and they have different owners:
  //
  //   vendor DATA      -- vendorId, vendorName. Server-owned. Async
  //                       completions and store reconciles set these.
  //   SEARCH state     -- vendorQuery, vendorEditing, vendorResults,
  //                       vendorSearchComplete. OPERATOR-owned. Only an
  //                       operator gesture (type, Change, Clear, Cancel,
  //                       select) or a change of line identity may set them.
  //
  // They used to share one owner, and a Clear's own completion then wiped a
  // query the operator had typed while it was in flight: the box emptied and
  // the surface reported `No eligible HubSpot Vendors match ""`. Nothing
  // failed, and there was no moment after which typing was safe -- the clear's
  // visible effects had already landed when the reset arrived.
  //
  // This is transient search-as-you-type state, not an autosaved value, so it
  // takes no Pattern 47 blur/Enter contract. Separation is the whole fix.
  //
  // The generation counter covers what separation cannot: two searches can be
  // in flight at once (the debounce cancels pending timers, not requests), so
  // an older response could still land over a newer query's results. Each
  // search interaction takes the next number, and a completion carrying an
  // older one is stale by definition and drops.
  const searchGeneration = useRef(0);
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
  //
  // Wait-for-quiet at the provider level does NOT protect this. It defers
  // reconciliation while the operator is typing, and the case that broke was
  // an operator who had already stopped: they typed a markup, tabbed away, and
  // a reconcile caused by a DIFFERENT row's save reset this row from the store
  // before the pending edit had been persisted. The edit vanished with no
  // error and never reached the database (costs-reconciliation-ordering).
  //
  // Dirty state is what protects it now: while the operator holds an
  // uncommitted markup, the store does not get to overwrite it. Identity
  // change still resets, because that is a different line.
  // A different line is a different control, so its search interaction resets.
  // This is the ONLY non-gesture path allowed to touch search state.
  useEffect(() => {
    setVendorSearchState(storeVendorName ?? "", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.lineGroupId]);

  useEffect(() => {
    setVendorId(storeVendorId);
    setVendorName(storeVendorName);
    setCategory(storeCategory);
    // canonicalRef always tracks server truth -- it is the rollback target --
    // but the VISIBLE value stays the operator's while their edit is pending.
    if (!markupDirtyRef.current) setMarkupPct(storeMarkupPct);
    canonicalRef.current = {
      vendorId: storeVendorId,
      vendorName: storeVendorName,
      category: storeCategory,
      markupPct: storeMarkupPct,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    line.lineGroupId,
    storeVendorId,
    storeVendorName,
    storeCategory,
    storeMarkupPct,
  ]);

  useEffect(
    () => () => {
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
        // Same boundary as the success path: a rollback restores the vendor
        // DATA. It is still an asynchronous completion, so it does not get to
        // reach into a search the operator has since started.
        setCategory(previous.category);
        setMarkupPct(previous.markupPct);
        setMarkupDirty(false);
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
      // Persisted. The operator's value is now the store's value, so
      // synchronisation resumes.
      setMarkupDirty(false);
      setVendorId(result.data.pricingVendorHubspotCompanyId);
      setVendorName(result.data.pricingVendorNameSnapshot);
      // Deliberately does NOT set the query or leave edit mode. Every gesture
      // that changes the vendor already set both, at the moment it was made --
      // Clear empties the query once, select fills it with the chosen name.
      // Repeating it here adds nothing except the chance to arrive late and
      // overwrite whatever the operator has typed since.
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

  /**
   * Commit a typed markup on blur or Enter.
   *
   * Replaces a change-debounced save. A debounce is a rendering convenience
   * and was never a persistence guarantee: the edit lived only inside a
   * pending timer, so anything that re-rendered the row first destroyed it.
   * Category and vendor keep their immediate-on-change semantics -- they are
   * chosen, not typed, and there is no partial value to protect.
   */
  function commitMarkup() {
    if (!markupDirtyRef.current) return;
    if (markupPct === canonicalRef.current.markupPct) {
      setMarkupDirty(false);
      return;
    }
    fireMetaSave({ markupPct });
  }

  /**
   * Set the search interaction. The ONLY way search state changes, other than
   * a keystroke.
   *
   * Bumping the generation is what makes leaving a search final: an in-flight
   * request would otherwise return and repopulate the results of a search the
   * operator has already abandoned.
   */
  function setVendorSearchState(nextQuery: string, editing: boolean) {
    searchGeneration.current += 1;
    setVendorQuery(nextQuery);
    setVendorEditing(editing);
    setVendorResults([]);
    setVendorSearchComplete(false);
  }

  function scheduleVendorSearch(query: string) {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    // Every keystroke supersedes whatever was in flight, so it takes the next
    // generation. Results carrying an older one belong to a query the operator
    // has already moved past.
    const generation = ++searchGeneration.current;
    if (query.trim().length < 2) {
      setVendorResults([]);
      setVendorSearchComplete(false);
      return;
    }
    setVendorSearchComplete(false);
    searchDebounce.current = setTimeout(() => {
      startSearchTransition(async () => {
        try {
          const results = await searchPricingVendors(query);
          if (generation !== searchGeneration.current) return;
          setVendorResults(results);
          setVendorSearchComplete(true);
          setVendorError(null);
        } catch {
          if (generation !== searchGeneration.current) return;
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
              // Chosen, not typed, and written in the same call -- so the
              // auto-filled markup is committed, not dirty.
              setMarkupDirty(false);
              fireMetaSave({ category: v, markupPct: cat.defaultMarkupPct });
            } else {
              fireMetaSave({ category: v });
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
                  onClick={() => setVendorSearchState("", true)}
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
                    // The query is emptied here, once, by the gesture that
                    // means it. The save's completion no longer repeats it.
                    setVendorSearchState("", false);
                    fireMetaSave({ vendorId: null, vendorName: null });
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
                onClick={() => setVendorSearchState(vendorName ?? "", false)}
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
                  setVendorSearchState(vendor.name, false);
                  // Vendor selection is a choice, so it commits on the click
                  // that makes it -- immediate, not debounced.
                  fireMetaSave({
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

      {/* Markup % chip — inline editable number.

          AN EMPTY FIELD DOES NOT MEAN NO MARKUP. When a line carries no
          explicit rate the engine resolves one — line override, then category
          default, then Other, then a firm fallback — and prices the quote with
          it. This column used to render `—` regardless, which was survivable
          only while the landed value was ALSO computed at zero: the row was
          consistently wrong, so nothing looked odd.

          Correcting the landed value made the contradiction visible — cost
          2.50, markup —, landed 3.25 — and the contradiction was the honest
          signal. The rate applies either way; the column simply was not saying
          so.

          The inherited rate now shows as the PLACEHOLDER, which keeps the two
          states distinguishable: a filled field is an override this line owns,
          an empty one shows what it inherits. The tooltip names the rung the
          engine actually chose, read from the resolution node's own record of
          the decision rather than re-derived. */}
      <div className="num">
        {/* Placeholder styling alone was measured at alpha 0.5 on the same
            colour, at 10.5px — real, and too quiet to be the only signal that a
            commercial rate is inherited rather than set. The dashed underline is
            the register already used for synthetic-visible values elsewhere
            (Pattern 45's `<Stub>`), so it reads as "this is not a value someone
            entered" without inventing new vocabulary. */}
        <span
          className="markup"
          style={
            isInheriting
              ? {
                  fontStyle: "italic",
                  borderBottom: "1px dashed var(--rule-2)",
                }
              : undefined
          }
          title={
            isInheriting
              ? `No markup set on this line. ${((inheritedMarkup ?? 0) * 100).toFixed(0)}% applies` +
                `${inheritedSource ? `, from ${inheritedSource}` : ""}. Type to override.`
              : undefined
          }
        >
          <input
            type="number"
            step="0.01"
            min={0}
            // Stored as a decimal, entered as a percent -- and `0.07 * 100`
            // is 7.000000000000001, which is what the operator would read in
            // the box. markup_pct is numeric(5,4), so the percent it can
            // represent has at most two decimals; rounding there is exact
            // rather than cosmetic.
            value={
              markupPct === ""
                ? ""
                : String(Math.round(Number(markupPct) * 10000) / 100)
            }
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              const decimal = v === "" ? "" : (Number(v) / 100).toString();
              setMarkupPct(decimal);
              setMarkupDirty(true);
            }}
            onBlur={commitMarkup}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder={
              inheritedMarkup !== null ? (inheritedMarkup * 100).toFixed(0) : "—"
            }
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
          markupDirty={markupDirty}
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

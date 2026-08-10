"use client";

// A-2 · the provenance overlay, mounted once and read everywhere.
//
// The capability is `src/lib/pricing-provenance.ts`; this is the seam that puts
// its answer where three surfaces can read it. The trace, CellAction's override
// attribution and applied-lift provenance are three questions with ONE answer,
// so they resolve against one map rather than each running a lookup — three
// implementations of "who set this" would be three chances to disagree.
//
// ── WHY IT LOADS SEPARATELY FROM THE BUNDLE ───────────────────────────────
//
// Measured, not assumed. Against production quotes the loader costs 326-357ms
// for 28-41 entity ids — real money on a path every Pricing and Costs render
// already pays for `getCostingBundle`. A-2's own note says the provenance
// queries are the likely cost and should be measured before adoption, so this
// fetches AFTER first paint and the surface renders unattributed until it
// lands. Attribution arriving a moment late is not a defect; a slower page is.
//
// ── WHY IT SURVIVES OPTIMISTIC EDITS ──────────────────────────────────────
//
// The client rebuilds the graph on every keystroke that touches a cost. A
// provenance field baked into the graph would vanish on the first one. The map
// is keyed by node key and merged at read time, so it outlives every rebuild —
// it was never part of what gets rebuilt.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CostingNode } from "@/lib/costing-nodes";
import {
  PROVENANCE_INPUTS,
  emptyIdentityIndex,
  hydrateIdentityIndex,
  indexRecords,
  originForKey,
  resolveProvenance,
  withProvenance,
  type ProvenanceMap,
} from "@/lib/pricing-provenance";
import {
  loadQuoteProvenance,
  type QuoteProvenance,
} from "@/app/actions/pricing-provenance";
import { useCostingStore } from "@/components/costing-store-provider";
import { selectGraph } from "@/lib/costing-store";

type Loaded = {
  raw: QuoteProvenance;
  index: ReturnType<typeof hydrateIdentityIndex>;
};

const Ctx = createContext<Loaded | null>(null);

export function PricingProvenanceProvider({
  quoteId,
  children,
}: {
  quoteId: string;
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    void loadQuoteProvenance(quoteId).then((r) => {
      // A failed load leaves every terminal thin, which is exactly what the
      // surface showed before A-2 and is a true statement either way. It is
      // not surfaced as an error because "we could not say who set this" is
      // already what the trace renders.
      if (!live || !r.ok) return;
      setLoaded({ raw: r.data, index: hydrateIdentityIndex(r.data.index) });
    });
    return () => {
      live = false;
    };
  }, [quoteId]);

  return <Ctx.Provider value={loaded}>{children}</Ctx.Provider>;
}

/**
 * The resolved map for the CURRENT graph.
 *
 * Recomputed when either side moves — a new graph has new node keys, and new
 * records have new answers. Both are cheap: the walk is over nodes already in
 * memory and the records are already indexed.
 */
export function usePricingProvenance(): ProvenanceMap | null {
  const loaded = useContext(Ctx);
  const graph = useCostingStore(selectGraph);
  return useMemo(() => {
    if (!loaded || !graph) return null;
    return resolveProvenance(graph.nodes, loaded.index, loaded.raw.records);
  }, [loaded, graph]);
}

/**
 * A graph with attribution merged in.
 *
 * Returns the SAME node objects where nothing resolved, so an unattributed
 * graph costs nothing and reference equality still holds for consumers that
 * depend on it.
 */
export function useProvenantNodes(nodes: readonly CostingNode[]): CostingNode[] {
  const map = usePricingProvenance();
  return useMemo(
    () => nodes.map((n) => withProvenance(n, map)),
    [nodes, map],
  );
}

/**
 * One node key's attribution, for a surface that wants a sentence rather than a
 * chain — CellAction naming who set a direct price, and who applied a lift.
 *
 * Goes through the same resolver as the trace. A second lookup here is exactly
 * the duplication this provider exists to prevent.
 */
export function useOriginFor(nodeKey: string | null) {
  const loaded = useContext(Ctx);
  return useMemo(() => {
    if (!loaded || !nodeKey) return null;
    const o = originForKey(
      nodeKey,
      loaded.index,
      indexRecords(loaded.raw.records),
    );
    // Thin is not worth rendering as a sentence — "set by nobody, at no time"
    // is noise where the trace's own thin treatment is a considered absence.
    return o.grade === "sourced" ? o : null;
  }, [loaded, nodeKey]);
}

/**
 * Who last moved the QUOTE-WIDE adjustment, and when.
 *
 * The graph carries the adjustment per cell, so there is no single node key for
 * the lever itself. Rather than synthesise one — a key nothing emits is a key
 * that resolves by accident or not at all — this asks the overlay for the
 * quote-scoped record directly, through the same spec table and the same
 * records every other read uses.
 *
 * Null while the overlay loads, and null when nothing recorded an author.
 */
export function useQuoteAdjustmentOrigin() {
  const loaded = useContext(Ctx);
  return useMemo(() => {
    if (!loaded) return null;
    const spec = PROVENANCE_INPUTS.global_price_adj;
    const rec = indexRecords(loaded.raw.records).get(
      `${spec.entityType}::${loaded.index.quoteId}`,
    );
    return rec?.actor ? { actor: rec.actor, when: rec.when } : null;
  }, [loaded]);
}

/** For a surface that wants to say the overlay has not arrived yet. */
export function useProvenanceLoaded(): boolean {
  return useContext(Ctx) !== null;
}

/** Exported for tests that need an index without a database. */
export { emptyIdentityIndex };

"use client";

import { Fragment, useCallback, useMemo, useState, useTransition } from "react";
import type { UnitTargets } from "@/lib/client-target";
import type { TargetTier } from "./client-target";
import type { AssemblyTree } from "@/lib/assembly-tree";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import { AsyRow } from "./asy-row";
import { DirectProductRow } from "./direct-product-row";
import { attachDragProxy } from "./drag-proxy";
import {
  applyOptimisticMove,
  moveSettled,
  type OptimisticMove,
} from "@/lib/product-structure/optimistic-structure";
import {
  indicatorAnchor,
  isNoOpDrop,
  resolveDropIndex,
  sameZone,
  type DropPlan,
  type DropZone,
} from "@/lib/product-structure/drop-plan";
import {
  moveProductMembership,
  reorderAssemblies,
} from "@/app/actions/assemblies";
import { useRouter } from "next/navigation";

// Phase A.1 v2 impl-2 Step 9 — Drag-to-reorder ASY rows.
//
// Mirrors src/app/projects/[id]/quotes/[quoteId]/sku-row-list.tsx
// pattern (HTML5 native drag-and-drop + optimistic order during drag
// + server action on drop + revalidation snaps back to canonical
// order). Per CLAUDE.md "Form state pattern" / Pattern 47: state is
// controlled; the server action is fire-and-forget within a
// transition; rollback on error clears optimistic state and surfaces
// the error inline.
//
// LEAF reorder within an ASY is handled inside AsyRow; this wrapper
// only manages ASY-level reorder.

export function AssemblyTreeBody({
  tree,
  editable,
  projectId,
  quoteId,
  assemblies,
  fullLeafTypes,
  permissions,
  tiers,
  targetsByUnit,
}: {
  tree: AssemblyTree;
  editable: boolean;
  projectId: string;
  quoteId: string;
  assemblies: { id: string; sku: string; name: string; leafCount: number }[];
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: { canCreateLeaves: boolean };
  tiers: ReadonlyArray<TargetTier>;
  /** Resolved-ready targets, indexed by sellable-unit id at the tree root. */
  targetsByUnit: ReadonlyMap<string, UnitTargets>;
}) {
  const serverOrder = useMemo(
    () => tree.assemblies.map((a) => a.id),
    [tree.assemblies],
  );
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const router = useRouter();
  const [, startReorderTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const orderedAssemblies = useMemo(() => {
    if (!optimisticOrder) return tree.assemblies;
    const byId = new Map(tree.assemblies.map((a) => [a.id, a] as const));
    return optimisticOrder
      .map((id) => byId.get(id))
      .filter((a): a is (typeof tree.assemblies)[number] => !!a);
  }, [tree.assemblies, optimisticOrder]);

  function handleAsyDragStart(e: React.DragEvent, id: string) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.setData(
      "application/x-a1v2-drag-kind",
      "assembly",
    );
    setDragId(id);
  }

  function handleAsyDragOver(e: React.DragEvent, overId: string) {
    if (!editable || !dragId || dragId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const order = optimisticOrder ?? serverOrder;
    const fromIdx = order.indexOf(dragId);
    const toIdx = order.indexOf(overId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    const insertAt = above ? toIdx : toIdx + 1;
    const adjusted = insertAt > fromIdx ? insertAt - 1 : insertAt;
    if (adjusted === fromIdx) return;

    const next = order.slice();
    next.splice(fromIdx, 1);
    next.splice(adjusted, 0, dragId);
    setOptimisticOrder(next);
  }

  function handleAsyDragEnd() {
    if (!dragId) return;
    const order = optimisticOrder;
    setDragId(null);
    if (!order) return;
    const changed = order.some((id, i) => id !== serverOrder[i]);
    if (!changed) {
      setOptimisticOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("assemblyIds", order.join(","));
    startReorderTransition(async () => {
      setError(null);
      const result = await reorderAssemblies(fd);
      setOptimisticOrder(null);
      if (!result.ok) {
        setError(result.error.message);
      }
    });
  }

  // Direct Products render as peers of Item Groups, not inside them. They are
  // listed first because a quote-level product is the simpler structure and
  // reading it before the nested one matches how the operator built it.
  // ---- Member/product movement across structural homes.
  //
  // Held HERE rather than inside AsyRow, because the drag now crosses row
  // boundaries: A -> B, Direct -> group, group -> Direct. Per-ASY state can
  // only ever describe movement inside one group, which is why cross-group
  // movement was unreachable before.
  //
  // Reorder WITHIN a group stays where it was — that path works and is not
  // rebuilt here.
  const [movingLeafId, setMovingLeafId] = useState<string | null>(null);
  // WHERE THE PRODUCT WILL LAND — destination plus resulting index, not "which
  // row is the pointer over". Those two disagree on every downward same-list
  // drag, and the operator is being shown a promise about the former.
  const [plan, setPlan] = useState<DropPlan | null>(null);
  // The gesture's result, shown before the server confirms it. STRUCTURE ONLY —
  // see optimistic-structure.ts for why no field inside a node is touched.
  const [optimistic, setOptimistic] = useState<OptimisticMove | null>(null);
  const [, startMoveTransition] = useTransition();

  // Server truth, with the in-flight move applied. Once the refreshed tree
  // shows the product in its new home the optimistic layer stops applying, so
  // there is no flicker back to the old position and no argument with the
  // server about order.
  const view = useMemo(() => {
    const base = {
      direct: tree.directProducts,
      groups: orderedAssemblies.map((a) => ({ id: a.id, children: a.children })),
    };
    if (!optimistic || moveSettled(base, optimistic)) return base;
    return applyOptimisticMove(base, optimistic, {
      // Copy across; never compute. The two node types differ only by the
      // legacy junction id, and a moved product has no true junction id yet.
      toDirect: ({ junctionId: _drop, ...rest }) => rest,
      toMember: (d) => ({ ...d, junctionId: `optimistic:${d.quoteLeafId}` }),
    });
  }, [tree.directProducts, orderedAssemblies, optimistic]);

  const childrenOf = useCallback(
    (assemblyId: string) =>
      view.groups.find((g) => g.id === assemblyId)?.children ?? [],
    [view],
  );

  const directIds = useMemo(
    () => view.direct.map((p) => p.quoteLeafId),
    [view],
  );
  const groupMemberIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of view.groups) m.set(g.id, g.children.map((c) => c.quoteLeafId));
    return m;
  }, [view]);

  // ── Move destinations, for the MENU route ────────────────────────────
  //
  // The governed writer is `moveProductMembership` either way; this is a
  // second door onto it, not a second capability. Until now the only door was
  // a drag, which has no keyboard equivalent — so an operator who does not or
  // cannot drag was left with Remove-and-re-add, and that composition mints a
  // new `quote_leaves.id` and cascades the product's costs away. The safe
  // route being harder to reach than the destructive one is the defect.
  const moveDestinations = useMemo(
    () =>
      orderedAssemblies.map((a) => ({
        target: a.id,
        label: a.name,
        // Append. A menu move states a destination, not a rank, so it lands at
        // the end rather than guessing an insertion point the operator never
        // expressed.
        position: (view.groups.find((g) => g.id === a.id)?.children.length ?? 0),
      })),
    [orderedAssemblies, view],
  );

  const directDestination = useMemo(
    () => ({ target: "direct", label: "Quote level (no item group)", position: view.direct.length }),
    [view],
  );

  /**
   * Move via the menu. Same action, same refusal handling, same refresh as the
   * drop path — deliberately NOT an optimistic reshuffle, because a menu move
   * has no gesture whose result the operator is already watching.
   */
  const moveViaMenu = useCallback(
    (quoteLeafId: string, target: string, position: number) => {
      const fd = new FormData();
      fd.set("quoteLeafId", quoteLeafId);
      fd.set("target", target);
      fd.set("position", String(position));
      startMoveTransition(async () => {
        setError(null);
        const result = await moveProductMembership(fd);
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        router.refresh();
      });
    },
    [router],
  );

  const siblingsFor = useCallback(
    (zone: DropZone): string[] =>
      zone.kind === "direct" ? directIds : (groupMemberIds.get(zone.assemblyId) ?? []),
    [directIds, groupMemberIds],
  );

  /** The home the product is being dragged OUT of — needed to detect no-ops. */
  const movingHome = useMemo<DropZone | null>(() => {
    if (!movingLeafId) return null;
    if (directIds.includes(movingLeafId)) return { kind: "direct" };
    for (const [assemblyId, ids] of groupMemberIds)
      if (ids.includes(movingLeafId)) return { kind: "group", assemblyId };
    return null;
  }, [movingLeafId, directIds, groupMemberIds]);

  function beginMove(
    e: React.DragEvent,
    quoteLeafId: string,
    name: string,
    sku: string | null,
  ) {
    if (!editable) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", quoteLeafId);
    e.dataTransfer.setData("application/x-a1v2-drag-kind", "member");
    e.stopPropagation();
    attachDragProxy(e, name, sku);
    setMovingLeafId(quoteLeafId);
  }

  const proposePlan = useCallback(
    (zone: DropZone, overId: string | null, edge: "before" | "after") => {
      if (!movingLeafId) return;
      const index = resolveDropIndex({
        siblings: siblingsFor(zone),
        movingId: movingLeafId,
        overId,
        edge,
      });
      const next: DropPlan = { zone, index };
      // A destination that persists the structure that already exists is not a
      // destination. No line, and the drop below becomes a no-op.
      if (
        isNoOpDrop({
          plan: next,
          currentZone: movingHome,
          currentSiblings: movingHome ? siblingsFor(movingHome) : [],
          movingId: movingLeafId,
        })
      ) {
        setPlan(null);
        return;
      }
      setPlan((prev) =>
        prev && sameZone(prev.zone, next.zone) && prev.index === next.index
          ? prev
          : next,
      );
    },
    [movingLeafId, movingHome, siblingsFor],
  );

  /** Hovering a product row — the precise case. Midpoint decides the edge. */
  function overProductRow(
    e: React.DragEvent,
    zone: DropZone,
    overQuoteLeafId: string,
  ) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    proposePlan(zone, overQuoteLeafId, edge);
  }

  /** Hovering a destination but no particular row — append. */
  function overZoneTail(e: React.DragEvent, zone: DropZone) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    proposePlan(zone, null, "after");
  }

  /** The group HEADER sits above its members, so it reads as position zero. */
  function overGroupHeader(e: React.DragEvent, assemblyId: string) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const zone: DropZone = { kind: "group", assemblyId };
    const first = siblingsFor(zone).find((id) => id !== movingLeafId) ?? null;
    proposePlan(zone, first, "before");
  }

  function commitDrop(e: React.DragEvent) {
    if (!editable || !movingLeafId) return;
    e.preventDefault();
    e.stopPropagation();
    const quoteLeafId = movingLeafId;
    const target = plan;
    setMovingLeafId(null);
    setPlan(null);
    setActiveLane(null);
    // No indicator was showing, so nothing was promised. Releasing over an
    // invalid destination returns the product to where it already is.
    if (!target) return;

    const fd = new FormData();
    fd.set("quoteLeafId", quoteLeafId);
    fd.set(
      "target",
      target.zone.kind === "direct" ? "direct" : target.zone.assemblyId,
    );
    fd.set("position", String(target.index));
    // Show the result of the gesture NOW. Structure only — the server stays
    // authoritative for persistence and for every dependent economic value,
    // including the per-SKU cost attribution that legitimately moves with
    // membership and therefore must not be guessed here.
    setOptimistic({
      quoteLeafId,
      zone: target.zone,
      index: target.index,
    });
    startMoveTransition(async () => {
      setError(null);
      const result = await moveProductMembership(fd);
      // No optimistic reshuffle. A move crosses a governed boundary, so the
      // tree redraws from what the server actually did rather than from what
      // the drop implied — a failed move must not leave the operator looking
      // at a structure that does not exist.
      if (!result.ok) {
        // Roll back visibly. A refused move that left the optimistic structure
        // on screen would be the one outcome worse than the dead period this
        // replaces: the operator believes a structure exists that does not.
        setOptimistic(null);
        setError(result.error.message);
        return;
      }
      // Kept applied until the refreshed tree shows the product in its new
      // home — `moveSettled` retires it. Clearing here would snap the row back
      // to its old position for the length of the round trip.
      router.refresh();
    });
  }

  function endMove() {
    setMovingLeafId(null);
    setPlan(null);
    setActiveLane(null);
  }

  // Which row carries the line, and on which edge.
  const anchor = useMemo(() => {
    if (!plan || !movingLeafId) return null;
    return indicatorAnchor(siblingsFor(plan.zone), movingLeafId, plan.index);
  }, [plan, movingLeafId, siblingsFor]);

  const dropEdgeFor = useCallback(
    (zone: DropZone, quoteLeafId: string): "before" | "after" | null => {
      // Root destinations are drawn by the lanes below, not on the row. Both
      // mechanisms would light for the same plan and paint two lines.
      if (zone.kind === "direct") return null;
      if (!plan || !anchor || !sameZone(plan.zone, zone)) return null;
      return anchor.overId === quoteLeafId ? anchor.edge : null;
    },
    [plan, anchor],
  );

  /** Propose an exact index, for a target that already knows its position. */
  const proposePlanAt = useCallback(
    (zone: DropZone, index: number) => {
      if (!movingLeafId) return;
      const next: DropPlan = { zone, index };
      if (
        isNoOpDrop({
          plan: next,
          currentZone: movingHome,
          currentSiblings: movingHome ? siblingsFor(movingHome) : [],
          movingId: movingLeafId,
        })
      ) {
        setPlan(null);
        return;
      }
      setPlan((prev) =>
        prev && sameZone(prev.zone, next.zone) && prev.index === next.index
          ? prev
          : next,
      );
    },
    [movingLeafId, movingHome, siblingsFor],
  );

  /**
   * ROOT INSERTION LANES.
   *
   * The root destination used to be the tree container's blank background.
   * With Item Groups occupying the full width and most of the height there is
   * almost none of it, so Group -> Direct was implemented, proven, and
   * unreachable — the operator had to discover a few pixels of nothing.
   *
   * A lane sits at each root slot and carries the SAME insertion line the rest
   * of the surface uses, so the cue means what it already means: the product
   * becomes Direct AT THIS EXACT POSITION. Not "make it Direct somewhere".
   *
   * Lanes exist only while a move is in flight — during a drag they are the
   * target, and the rest of the time they are not in the DOM at all.
   *
   * Indices count NON-MOVING rows, because `resolveDropIndex` resolves against
   * the list with the dragged row removed. Emitting a lane before the moving
   * row too would produce two lanes holding one index, and both would light.
   */
  const rootLaneIndexBefore = useMemo(() => {
    const map = new Map<string, number>();
    let k = 0;
    for (const id of directIds) {
      if (id === movingLeafId) continue;
      map.set(id, k);
      k += 1;
    }
    return { map, tail: k };
  }, [directIds, movingLeafId]);

  // Which lane is LIT. Tracked by lane id, not by index: two lanes legitimately
  // hold the append index — one above the Item Groups where a root append
  // actually lands, one below them where the outward gesture ends — and keying
  // the highlight on the index would light both for a single destination.
  const [activeLane, setActiveLane] = useState<string | null>(null);

  const acquireLane = useCallback(
    (laneId: string, index: number) => {
      setActiveLane(laneId);
      proposePlanAt({ kind: "direct" }, index);
    },
    [proposePlanAt],
  );

  const isEmpty =
    orderedAssemblies.length === 0 && tree.directProducts.length === 0;

  return (
    <div
      className={`a1v2-tree${plan?.zone.kind === "direct" ? " drop-active" : ""}`}
      onDragEnd={() => {
        handleAsyDragEnd();
        endMove();
      }}
      // The tree body IS the Direct/root drop zone. No separate dropzone
      // element is introduced — the existing container communicates it, and a
      // permanent "drop here" affordance would be chrome the operator has to
      // read past on every render.
      onDragOver={(e) => overZoneTail(e, { kind: "direct" })}
      onDrop={commitDrop}
    >
      {isEmpty ? (
        <p className="r7b-empty-state">
          {editable
            ? "Nothing on this quote yet · use Add Product for a single product, or Create Item Group to sell several together."
            : "No products."}
        </p>
      ) : (
        <>
          {view.direct.map((product) => (
            <Fragment key={product.quoteLeafId}>
              {rootLaneIndexBefore.map.has(product.quoteLeafId) ? (
                <RootLane
                  laneId={`before:${product.quoteLeafId}`}
                  index={rootLaneIndexBefore.map.get(product.quoteLeafId)!}
                  active={activeLane === `before:${product.quoteLeafId}`}
                  editable={editable}
                  dragging={!!movingLeafId}
                  onAcquire={acquireLane}
                  onDrop={commitDrop}
                />
              ) : null}
            <DirectProductRow
              key={product.quoteLeafId}
              product={product}
              editable={editable}
              quoteId={quoteId}
              tiers={tiers}
              targets={targetsByUnit.get(product.quoteLeafId)}
              isMoving={movingLeafId === product.quoteLeafId}
              pending={optimistic?.quoteLeafId === product.quoteLeafId}
              onMoveStart={(e) =>
                beginMove(e, product.quoteLeafId, product.name, product.sku)
              }
              dropEdge={dropEdgeFor({ kind: "direct" }, product.quoteLeafId)}
              onRowDragOver={(e) =>
                overProductRow(e, { kind: "direct" }, product.quoteLeafId)
              }
              onRowDrop={commitDrop}
              moveDestinations={moveDestinations}
              onMove={(target, position) =>
                moveViaMenu(product.quoteLeafId, target, position)
              }
              editSpecsHref={`/projects/${projectId}/quotes/${quoteId}/leaves/${product.leafId}/specs`}
            />
            </Fragment>
          ))}
          {/* The tail slot — appending to root. Sits directly above the Item
              Groups, which is exactly where a root append lands, since Direct
              Products always render before groups. */}
          <RootLane
            laneId="tail:above-groups"
            index={rootLaneIndexBefore.tail}
            active={activeLane === "tail:above-groups"}
            editable={editable}
            dragging={!!movingLeafId}
            onAcquire={acquireLane}
            onDrop={commitDrop}
          />
          {orderedAssemblies.map((asy) => (
            <AsyRow
              key={asy.id}
              asy={{ ...asy, children: childrenOf(asy.id) }}
              editable={editable}
              projectId={projectId}
              quoteId={quoteId}
              tiers={tiers}
              targets={targetsByUnit.get(asy.id)}
              isDragging={dragId === asy.id}
              onDragStart={(e) => handleAsyDragStart(e, asy.id)}
              onDragOver={(e) => handleAsyDragOver(e, asy.id)}
              movingLeafId={movingLeafId}
              pendingLeafId={optimistic?.quoteLeafId ?? null}
              isDropTarget={
                plan?.zone.kind === "group" && plan.zone.assemblyId === asy.id
              }
              // Empty group: there is no member row to anchor the line to, so
              // the header carries it.
              showTailIndicator={
                plan?.zone.kind === "group" &&
                plan.zone.assemblyId === asy.id &&
                anchor?.overId === null
              }
              memberDropEdge={(quoteLeafId) =>
                dropEdgeFor({ kind: "group", assemblyId: asy.id }, quoteLeafId)
              }
              memberMoveDestinations={[
                ...moveDestinations.filter((d) => d.target !== asy.id),
                directDestination,
              ]}
              onMemberMove={moveViaMenu}
              onMemberDragStart={beginMove}
              onMemberRowDragOver={(e, quoteLeafId) =>
                overProductRow(e, { kind: "group", assemblyId: asy.id }, quoteLeafId)
              }
              onMemberDragOverGroup={(e) => overGroupHeader(e, asy.id)}
              onMemberDragOverGroupTail={(e) =>
                overZoneTail(e, { kind: "group", assemblyId: asy.id })
              }
              onMemberDropOnGroup={commitDrop}
              assemblies={assemblies}
              fullLeafTypes={fullLeafTypes}
              permissions={permissions}
            />
          ))}
          {/* The OUTWARD gesture. Dragging a member out of a group is naturally
              downward-and-left or straight down; before this there was nothing
              below the groups to land on, so the only root target was above
              them — the operator had to drag UP past the group they were
              leaving. Same append index as the lane above the groups; the
              highlight is keyed by lane id so only the one under the pointer
              lights. */}
          <RootLane
            laneId="tail:below-groups"
            index={rootLaneIndexBefore.tail}
            active={activeLane === "tail:below-groups"}
            editable={editable}
            dragging={!!movingLeafId}
            onAcquire={acquireLane}
            onDrop={commitDrop}
          />
        </>
      )}
      {error ? (
        <div
          role="alert"
          style={{
            padding: "8px 16px",
            color: "var(--bad)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          Reorder failed: {error}
        </div>
      ) : null}
    </div>
  );
}


/**
 * A root destination slot. MODULE LEVEL, and that is the fix, not a tidy-up.
 *
 * Defined inside the parent it was a NEW COMPONENT TYPE on every render. Each
 * `setPlan` during a drag — which is to say every pointer move — remounted the
 * lane, so the element under the cursor was destroyed and recreated mid-gesture
 * and the browser lost its drag target. The line appeared, then activation
 * dropped as soon as the operator moved, which reads exactly like a hit-target
 * that is too small and is not one.
 *
 * Hoisting it makes the identity stable across renders, so the node under the
 * pointer survives the whole drag.
 */
function RootLane({
  laneId,
  index,
  active,
  editable,
  dragging,
  onAcquire,
  onDrop,
}: {
  laneId: string;
  index: number;
  active: boolean;
  editable: boolean;
  dragging: boolean;
  onAcquire: (laneId: string, index: number) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  if (!dragging) return null;
  const claim = (e: React.DragEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    onAcquire(laneId, index);
  };
  return (
    <div
      className={`a1v2-root-lane${active ? " active" : ""}`}
      // dragEnter AND dragOver. Entering from inside an Item Group, the first
      // event the lane sees is dragEnter; without it the lane stays unclaimed
      // until the next dragOver tick, and a fast gesture can cross the whole
      // lane between ticks without ever acquiring it.
      onDragEnter={claim}
      onDragOver={claim}
      onDrop={onDrop}
    />
  );
}

/**
 * Optimistic STRUCTURE, and nothing else.
 *
 * A structural move crosses a governed boundary, so the original wiring refused
 * to reshuffle locally and waited for the server. That is the right instinct
 * about ECONOMICS and the wrong one about the gesture: 2–3 seconds of a row not
 * moving reads as a failed drag, and the operator drags again.
 *
 * The split this module draws is the whole point:
 *
 *   OPTIMISTIC   membership, root/group placement, visual ordering
 *   AUTHORITATIVE  everything a number depends on — cost inputs, pricing,
 *                  specs, quantities, approvals, dependent economic identity
 *
 * So the projection carries nodes ACROSS, unchanged. It never edits a field
 * inside one. A moved product shows the same quantity and the same unit cost it
 * showed a moment ago, because those are the server's to change and the server
 * has not answered yet — and per-SKU cost attribution DOES move with membership
 * (OW-10), so predicting it here would be inventing a commercial number.
 *
 * Order comes from `orderAfterMove`, the same function the mutation uses. That
 * is what makes "what you saw" and "what was written" the same claim rather
 * than two claims that happen to agree.
 */

import { orderAfterMove, type DropZone } from "./drop-plan.ts";

/** The minimum a row needs to render. Structural fields only. */
export type StructuralNode = { quoteLeafId: string };

export type StructuralView<D extends StructuralNode, M extends StructuralNode> = {
  direct: D[];
  groups: { id: string; children: M[] }[];
};

export type OptimisticMove = {
  quoteLeafId: string;
  zone: DropZone;
  index: number;
};

/**
 * Where a product currently lives. `null` when it is not in the tree at all.
 */
export function homeOf(
  view: StructuralView<StructuralNode, StructuralNode>,
  quoteLeafId: string,
): DropZone | null {
  if (view.direct.some((d) => d.quoteLeafId === quoteLeafId))
    return { kind: "direct" };
  for (const g of view.groups)
    if (g.children.some((c) => c.quoteLeafId === quoteLeafId))
      return { kind: "group", assemblyId: g.id };
  return null;
}

/**
 * Apply a move to a rendered structure.
 *
 * `toDirect` / `toMember` adapt a node between the two row shapes — the types
 * differ only by the legacy junction id, and a moved node has no junction id
 * that is true yet. They must COPY, never compute: a converter that filled in a
 * value would be inventing server state.
 *
 * Returns the input unchanged if the product cannot be found, so a stale
 * optimistic move against a refreshed tree degrades to server truth rather than
 * throwing under the operator's pointer.
 */
export function applyOptimisticMove<
  D extends StructuralNode,
  M extends StructuralNode,
>(
  view: StructuralView<D, M>,
  move: OptimisticMove,
  adapt: { toDirect: (m: M) => D; toMember: (d: D) => M },
): StructuralView<D, M> {
  const from = homeOf(view, move.quoteLeafId);
  if (!from) return view;

  const directNode =
    from.kind === "direct"
      ? view.direct.find((d) => d.quoteLeafId === move.quoteLeafId)
      : undefined;
  const memberNode =
    from.kind === "group"
      ? view.groups
          .find((g) => g.id === from.assemblyId)
          ?.children.find((c) => c.quoteLeafId === move.quoteLeafId)
      : undefined;

  // Detach.
  const direct = view.direct.filter((d) => d.quoteLeafId !== move.quoteLeafId);
  const groups = view.groups.map((g) => ({
    ...g,
    children: g.children.filter((c) => c.quoteLeafId !== move.quoteLeafId),
  }));

  if (move.zone.kind === "direct") {
    const node = directNode ?? (memberNode ? adapt.toDirect(memberNode) : null);
    if (!node) return view;
    const order = orderAfterMove(
      direct.map((d) => d.quoteLeafId),
      move.quoteLeafId,
      move.index,
    );
    const byId = new Map<string, D>(direct.map((d) => [d.quoteLeafId, d]));
    byId.set(move.quoteLeafId, node);
    return { direct: order.map((id) => byId.get(id)!), groups };
  }

  const node = memberNode ?? (directNode ? adapt.toMember(directNode) : null);
  if (!node) return view;
  const targetId = move.zone.assemblyId;
  return {
    direct,
    groups: groups.map((g) => {
      if (g.id !== targetId) return g;
      const order = orderAfterMove(
        g.children.map((c) => c.quoteLeafId),
        move.quoteLeafId,
        move.index,
      );
      const byId = new Map<string, M>(g.children.map((c) => [c.quoteLeafId, c]));
      byId.set(move.quoteLeafId, node);
      return { ...g, children: order.map((id) => byId.get(id)!) };
    }),
  };
}

/**
 * Has server truth caught up with the optimistic move?
 *
 * Compares ZONE only, deliberately. Once the product is in the right home the
 * server owns the ordering, and holding the optimistic order until the index
 * also matched would make the UI argue with the authority it just deferred to.
 */
export function moveSettled(
  view: StructuralView<StructuralNode, StructuralNode>,
  move: OptimisticMove,
): boolean {
  const home = homeOf(view, move.quoteLeafId);
  if (!home) return false;
  if (home.kind === "direct" || move.zone.kind === "direct")
    return home.kind === move.zone.kind;
  return home.assemblyId === move.zone.assemblyId;
}

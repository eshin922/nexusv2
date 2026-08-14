/**
 * The ordering rule for structural drag/drop — ONE definition, used twice.
 *
 * WHY THIS IS A SHARED MODULE AND NOT TWO IMPLEMENTATIONS
 *
 * The insertion indicator promises the operator a specific resulting position.
 * That promise is only true if the line is computed from the same rule the
 * mutation persists. Two implementations that agree today drift the moment one
 * of them is touched, and the failure is silent: the line says one thing, the
 * server does another, and the operator finds out after the release.
 *
 * So `orderAfterMove` is the rule. The client calls it to decide where to draw;
 * `moveStructuralMembership` calls it to decide what to write. Neither owns it.
 *
 * A NOTE ON WHY POSITIONS ARE REWRITTEN AT ALL
 *
 * The move primitive used to set `position` on the moved row only. Rendering
 * orders by `(position, created_at)`, so writing position 1 next to an existing
 * position 1 produced a TIE broken by creation time — an order the client cannot
 * predict and the operator did not choose. Dense renumbering of the destination
 * makes position a total order, which is the precondition for the indicator
 * being able to tell the truth.
 */

export type DropZone =
  | { kind: "group"; assemblyId: string }
  | { kind: "direct" };

export type DropPlan = {
  zone: DropZone;
  /** Final 0-based index of the moved product within the destination list. */
  index: number;
};

/** Which row carries the line, and on which edge. `null` = empty destination. */
export type IndicatorAnchor = {
  overId: string | null;
  edge: "before" | "after";
};

export function sameZone(a: DropZone, b: DropZone): boolean {
  if (a.kind === "direct" || b.kind === "direct") return a.kind === b.kind;
  return a.assemblyId === b.assemblyId;
}

/**
 * The resulting order when `movedId` is placed at `index`.
 *
 * `others` must NOT contain `movedId` — the caller removes it, because on a
 * same-list reorder the moved row's own slot must not count toward the index.
 */
export function orderAfterMove(
  others: readonly string[],
  movedId: string,
  index: number,
): string[] {
  const clamped = Math.max(0, Math.min(Math.trunc(index), others.length));
  const next = others.slice();
  next.splice(clamped, 0, movedId);
  return next;
}

/**
 * Turn a hover into a destination index.
 *
 * `siblings` is the destination list in rendered order and MAY contain the moved
 * product (same-list reorder). `overId === null` means the pointer is over the
 * destination but not over any particular row — append.
 */
export function resolveDropIndex(args: {
  siblings: readonly string[];
  movingId: string;
  overId: string | null;
  edge: "before" | "after";
}): number {
  const others = args.siblings.filter((id) => id !== args.movingId);
  // Over the dragged row ITSELF. Not "append" — the operator has not moved
  // anywhere, so the honest answer is the slot it already occupies, which makes
  // this a no-op and suppresses the line. Treating it as append proposed a move
  // to the bottom of the list from a gesture that expressed no intent at all.
  if (args.overId === args.movingId) {
    // `indexOf` returns the first occurrence, so nothing before it is the moved
    // row — its index in `siblings` is already its index in `others`.
    const own = args.siblings.indexOf(args.movingId);
    return own < 0 ? others.length : own;
  }
  if (args.overId === null) return others.length;
  const i = others.indexOf(args.overId);
  if (i < 0) return others.length;
  return args.edge === "before" ? i : i + 1;
}

/**
 * True when the drop would persist the structure that already exists.
 *
 * Compared by RESULT, not by index: dragging a row down past exactly one
 * neighbour and dropping on its far edge produces the same list back, and the
 * indicator must not promise a change that will not happen.
 */
export function isNoOpDrop(args: {
  plan: DropPlan;
  currentZone: DropZone | null;
  currentSiblings: readonly string[];
  movingId: string;
}): boolean {
  if (!args.currentZone) return false;
  if (!sameZone(args.plan.zone, args.currentZone)) return false;
  const others = args.currentSiblings.filter((id) => id !== args.movingId);
  const next = orderAfterMove(others, args.movingId, args.plan.index);
  return (
    next.length === args.currentSiblings.length &&
    next.every((id, i) => id === args.currentSiblings[i])
  );
}

/**
 * Where to draw the line for a given plan.
 *
 * Anchored to the row that will sit AT the resulting index, so the line lands
 * between the two rows the product will end up between — rather than beside
 * whichever row the pointer happens to be over, which disagrees with the result
 * on every same-list downward drag.
 */
export function indicatorAnchor(
  siblings: readonly string[],
  movingId: string,
  index: number,
): IndicatorAnchor {
  const others = siblings.filter((id) => id !== movingId);
  if (others.length === 0) return { overId: null, edge: "before" };
  if (index >= others.length)
    return { overId: others[others.length - 1], edge: "after" };
  return { overId: others[Math.max(0, index)], edge: "before" };
}

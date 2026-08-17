/**
 * Reading a shipment's per-unit charges out of the canonical node graph.
 *
 * Extracted from the Freight panel so it can be asserted directly. It is a pure
 * function over the graph with no React in it, and the defect it carried —
 * FRT-UI-1, a $1,000 freight input at 30%% rendering as $0.0000 — was invisible
 * to every test precisely because it lived inside a JSX file and could only be
 * reached by mounting a component.
 */
import type { CostingNode } from "./costing-nodes";
import { parseNodeKey, walkGraph } from "./costing-nodes";

export type ShipmentRead = {
  freightPerUnit: number;
  dutyPerUnit: number;
  tariffPerUnit: number;
  totalPerUnit: number;
};

export const NO_SHIPMENT_READ: ShipmentRead = {
  freightPerUnit: 0,
  dutyPerUnit: 0,
  tariffPerUnit: 0,
  totalPerUnit: 0,
};

/** `${subcategoryId}\u0000${tierId}` — NUL cannot occur in a UUID. */
export function shipKey(subcategoryId: string, tierId: string): string {
  return `${subcategoryId}\u0000${tierId}`;
}

/**
 * A shipment's per-unit charges, SUMMED ACROSS ITS MEMBERS.
 *
 * FRT-UI-1. This kept one node per `(shipment, tier)` and failed closed the
 * moment a second appeared. That was right under single-owner attribution,
 * where a shipment reached the graph exactly once. The V1 distribution policy
 * emits ONE BREAK PER MEMBER, so a two-member shipment produces two nodes, they
 * collided here, both were discarded, and the cell fell back to a zeroed read —
 * rendering $0.0000 against a $1,000 freight input at 30%.
 *
 * They were never duplicates. Node keys are cell-scoped, so the two live under
 * different member leaves and are distinct nodes that happen to concern the
 * same shipment. The guard conflated "same shipment" with "same node".
 *
 * Summing is what the shipment's per-unit freight IS: each member carries its
 * share, and the shipment contributes all of them. Verified against the
 * engine's own assembly rollup — 0.65 + 0.65 = 1.30, which is exactly the
 * assembly's freight sell per unit.
 *
 * The real duplicate guard survives, moved to where duplication would actually
 * be a defect: the same node KEY reached twice, which is a graph violation
 * rather than a distribution.
 */
export function readShipmentNodes(nodes: readonly CostingNode[]): Map<string, ShipmentRead> {
  const contributors = new Map<string, CostingNode[]>();
  const seenKeys = new Set<string>();
  const duplicatedKeys = new Set<string>();
  for (const root of nodes) {
    walkGraph(root, (n) => {
      const a = parseNodeKey(n.key);
      if (!a || a.scope !== "cell") return;
      if (a.path.length !== 3 || a.path[0] !== "frt" || a.path[1] !== "shipment") return;
      if (seenKeys.has(n.key)) {
        duplicatedKeys.add(n.key);
        return;
      }
      seenKeys.add(n.key);
      const k = shipKey(a.path[2], a.tierId);
      contributors.set(k, [...(contributors.get(k) ?? []), n]);
    });
  }
  const out = new Map<string, ShipmentRead>();
  for (const [k, members] of contributors) {
    // Fail closed on a genuinely duplicated node, not on a distributed one.
    if (members.some((n) => duplicatedKeys.has(n.key))) continue;
    const charge = (node: CostingNode, name: string) => {
      const hit = (node.operands ?? []).find((o) => {
        const a = parseNodeKey(o.key);
        return a?.path.length === 4 && a.path[3] === name;
      });
      return hit ? hit.value : 0;
    };
    out.set(k, {
      freightPerUnit: members.reduce((acc, n) => acc + charge(n, "freight"), 0),
      dutyPerUnit: members.reduce((acc, n) => acc + charge(n, "duty"), 0),
      tariffPerUnit: members.reduce((acc, n) => acc + charge(n, "tariff"), 0),
      totalPerUnit: members.reduce((acc, n) => acc + n.value, 0),
    });
  }
  return out;
}

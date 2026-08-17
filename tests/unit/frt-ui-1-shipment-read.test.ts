/**
 * FRT-UI-1 · a priced shipment cannot render $0.0000.
 *
 * OBSERVED. Freight input 1000 at one tier and 9000 at another, markup 30%,
 * calculated sell $0.0000 on both. Costing had the right numbers throughout —
 * Pricing showed the markup applied correctly — so this was the Freight panel's
 * read, not the arithmetic.
 *
 * THE CAUSE, and why it appeared exactly now. `readShipmentNodes` kept one node
 * per (shipment, tier) and failed closed the moment a second appeared. Correct
 * under single-owner attribution, where a shipment reached the graph once. The
 * V1 distribution policy emits ONE BREAK PER MEMBER, so a two-member shipment
 * produces two nodes; they collided, both were discarded, and the cell fell
 * back to a zeroed read.
 *
 * They were never duplicates — node keys are cell-scoped, so the two live under
 * different member leaves. The guard conflated "same shipment" with "same node".
 *
 * Nothing about freight arithmetic, markup authority, costing nodes, Price
 * Build, the PDF or NetSuite is touched by the repair or by these tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CostingNode } from "../../src/lib/costing-nodes.ts";
import {
  NO_SHIPMENT_READ,
  readShipmentNodes,
  shipKey,
} from "../../src/lib/freight-shipment-read.ts";

const SHIP = "ship-1";
const TIER = "tier-1";

/** One member leaf's share of a shipment, shaped as the engine emits it. */
function memberNode(skuId: string, freight: number, duty = 0, tariff = 0): CostingNode {
  const base = `${skuId}/${TIER}/frt/shipment/${SHIP}`;
  return {
    key: base,
    kind: "sum",
    label: "Shipment",
    value: freight + duty + tariff,
    unit: "usd",
    op: "freight + duty + tariff",
    operands: [
      { key: `${base}/freight`, kind: "origin", label: "Freight", value: freight, unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
      { key: `${base}/duty`, kind: "origin", label: "Duty", value: duty, unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
      { key: `${base}/tariff`, kind: "origin", label: "Tariff", value: tariff, unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
    ],
  };
}

test("THE ASSERTION · a non-zero governed sell can never read as zero", () => {
  // The one that would have caught the defect. Two members, each carrying half
  // of a $1,000 shipment over 1,000 units at 30% — 0.65 apiece.
  const read = readShipmentNodes([memberNode("leaf-a", 0.65), memberNode("leaf-b", 0.65)])
    .get(shipKey(SHIP, TIER));
  assert.ok(read, "a priced shipment must produce a read at all");
  assert.notEqual(read.freightPerUnit, 0, "a priced shipment must never read zero");
  assert.equal(read.freightPerUnit, 1.3);
});

test("the shipment's per-unit freight is the SUM of its members' shares", () => {
  // And the sum is the whole shipment over the tier's units — the same figure
  // the panel's own comparison branch computes with memberCount 1, which is why
  // the selected and comparison rows agree rather than differing by a factor of
  // the member count.
  const three = readShipmentNodes([
    memberNode("a", 0.3), memberNode("b", 0.3), memberNode("c", 0.3),
  ]).get(shipKey(SHIP, TIER))!;
  assert.ok(Math.abs(three.freightPerUnit - 0.9) < 1e-12);
  assert.ok(Math.abs(three.totalPerUnit - 0.9) < 1e-12);
});

test("duty and tariff aggregate the same way, and stay separate charges", () => {
  const read = readShipmentNodes([
    memberNode("a", 0.65, 0.1, 0.05),
    memberNode("b", 0.65, 0.1, 0.05),
  ]).get(shipKey(SHIP, TIER))!;
  assert.equal(read.freightPerUnit, 1.3);
  assert.ok(Math.abs(read.dutyPerUnit - 0.2) < 1e-12);
  assert.ok(Math.abs(read.tariffPerUnit - 0.1) < 1e-12);
  // Not folded into freight — the panel prints "incl. d/t" from these.
  assert.notEqual(read.freightPerUnit, read.totalPerUnit);
});

test("a single-member shipment is unchanged — the repair is not a rescale", () => {
  const read = readShipmentNodes([memberNode("only", 1.3)]).get(shipKey(SHIP, TIER))!;
  assert.equal(read.freightPerUnit, 1.3);
});

test("a genuinely duplicated NODE still fails closed", () => {
  // The guard was not removed, it was moved to where duplication is actually a
  // defect: the same key reached twice is a graph violation. Dropping the read
  // is right there — a doubled node would silently double the figure.
  const dupe = memberNode("leaf-a", 0.65);
  assert.equal(readShipmentNodes([dupe, dupe]).get(shipKey(SHIP, TIER)), undefined);
});

test("an absent shipment reads as absent, and the fallback is explicit zero", () => {
  // The fallback still exists and must stay obviously zero — this test exists
  // so that if someone makes NO_SHIPMENT_READ non-zero to "fix" a display, the
  // decision is visible rather than incidental.
  assert.equal(readShipmentNodes([]).get(shipKey(SHIP, TIER)), undefined);
  assert.equal(NO_SHIPMENT_READ.freightPerUnit, 0);
});

test("only shipment nodes are read — quote-scope and price-build keys are ignored", () => {
  // `unit/{id}/{tier}/frt` and `quote/{tier}/frt` are different scopes carrying
  // different quantities. Reading one here would mix a per-unit-of-account or a
  // quote-wide figure into a per-shipment cell.
  const foreign: CostingNode[] = [
    { key: `quote/${TIER}/frt`, kind: "origin", label: "q", value: 99, unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
    { key: `unit/asy/${TIER}/frt`, kind: "origin", label: "u", value: 99, unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
  ];
  const map = readShipmentNodes([...foreign, memberNode("a", 0.65)]);
  assert.equal(map.size, 1);
  assert.equal(map.get(shipKey(SHIP, TIER))!.freightPerUnit, 0.65);
});

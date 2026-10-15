import assert from "node:assert/strict";
import test from "node:test";
import { transferFrozenLineAccountingNotes, type OrderRead } from "../../src/lib/netsuite/line-accounting-note-reconcile.ts";

const frozen = [
  { position: 0, lineKind: "item_group_member" as const, owningAssemblyId: "group-a",
    quoteLeafId: "leaf-a", netsuiteItemId: "101", displaySku: "BOTTLE", accountingNote: "Use approved frosted finish" },
  { position: 1, lineKind: "direct_product" as const, owningAssemblyId: null,
    quoteLeafId: "leaf-b", netsuiteItemId: "102", displaySku: "CARTON", accountingNote: "Confirm dieline" },
];
const before: OrderRead = {
  total: 150,
  lines: [
    { line: 0, lineUniqueKey: "1", itemId: "500", itemType: "Group", accountingNote: null, quantity: 1, rate: 0, amount: 0 },
    { line: 1, lineUniqueKey: "2", itemId: "101", itemType: "InvtPart", accountingNote: null, quantity: 100, rate: 1, amount: 100 },
    { line: 2, lineUniqueKey: "3", itemId: null, itemType: "EndGroup", accountingNote: null, quantity: null, rate: null, amount: null },
    { line: 3, lineUniqueKey: "4", itemId: "102", itemType: "InvtPart", accountingNote: null, quantity: 100, rate: .5, amount: 50 },
  ],
};

test("accounting notes reach their own grouped and direct Sales Order lines and retry skips writes", async () => {
  const current = structuredClone(before);
  const writes: number[] = [];
  const read = async () => structuredClone(current);
  const patch = async (_soId: string, address: number, note: string) => {
    writes.push(address);
    current.lines[address].accountingNote = note;
  };
  const first = await transferFrozenLineAccountingNotes("so-1", frozen, read, patch);
  assert.deepEqual(first, { status: "succeeded", expected: 2, verified: 2, errors: [] });
  assert.deepEqual(writes, [1, 3]);
  const second = await transferFrozenLineAccountingNotes("so-1", frozen, read, patch);
  assert.equal(second.status, "succeeded");
  assert.deepEqual(writes, [1, 3]);
});

test("commercial values changing during note transfer refuse verification", async () => {
  const current = structuredClone(before);
  const read = async () => structuredClone(current);
  const patch = async (_soId: string, address: number, note: string) => {
    current.lines[address].accountingNote = note;
    current.lines[address].rate = (current.lines[address].rate ?? 0) + .01;
  };
  const result = await transferFrozenLineAccountingNotes("so-1", frozen, read, patch);
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("Commercial values changed")));
});

test("ambiguous posted line identities fail before any note is written", async () => {
  const bad = structuredClone(before);
  bad.lines[3].lineUniqueKey = bad.lines[1].lineUniqueKey;
  let writes = 0;
  const result = await transferFrozenLineAccountingNotes("so-1", frozen,
    async () => structuredClone(bad), async () => { writes++; });
  assert.equal(result.status, "failed");
  assert.equal(writes, 0);
});

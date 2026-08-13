// Grouped-SO push — Step 3 executor: convergence, crash/resume, address
// authority.
//
// The provider is a FAKE that models the real one observed on the disposable
// sandbox order (SO 361241, since deleted):
//
//   SuiteQL id/seq | itemtype  | REST array pos | REST self href
//   1              | Group     | [0]            | /item/1
//   2              | InvtPart  | [1]            | /item/2
//   3              | InvtPart  | [2]            | /item/3
//   4              | EndGroup  | [3]            | /item/4
//
// The off-by-one between array position and provider address is the whole
// hazard, and it is reproduced faithfully here so the falsification is real
// rather than illustrative.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runRateConvergence,
  toObservedLines,
  type ConvergenceProvider,
  type ProviderLine,
} from "../../src/lib/netsuite/rate-convergence.ts";
import { normalizeStructure, planRateConvergence } from "../../src/lib/netsuite/so-structure.ts";

const convergenceSrc = readFileSync("src/lib/netsuite/rate-convergence.ts", "utf8");
const itemGroups = readFileSync("src/lib/netsuite/item-groups.ts", "utf8");
const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");

const TIER = 1000;
const TOTAL = 12000;

const planA = {
  assemblyId: "a", assemblySku: "OD004-CASEB-A", assemblyName: "A",
  compositionHash: "hA", externalId: "nxs-grp-hA", expectedAmount: 10000, turnkeyUnitPrice: 10,
  members: [
    { sku: "10064-GNX-Box", netsuiteItemId: "1024", quantity: 1000, qtyPerParent: 1, rate: 6, amount: 6000 },
    { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, qtyPerParent: 1, rate: 4, amount: 4000 },
  ],
} as never as import("../../src/lib/netsuite/grouping-plan.ts").PlannedGroup;

const planB = {
  assemblyId: "b", assemblySku: "OD004-CASEB-B", assemblyName: "B",
  compositionHash: "hB", externalId: "nxs-grp-hB", expectedAmount: 2000, turnkeyUnitPrice: 2,
  members: [{ sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, qtyPerParent: 1, rate: 2, amount: 2000 }],
} as never as import("../../src/lib/netsuite/grouping-plan.ts").PlannedGroup;

const PLAN = [planA, planB];
const EXPECT_HEADER = {
  customerId: "72173", hubspotDealId: "58332160883", businessSegmentId: "3", termsPresent: true,
};
const CLASSES = new Map([["1024", "10"], ["66476", "1"]]);

/**
 * Fake provider. Addresses start at 1 and the Group occupies the first one —
 * exactly as observed — so array position never equals the address.
 */
function makeProvider(opts: { failAfterNPatches?: number } = {}) {
  const lines: ProviderLine[] = [
    { line: 1, itemId: "90001", itemType: "Group", quantity: TIER, rate: null, amount: null, classId: null },
    { line: 2, itemId: "1024", itemType: "InvtPart", quantity: 1000, rate: 0, amount: 0, classId: "10" },
    { line: 3, itemId: "66476", itemType: "InvtPart", quantity: 1000, rate: 0, amount: 0, classId: "1" },
    { line: 4, itemId: "0", itemType: "EndGroup", quantity: null, rate: null, amount: 0, classId: null },
    { line: 5, itemId: "90002", itemType: "Group", quantity: TIER, rate: null, amount: null, classId: null },
    { line: 6, itemId: "66476", itemType: "InvtPart", quantity: 1000, rate: 0, amount: 0, classId: "1" },
    { line: 7, itemId: "0", itemType: "EndGroup", quantity: null, rate: null, amount: 0, classId: null },
  ];
  const patchLog: Array<{ address: number; rate: number }> = [];
  let reads = 0;

  const recomputeGroups = () => {
    // EndGroup carries Σ of its members, as the provider does.
    let sum = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (l.itemType === "EndGroup") sum = 0;
      else if (l.itemType === "Group") { /* header */ }
      else if (l.itemType === "InvtPart") sum += l.amount ?? 0;
      if (l.itemType === "Group") {
        const end = lines.slice(i).find((x) => x.itemType === "EndGroup");
        if (end) {
          end.amount = lines
            .slice(i + 1, lines.indexOf(end))
            .reduce((a, m) => a + (m.amount ?? 0), 0);
        }
      }
    }
  };

  const provider: ConvergenceProvider = {
    async readLines() {
      reads++;
      return lines.map((l) => ({ ...l }));
    },
    async readHeader() {
      return { customerId: "72173", hubspotDealId: "58332160883", businessSegmentId: "3", termsId: "2" };
    },
    async patchLine(_so, address, patch) {
      if (opts.failAfterNPatches !== undefined && patchLog.length >= opts.failAfterNPatches) {
        throw new Error("simulated interruption");
      }
      const target = lines.find((l) => l.line === address);
      if (!target) throw new Error(`no line at address ${address}`);
      target.rate = patch.rate;
      target.amount = patch.rate * (target.quantity ?? 0);
      recomputeGroups();
      patchLog.push({ address, rate: patch.rate });
    },
  };
  return { provider, patchLog, lines, reads: () => reads };
}

const run = (provider: ConvergenceProvider) =>
  runRateConvergence({
    soId: "361241", plannedGroups: PLAN, tierQty: TIER, acceptedTotal: TOTAL,
    expectHeader: EXPECT_HEADER, provider, expectedClassByItemId: CLASSES,
  });

// ── address authority ────────────────────────────────────────────────────

test("1 · PROVIDER ADDRESS is used — never array position", () => {
  const { lines } = makeProvider();
  const observed = toObservedLines(lines);
  // Group sits at array position 0 but address 1; the first MEMBER is at
  // position 1 with address 2.
  assert.equal(observed[0].kind, "group");
  assert.equal(observed[0].patchAddress, 1);
  assert.equal(observed[1].kind, "member");
  assert.equal(observed[1].patchAddress, 2);
  assert.notEqual(observed[1].patchAddress, 1, "address ≠ array position");
});

test("2 · FALSIFICATION — array-position addressing would mutate the GROUP HEADER", () => {
  const { lines } = makeProvider();
  const structure = normalizeStructure(toObservedLines(lines));
  const plan = planRateConvergence(PLAN, structure, TIER);

  // The correct plan targets the members: addresses 2, 3, 6.
  assert.deepEqual(plan.patches.map((p) => p.address), [2, 3, 6]);

  // Had we used array position for the first member, we would have sent
  // PATCH /item/1 — which is the GROUP HEADER, not the Box.
  const firstMemberArrayPosition = lines.findIndex((l) => l.itemId === "1024");
  assert.equal(firstMemberArrayPosition, 1);
  const wouldHaveHit = lines[firstMemberArrayPosition - 1];
  assert.equal(wouldHaveHit.itemType, "Group", "position-1 addressing lands on the Group header");
  assert.notEqual(plan.patches[0].address, firstMemberArrayPosition);

  // And the code says so, so the reason survives the test.
  assert.match(convergenceSrc, /Never REST array position/);
  assert.match(convergenceSrc, /Never SuiteQL ids or line sequence numbers/);
});

test("3 · SuiteQL is never cross-correlated to manufacture an address", () => {
  // readSalesOrderLines derives addresses from each element's own self href.
  assert.match(itemGroups, /Addresses come from each element's OWN self href/);
  assert.ok(
    itemGroups.includes("/\\/item\\/(\\d+)\\s*$/.exec(href)"),
    "the address is parsed out of the self href, not from position",
  );
  // The executor consumes only ProviderLine.line.
  assert.match(convergenceSrc, /patchAddress: typeof l\.line === "number" \? l\.line : null/);
  // Comments stripped: the executor's own prose explains WHY SuiteQL is not
  // the address authority, and naming it there must not trip the check. The
  // assertion is about reachable code.
  const code = convergenceSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /suiteQL|linesequencenumber/i);
});

// ── convergence ──────────────────────────────────────────────────────────

test("4 · first run drives every member from $0.00 to its planned rate", async () => {
  const { provider, patchLog } = makeProvider();
  const out = await run(provider);
  assert.deepEqual(patchLog, [
    { address: 2, rate: 6 },
    { address: 3, rate: 4 },
    { address: 6, rate: 2 },
  ]);
  assert.equal(out.gate.pass, true, out.gate.failures.join("; "));
  assert.equal(out.alreadyCorrect, 0);
});

test("5 · re-running a converged order performs NO commercial mutation", async () => {
  const { provider, patchLog } = makeProvider();
  await run(provider);
  const before = patchLog.length;
  const second = await run(provider);
  assert.equal(patchLog.length, before, "zero further patches");
  assert.equal(second.patched.length, 0);
  assert.equal(second.alreadyCorrect, 3);
  assert.equal(second.gate.pass, true);
});

test("6 · the two Bottles converge to DIFFERENT rates at different addresses", async () => {
  const { provider, patchLog, lines } = makeProvider();
  await run(provider);
  const bottles = patchLog.filter((p) => p.address === 3 || p.address === 6);
  assert.deepEqual(bottles, [{ address: 3, rate: 4 }, { address: 6, rate: 2 }]);
  assert.equal(lines.find((l) => l.line === 3)?.rate, 4, "Group A bottle @ $4");
  assert.equal(lines.find((l) => l.line === 6)?.rate, 2, "Group B bottle @ $2");
});

// ── crash / resume ───────────────────────────────────────────────────────

test("7 · crash before any PATCH → nothing mutated, gate fails, retry completes", async () => {
  const { provider, patchLog } = makeProvider({ failAfterNPatches: 0 });
  await assert.rejects(() => run(provider), /simulated interruption/);
  assert.equal(patchLog.length, 0);

  const { provider: p2, patchLog: log2, lines } = makeProvider();
  const out = await run(p2);
  assert.equal(log2.length, 3);
  assert.equal(out.gate.pass, true);
  assert.equal(lines.find((l) => l.line === 2)?.rate, 6);
});

test("8 · crash after ONE PATCH → retry patches only the remaining two", async () => {
  const { provider, patchLog, lines } = makeProvider({ failAfterNPatches: 1 });
  await assert.rejects(() => run(provider), /simulated interruption/);
  assert.deepEqual(patchLog, [{ address: 2, rate: 6 }]);

  // Same order, interruption lifted. The executor re-reads and skips the
  // member already at its planned rate.
  const resumed = await runRateConvergence({
    soId: "361241", plannedGroups: PLAN, tierQty: TIER, acceptedTotal: TOTAL,
    expectHeader: EXPECT_HEADER, expectedClassByItemId: CLASSES,
    provider: {
      readLines: async () => lines.map((l) => ({ ...l })),
      readHeader: provider.readHeader,
      async patchLine(_so, address, patch) {
        const t = lines.find((l) => l.line === address)!;
        t.rate = patch.rate;
        t.amount = patch.rate * (t.quantity ?? 0);
        const end = lines.find((l) => l.itemType === "EndGroup" && l.line > address)!;
        end.amount = lines.filter((l) => l.itemType === "InvtPart" && l.line < end.line && l.line > (lines.filter((g) => g.itemType === "Group" && g.line < end.line).pop()?.line ?? 0)).reduce((a, m) => a + (m.amount ?? 0), 0);
        patchLog.push({ address, rate: patch.rate });
      },
    },
  });
  assert.equal(resumed.alreadyCorrect, 1, "the already-correct member is skipped");
  assert.deepEqual(resumed.patched.map((p) => p.address), [3, 6]);
  assert.equal(resumed.gate.pass, true, resumed.gate.failures.join("; "));
});

test("9 · crash after ALL PATCHes but before verification → retry verifies clean", async () => {
  const { provider, lines, patchLog } = makeProvider();
  await run(provider);
  assert.equal(patchLog.length, 3);
  // Simulate the process dying before the gate ran: state is complete, so a
  // fresh run patches nothing and simply verifies.
  const out = await run(provider);
  assert.equal(out.patched.length, 0);
  assert.equal(out.gate.pass, true);
  assert.equal(lines.filter((l) => l.itemType === "InvtPart").every((l) => (l.rate ?? 0) > 0), true);
});

// ── refusal + gate ───────────────────────────────────────────────────────

test("10 · a structural blocker refuses the run and can never pass the gate", async () => {
  const { provider, lines, patchLog } = makeProvider();
  lines.splice(3, 0, {
    line: 99, itemId: "99999", itemType: "InvtPart", quantity: 5, rate: 0, amount: 0, classId: null,
  });
  const out = await run(provider);
  assert.equal(patchLog.length, 0, "nothing patched into an unexpected structure");
  assert.match(out.blockers.join("|"), /unexpected member 99999/);
  assert.equal(out.gate.pass, false);
  assert.match(out.gate.failures.join("|"), /unexpected member 99999/);
});

test("11 · the gate reads PROVIDER state after the final read, not what was sent", async () => {
  const { provider, lines } = makeProvider();
  // A provider that silently ignores one PATCH must still fail the gate.
  const sabotaged: ConvergenceProvider = {
    readLines: provider.readLines,
    readHeader: provider.readHeader,
    async patchLine(so, address, patch) {
      if (address === 6) return; // accepted, but not applied
      return provider.patchLine(so, address, patch);
    },
  };
  const out = await runRateConvergence({
    soId: "361241", plannedGroups: PLAN, tierQty: TIER, acceptedTotal: TOTAL,
    expectHeader: EXPECT_HEADER, provider: sabotaged, expectedClassByItemId: CLASSES,
  });
  assert.equal(out.patched.length, 3, "three PATCHes were issued");
  assert.equal(out.gate.pass, false, "but the order is not complete");
  assert.match(out.gate.failures.join("|"), /rate 0 ≠ planned 2|is \$0\.00/);
  assert.equal(lines.find((l) => l.line === 6)?.rate, 0);
});

test("12 · markComplete gates succeeded on the convergence result", () => {
  assert.match(markComplete, /if \(!convergence\.gate\.pass\)/);
  assert.ok(
    markComplete.includes("commercially complete."),
    "refusal names the commercial incompleteness",
  );
  assert.ok(
    markComplete.includes("against the same Sales Order rather than creating another"),
    "refusal tells the operator a retry resumes rather than duplicates",
  );
  // Post-CREATE failures route through the lifecycle with the SO id, so the
  // attempt is held at awaiting_rates and never marked failed.
  assert.match(
    markComplete,
    /netsuiteSoId: salesOrderInternalId, \/\/ non-null ⇒ cannot become `failed`/,
  );
  assert.match(markComplete, /netsuiteSoPushStatus: "awaiting_rates"/);
});

test("13 · addresses are re-derived every run, never cached", async () => {
  const { provider, lines, patchLog } = makeProvider();
  // The provider renumbers its addresses between runs (NetSuite re-sequenced
  // a system line on the real probe). A cached address would now be wrong.
  await run(provider);
  for (const l of lines) l.line += 100;
  for (const l of lines) if (l.itemType === "InvtPart") { l.rate = 0; l.amount = 0; }
  for (const l of lines) if (l.itemType === "EndGroup") l.amount = 0;
  patchLog.length = 0;

  const out = await run(provider);
  assert.deepEqual(out.patched.map((p) => p.address), [102, 103, 106], "follows the NEW addresses");
  assert.equal(out.gate.pass, true);
});

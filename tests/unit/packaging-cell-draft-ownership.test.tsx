/**
 * Draft ownership in the Packaging unit-cost cell.
 *
 * THE FAILURES THESE REPRODUCE, without a database or a browser:
 *
 *   ADJACENT CELL — type in tier 1 -> leave the cell -> type in tier 2 ->
 *   tier 1's response lands -> a reconcile carrying tier 2's STORED value
 *   replaces the open draft. Measured in the browser as `2.3456` becoming
 *   `0.5` with the caret still in the field (`costs-focus-tab-commit.spec.ts`),
 *   and identically on pre-M2 `5ac569d7` — a pre-existing gap, not an M2
 *   regression.
 *
 *   SAME CELL — commit, type again while that save is open, then let the OLD
 *   receipt land. A generation advanced only on SAVE still matches, so the
 *   receipt cleared the dirty flag for a value that had never been sent and
 *   the next reconcile took the field.
 *
 * Wait-for-quiet does not cover either. That defers reconciliation while the
 * operator is TYPING; both operators had paused. Ownership is what protects
 * them, and it is decided by keystrokes and response order — not by a clock,
 * and not by whether the store happens to agree with the field.
 *
 * WHY THE PROVIDER IS REAL HERE. The reconcile these tests must survive is the
 * one the provider schedules on a snapshot prop change, behind a 100ms debounce
 * and an 800ms quiet period. A test that called `store.reconcile` directly
 * would bypass both and prove something no operator experiences, so the
 * snapshot prop is re-rendered and the real timers are waited out.
 *
 * WHAT THIS COMPONENT-LEVEL TEST DOES NOT COVER, deliberately. Once a commit
 * is confirmed, ownership is released and a later snapshot applies — which is
 * required behaviour (a cell nobody is editing must show what the server
 * holds). This test does not distinguish a stale post-commit snapshot from a
 * fresh one; the separate browser reconciliation test exercises that server
 * read/write ordering with PostgreSQL and verifies the committed markup stays
 * visible after reconciliation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { flush, mount } from "../support/mount.tsx";

// The real module graph imports `@/db`, which throws at import time with no
// URL. Nothing here connects — `postgres()` is lazy and the writer is injected
// — but the module must be constructible. Set before the dynamic imports.
process.env.DATABASE_URL ??= "postgres://unit-test@127.0.0.1:5432/unit-test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "unit-test-anon-key";

const { PackagingTierCell } = await import(
  "../../src/components/costs/packaging-drilldown.tsx"
);
const { CostingStoreProvider } = await import(
  "../../src/components/costing-store-provider.tsx"
);
type Snapshot = Parameters<typeof CostingStoreProvider>[0]["snapshot"];

const T1 = "tier-1";
const T2 = "tier-2";
const ROW1 = "row-1";
const ROW2 = "row-2";
const LEAF = "leaf-1";
const LINE_GROUP = "lg-1";

/** Longer than the provider's 100ms debounce + 800ms quiet period. */
const RECONCILE_SETTLE_MS = 1_400;

function snapshot(revision: number, costs: Record<string, string>): Snapshot {
  return {
    revision,
    quoteId: "q1",
    projectId: "p1",
    globalPriceAdjPct: 0,
    freightMarkupPct: 0,
    targetMarginPct: null,
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [],
    tiers: [],
    packaging: Object.entries(costs).map(([rowId, unitCost]) => ({
      rowId,
      quoteSkuId: LEAF,
      tierId: rowId === ROW1 ? T1 : T2,
      lineGroupId: LINE_GROUP,
      unitCost: Number(unitCost),
      qtyPerSellableUnit: 1,
      category: "Primary",
      markupPct: null,
      pricingVendorHubspotCompanyId: null,
      pricingVendorNameSnapshot: null,
      legacySupplier: null,
    })),
    production: [],
    assemblyProduction: [],
    componentCharges: [],
    componentChargeMeta: [],
    chargeElections: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightComponentTierCosts: [],
    freightShipmentBreaks: [],
    freightCustomerArrangesMeta: [],
    cellOverrides: [],
    cellTargets: [],
    lifts: [],
    costing: { tiers: [], skuRollups: [], quoteRollup: [] },
    persistedWarnings: [],
  } as unknown as Snapshot;
}

/** The row shape the drilldown derives from the RSC `inputRows` prop. */
function line(cells: Array<[string, { rowId: string; unitCost: string | null }]>) {
  return {
    lineGroupId: LINE_GROUP,
    sortOrder: 0,
    quoteSkuId: LEAF,
    pricingVendorHubspotCompanyId: null,
    pricingVendorNameSnapshot: null,
    supplier: null,
    qtyPerSellableUnit: "1",
    category: "Primary",
    markupPct: null,
    markupPctSource: null,
    inventoryEligible: false,
    notes: null,
    cells: new Map(cells),
  };
}

const LINE = line([
  [T1, { rowId: ROW1, unitCost: "0.4" }],
  [T2, { rowId: ROW2, unitCost: "0.5" }],
]);

const NO_READ = {
  value: null,
  markup: null,
  markupSource: null,
  inheritedMarkup: null,
  inheritedSource: null,
};

type Outcome = { ok: boolean; message?: string };

/** A writer whose response this test decides when — and whether — to deliver. */
function gatedWriter() {
  const calls: Array<{ rowId: string; unitCost: string }> = [];
  const gates: Array<(o: Outcome) => void> = [];
  const write = async (fd: FormData) => {
    calls.push({
      rowId: String(fd.get("rowId")),
      unitCost: String(fd.get("unitCost")),
    });
    const outcome = await new Promise<Outcome>((resolve) => gates.push(resolve));
    if (!outcome.ok) {
      if (outcome.message === "__throw__") throw new Error("transport");
      return {
        ok: false as const,
        error: { code: "X", message: outcome.message ?? "rejected" },
      };
    }
    return {
      ok: true as const,
      data: {
        rowId: String(fd.get("rowId")),
        unitCost: String(fd.get("unitCost")),
        purchaseQty: null,
      },
    };
  };
  return {
    calls,
    /**
     * Deliver the nth (0-based) held response.
     *
     * Inside `act` because resolving the promise is what schedules the
     * component's state updates; outside it React reports work it cannot
     * attribute to the test, and the output stops being readable.
     */
    release: async (n = 0, outcome: Outcome = { ok: true }) => {
      await act(async () => {
        gates[n]?.(outcome);
        await new Promise((r) => setTimeout(r, 0));
      });
    },
    write: write as never,
  };
}

function tree(
  snap: Snapshot,
  writer: never,
  rows: ReturnType<typeof line> = LINE,
) {
  return (
    <CostingStoreProvider snapshot={snap} realtimeEnabled={false}>
      {/* Each cell wrapped so the two inputs are addressable. They are
          siblings-of-different-parents in the real table too, so `nth-of-type`
          cannot tell them apart. */}
      {[T1, T2].map((tierId, index) => (
        <div className={`slot-${index + 1}`} key={tierId}>
          <PackagingTierCell
            tierId={tierId}
            line={rows as never}
            markupPct=""
            markupDirty={false}
            read={NO_READ as never}
            isActive={false}
            disabled={false}
            writeCell={writer}
          />
        </div>
      ))}
    </CostingStoreProvider>
  );
}

const inputs = (m: Awaited<ReturnType<typeof mount>>) =>
  m.findAll("input") as HTMLInputElement[];

/**
 * Leave the field — the commit gesture.
 *
 * `focusout`, not `blur`. React delegates from the root container and listens
 * for the BUBBLING event; a non-bubbling `blur` dispatched on the node never
 * reaches the handler, so the test would silently exercise no commit at all.
 */
const blur = async (node: HTMLInputElement) => {
  node.dispatchEvent(new Event("focusout", { bubbles: true }));
  await flush();
};

const settle = async (ms = RECONCILE_SETTLE_MS) => {
  // The provider's debounce and quiet poll are real timers, so the wait is
  // real; it runs inside `act` so the reconcile they trigger is attributed to
  // the test rather than reported as an unwrapped update.
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  await flush();
};

test("a reconcile cannot replace an uncommitted draft in another cell", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  // Tier 1: type, then leave the cell. Its write is held open.
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  assert.equal(writer.calls.length, 1, "leaving the cell commits once");
  assert.equal(writer.calls[0].unitCost, "1.2345");

  // Tier 2: type a draft while tier 1's response is still in flight.
  await m.type(".slot-2 input", "2.3456");
  assert.equal(inputs(m)[1].value, "2.3456");

  // Tier 1's response lands, and the revalidation it triggers delivers a new
  // snapshot. The server has tier 1 saved and tier 2 still at its stored 0.5,
  // because tier 2 has not been saved. This is the moment the draft vanished.
  await writer.release(0);
  await flush();
  await m.update(
    tree(snapshot(2_000, { [ROW1]: "1.2345", [ROW2]: "0.5" }), writer.write),
  );
  await settle();

  assert.equal(
    inputs(m)[1].value,
    "2.3456",
    "the uncommitted draft must survive another cell's reconcile",
  );
  assert.equal(writer.calls.length, 1, "the draft must remain uncommitted");
  assert.equal(
    inputs(m)[0].value,
    "1.2345",
    "the committed cell shows what was saved",
  );
  await m.unmount();
});

test("an older receipt cannot clear a newer unsaved draft in the same cell", async () => {
  // The same-cell case, and the one a save-only generation gets wrong: the
  // receipt IS for this cell and IS the newest response, so nothing about it
  // looks stale. What makes it stale is that the operator typed afterwards.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "3.4567");
  await blur(inputs(m)[0]);
  assert.equal(writer.calls.length, 1);

  // Typed again in the SAME cell while that save is open, and NOT committed.
  await m.type(".slot-1 input", "4.5678");
  assert.equal(inputs(m)[0].value, "4.5678");

  // The old receipt arrives, followed by the snapshot its revalidation
  // produced — which carries 3.4567, the value the operator has moved past.
  await writer.release(0);
  await flush();
  await m.update(
    tree(snapshot(2_000, { [ROW1]: "3.4567", [ROW2]: "0.5" }), writer.write),
  );
  await settle();

  assert.equal(
    inputs(m)[0].value,
    "4.5678",
    "a newer unsaved draft outranks an older receipt and its snapshot",
  );
  assert.equal(
    writer.calls.length,
    1,
    "the newer draft is still uncommitted — nothing committed it on the operator's behalf",
  );

  // And leaving the field still commits it, so ownership is protection rather
  // than a trap.
  await blur(inputs(m)[0]);
  assert.deepEqual(
    writer.calls.map((c) => c.unitCost),
    ["3.4567", "4.5678"],
  );
  await m.unmount();
});

test("a clean cell still takes a cross-tab update", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );
  assert.equal(inputs(m)[1].value, "0.5");

  // Nobody is editing, so a remote change is the freshest truth. Ownership
  // must not freeze a cell that has no draft to protect.
  await m.update(
    tree(snapshot(2_000, { [ROW1]: "0.4", [ROW2]: "7.77" }), writer.write),
  );
  await settle();
  assert.equal(inputs(m)[1].value, "7.77");
  await m.unmount();
});

test("a committed value hands ownership back, so later reconciles apply", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0);
  await flush();

  // Released on success: a genuinely newer value applies rather than being
  // held forever by a dirty flag nobody cleared. This is the bound on the
  // repair — it does not suppress server refreshes, it defers them.
  await m.update(
    tree(snapshot(3_000, { [ROW1]: "5.55", [ROW2]: "0.5" }), writer.write),
  );
  await settle();
  assert.equal(inputs(m)[0].value, "5.55");
  await m.unmount();
});

test("a failed save with no newer draft rolls back to the committed value", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "9.9");
  await blur(inputs(m)[0]);
  await writer.release(0, { ok: false, message: "refused" });
  await flush();

  assert.equal(
    inputs(m)[0].value,
    "0.4",
    "nothing that looks saved may be left behind by a write that failed",
  );
  assert.match(m.text(), /refused/);
  await m.unmount();
});

test("a thrown failure rolls back too, and says so", async () => {
  // A rejected request or a server exception that escaped runAction never
  // reaches the !ok branch. Without the catch the optimistic projection stays
  // on screen for a write that never happened.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "8.8");
  await blur(inputs(m)[0]);
  await writer.release(0, { ok: false, message: "__throw__" });
  await flush();

  assert.equal(inputs(m)[0].value, "0.4");
  assert.match(m.text(), /could not be saved and has been reverted/);
  await m.unmount();
});

test("a stale failure reports itself but does not roll back a newer draft", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "1.1");
  await blur(inputs(m)[0]);

  // The operator types again in the SAME cell while that save is in flight.
  await m.type(".slot-1 input", "2.2");
  assert.equal(inputs(m)[0].value, "2.2");

  // The older attempt fails. Rolling back now would discard a newer draft to
  // undo an attempt the operator has already moved past.
  await writer.release(0, { ok: false, message: "rejected by the server" });
  await flush();

  assert.equal(
    inputs(m)[0].value,
    "2.2",
    "a newer draft outranks a stale rollback",
  );
  assert.match(m.text(), /rejected by the server/, "the failure is still reported");
  // And it does not claim a revert that did not happen.
  assert.doesNotMatch(m.text(), /has been reverted/);
  await m.unmount();
});

test("an accepted earlier save becomes the rollback baseline for a later one", async () => {
  // The half that a dirty flag alone cannot express. The first value is
  // ACCEPTED while a newer draft is open: it may not touch the field, but it
  // must become what a subsequent failure restores. Restoring the pre-edit
  // value instead would discard a change the server has already taken.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "1.1");
  await blur(inputs(m)[0]);

  await m.type(".slot-1 input", "2.2");
  await blur(inputs(m)[0]);
  assert.deepEqual(
    writer.calls.map((c) => c.unitCost),
    ["1.1", "2.2"],
    "each commit gesture sends what the field held at that moment",
  );

  // The first save is accepted; the second is refused.
  await writer.release(0);
  await flush();
  assert.equal(inputs(m)[0].value, "2.2", "an accepted earlier save is not a revert");

  await writer.release(1, { ok: false, message: "refused" });
  await flush();
  assert.equal(
    inputs(m)[0].value,
    "1.1",
    "the rollback target is the value the server accepted, not the pre-edit one",
  );
  await m.unmount();
});

test("a late earlier response cannot restore the value its successor replaced", async () => {
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "1.1");
  await blur(inputs(m)[0]);
  await m.type(".slot-1 input", "2.2");
  await blur(inputs(m)[0]);

  // Out of order: the SECOND response lands first, then the first — and the
  // first FAILS. Without response ordering that failure rolls the cell back to
  // a value the server has since replaced.
  await writer.release(1);
  await flush();
  await writer.release(0, { ok: false, message: "refused" });
  await flush();
  assert.equal(
    inputs(m)[0].value,
    "2.2",
    "a superseded outcome describes a state the cell has moved past",
  );
  assert.doesNotMatch(m.text(), /refused/);
  await m.unmount();
});

test("a change of row identity resets the slot rather than carrying the draft", async () => {
  // The slot is keyed by TIER, so a different cost row can occupy it. A draft
  // and an open save belong to the row they were made on, not to the position.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );

  await m.type(".slot-1 input", "6.6");
  await blur(inputs(m)[0]);
  assert.equal(writer.calls.length, 1);

  // Tier 1 is now served by a different row, with its own stored value.
  const replaced = line([
    [T1, { rowId: "row-1b", unitCost: "0.9" }],
    [T2, { rowId: ROW2, unitCost: "0.5" }],
  ]);
  await m.update(
    tree(
      snapshot(2_000, { "row-1b": "0.9", [ROW2]: "0.5" }) as never,
      writer.write,
      replaced,
    ),
  );
  await settle();
  assert.equal(inputs(m)[0].value, "0.9", "the new row shows its own value");

  // The orphaned save now answers — with a failure. It must not roll the new
  // row back to a value that was never its own.
  await writer.release(0, { ok: false, message: "refused" });
  await flush();
  assert.equal(inputs(m)[0].value, "0.9");
  assert.doesNotMatch(m.text(), /refused/);
  await m.unmount();
});

test("the input is never disabled while a save is in flight", async () => {
  // Pattern 47(e). Ownership is expressed by ignoring incoming values, never
  // by taking the field away — a disabled element drops focus and the
  // operator's next keystroke goes nowhere.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot(1_000, { [ROW1]: "0.4", [ROW2]: "0.5" }), writer.write),
  );
  await m.type(".slot-1 input", "1.5");
  await blur(inputs(m)[0]);
  assert.equal(inputs(m)[0].disabled, false, "an in-flight save must not disable the input");
  // And it still accepts typing while that save is open.
  await m.type(".slot-1 input", "1.55");
  assert.equal(inputs(m)[0].value, "1.55");
  await writer.release(0);
  await flush();
  await m.unmount();
});

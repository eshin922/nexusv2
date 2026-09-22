/**
 * Step 6 — arming, driven through the real component and the real provider.
 *
 * `costing-store-write-floor.test.ts` proves the STORE's rules. This proves the
 * CELL reaches them: that the accepted branch arms, that the thrown and
 * rejected branches do not, that a null id from the server's no-op path arms
 * nothing, and that the shipped draft-ownership semantics are untouched by any
 * of it.
 *
 * The distinction matters because the two can disagree silently. A store rule
 * nothing calls is inert; a call site that arms on the wrong branch defeats a
 * correct store. Only one of them can be established by reading the store.
 *
 * Witness fixtures are P1 measurements on PostgreSQL 16.14
 * (`cc-reconciliation-p1.md`):
 *
 *     stale  14346:14348:14346    a lower xid held open, a higher one committed
 *     fresh  14348:14348:         the same instant after that lower xid committed
 *
 * Both carry `xmax` 14348, so both bundles report revision 14348. The legacy
 * number cannot separate them; the in-progress list separates them exactly.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { flush, mount } from "../support/mount.tsx";

process.env.DATABASE_URL ??= "postgres://unit-test@127.0.0.1:5432/unit-test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "unit-test-anon-key";

const { PackagingTierCell } = await import(
  "../../src/components/costs/packaging-drilldown.tsx"
);
const { CostingStoreProvider, useCostingStoreApi } = await import(
  "../../src/components/costing-store-provider.tsx"
);
const { PACKAGING_DOMAIN } = await import(
  "../../src/lib/costs/packaging-domain.ts"
);
const { PAYLOAD_ORDERING_DOMAIN } = await import("../../src/lib/costing-store.ts");
type Snapshot = Parameters<typeof CostingStoreProvider>[0]["snapshot"];

const T1 = "tier-1";
const T2 = "tier-2";
const ROW1 = "row-1";
const ROW2 = "row-2";
const LEAF = "leaf-1";
const LINE_GROUP = "lg-1";

const STALE = "14346:14348:14346";
const FRESH = "14348:14348:";
const WRITE = "14346";
const SAME_REVISION = 14348;

/** Longer than the provider's 100ms debounce + 800ms quiet period. */
const RECONCILE_SETTLE_MS = 1_400;

function snapshot(over: {
  revision?: number;
  costs?: Record<string, string>;
  witnesses?: Record<string, string>;
  guarded?: readonly string[];
} = {}): Snapshot {
  const costs = over.costs ?? { [ROW1]: "0.4", [ROW2]: "0.5" };
  return {
    revision: over.revision ?? 1,
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
    // What the real reader emits (step 4). Defaulted so every test exercises
    // the guarded configuration rather than the inert one.
    witnesses: over.witnesses ?? {
      [PAYLOAD_ORDERING_DOMAIN]: STALE,
      [PACKAGING_DOMAIN]: STALE,
    },
    guardedDomains: over.guarded ?? [PAYLOAD_ORDERING_DOMAIN, PACKAGING_DOMAIN],
  } as unknown as Snapshot;
}

const LINE = {
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
  cells: new Map([
    [T1, { rowId: ROW1, unitCost: "0.4" }],
    [T2, { rowId: ROW2, unitCost: "0.5" }],
  ]),
};

const NO_READ = {
  value: null,
  markup: null,
  markupSource: null,
  inheritedMarkup: null,
  inheritedSource: null,
};

type Outcome =
  | { kind: "ok"; writeId: string | null }
  | { kind: "rejected"; message: string }
  | { kind: "thrown" };

/** A writer whose response — and write id — this test decides. */
function gatedWriter() {
  const calls: Array<{ rowId: string; unitCost: string }> = [];
  const gates: Array<(o: Outcome) => void> = [];
  const write = async (fd: FormData) => {
    calls.push({
      rowId: String(fd.get("rowId")),
      unitCost: String(fd.get("unitCost")),
    });
    const outcome = await new Promise<Outcome>((resolve) => gates.push(resolve));
    if (outcome.kind === "thrown") throw new Error("transport");
    if (outcome.kind === "rejected") {
      return { ok: false as const, error: { code: "X", message: outcome.message } };
    }
    return {
      ok: true as const,
      data: {
        rowId: String(fd.get("rowId")),
        unitCost: String(fd.get("unitCost")),
        purchaseQty: null,
        writeId: outcome.writeId,
      },
    };
  };
  return {
    calls,
    release: async (n = 0, outcome: Outcome = { kind: "ok", writeId: WRITE }) => {
      await act(async () => {
        gates[n]?.(outcome);
        await new Promise((r) => setTimeout(r, 0));
      });
    },
    write: write as never,
  };
}

/** Exposes the live store so a test can read `floor` without a selector. */
let storeApi: ReturnType<typeof useCostingStoreApi> | null = null;
function CaptureStore() {
  storeApi = useCostingStoreApi();
  return null;
}
const floor = () => storeApi?.getState().floor ?? [];

function tree(snap: Snapshot, writer: never) {
  return (
    <CostingStoreProvider snapshot={snap} realtimeEnabled={false}>
      <CaptureStore />
      {[T1, T2].map((tierId, index) => (
        <div className={`slot-${index + 1}`} key={tierId}>
          <PackagingTierCell
            tierId={tierId}
            line={LINE as never}
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

const blur = async (node: HTMLInputElement) => {
  node.dispatchEvent(new Event("focusout", { bubbles: true }));
  await flush();
};

const settle = async (ms = RECONCILE_SETTLE_MS) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  await flush();
};

// ── arming reaches the store, and only from the accepted branch ───────────

test("a successful save with a write id arms the packaging domain", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  assert.deepEqual(floor(), [], "nothing is armed before the response");
  await writer.release(0, { kind: "ok", writeId: WRITE });
  assert.deepEqual(floor(), [{ writeId: WRITE, domain: PACKAGING_DOMAIN }]);
  await m.unmount();
});

test("a rejected save arms nothing", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0, { kind: "rejected", message: "refused" });
  assert.deepEqual(floor(), []);
  assert.match(m.text(), /refused/, "and the failure is still reported");
  await m.unmount();
});

test("a THROWN save arms nothing — the outcome is unknown, not merely failed", async () => {
  // The transaction may or may not have committed. A snapshot will report it
  // as finished either way (P1 · F2), so a requirement armed here would retire
  // against data that may never have landed.
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0, { kind: "thrown" });
  assert.deepEqual(floor(), []);
  await m.unmount();
});

test("a successful save with a NULL write id arms nothing", async () => {
  // The server's no-op path: the values already matched, no UPDATE ran, so
  // there is no transaction to await.
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0, { kind: "ok", writeId: null });
  assert.deepEqual(floor(), []);
  await m.unmount();
});

test("two pending writes both arm, and neither replaces the other", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.1");
  await blur(inputs(m)[0]);
  await m.type(".slot-2 input", "2.2");
  await blur(inputs(m)[1]);
  assert.equal(writer.calls.length, 2);
  await writer.release(0, { kind: "ok", writeId: "14346" });
  await writer.release(1, { kind: "ok", writeId: "14347" });
  assert.deepEqual(
    floor().map((e) => e.writeId),
    ["14346", "14347"],
    "a maximum would have kept only one",
  );
  await m.unmount();
});

test("nothing arms when the reader declares no guarded domains", async () => {
  // The pre-step-4 configuration. Partial wiring cannot hold a read hostage:
  // with no reader emitting a witness, the client cannot arm at all.
  const writer = gatedWriter();
  const m = await mount(
    tree(snapshot({ guarded: [], witnesses: {} }), writer.write),
  );
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0, { kind: "ok", writeId: WRITE });
  assert.deepEqual(floor(), []);
  await m.unmount();
});

// ── the measured sequence, end to end through the provider ────────────────

test("THE MEASURED PATH — a pre-commit read cannot revert a confirmed value", async () => {
  // The operator's own failure, reproduced through the component: commit, then
  // let the bundle that PREDATES the commit arrive. Both bundles carry
  // revision 14348, so the legacy number admits neither; the witness admits
  // exactly the one that contains the write.
  const writer = gatedWriter();
  const m = await mount(
    tree(
      snapshot({
        revision: SAME_REVISION,
        witnesses: {
          [PAYLOAD_ORDERING_DOMAIN]: STALE,
          [PACKAGING_DOMAIN]: STALE,
        },
      }),
      writer.write,
    ),
  );

  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await writer.release(0, { kind: "ok", writeId: WRITE });
  assert.equal(floor().length, 1, "the write is outstanding");

  // The stale bundle: same revision, and its packaging slice still carries the
  // pre-write value. This is the read that used to revert the cell.
  await m.update(
    tree(
      snapshot({
        revision: SAME_REVISION,
        costs: { [ROW1]: "0.4", [ROW2]: "0.5" },
        witnesses: {
          [PAYLOAD_ORDERING_DOMAIN]: STALE,
          [PACKAGING_DOMAIN]: STALE,
        },
      }),
      writer.write,
    ),
  );
  await settle();
  assert.equal(
    inputs(m)[0].value,
    "1.2345",
    "a read that cannot account for the write must not replace it",
  );
  assert.equal(floor().length, 1, "and the requirement is still outstanding");

  // The post-commit bundle: same revision again, and it proves inclusion.
  await m.update(
    tree(
      snapshot({
        revision: SAME_REVISION,
        costs: { [ROW1]: "1.2345", [ROW2]: "0.5" },
        witnesses: {
          [PAYLOAD_ORDERING_DOMAIN]: FRESH,
          [PACKAGING_DOMAIN]: FRESH,
        },
      }),
      writer.write,
    ),
  );
  await settle();
  assert.equal(inputs(m)[0].value, "1.2345", "the committed value stands");
  assert.deepEqual(floor(), [], "and the requirement retires on its evidence");
  await m.unmount();
});

// ── the shipped draft-ownership contract is untouched ─────────────────────

test("draft ownership still holds: an adjacent draft survives the reconcile", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.2345");
  await blur(inputs(m)[0]);
  await m.type(".slot-2 input", "2.3456");
  await writer.release(0, { kind: "ok", writeId: WRITE });
  await m.update(
    tree(
      snapshot({
        revision: 2,
        costs: { [ROW1]: "1.2345", [ROW2]: "0.5" },
        witnesses: {
          [PAYLOAD_ORDERING_DOMAIN]: FRESH,
          [PACKAGING_DOMAIN]: FRESH,
        },
      }),
      writer.write,
    ),
  );
  await settle();
  assert.equal(inputs(m)[1].value, "2.3456", "the open draft is still the operator's");
  assert.equal(writer.calls.length, 1, "and still uncommitted");
  await m.unmount();
});

test("the input is never disabled while a save is in flight", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  await m.type(".slot-1 input", "1.5");
  await blur(inputs(m)[0]);
  assert.equal(inputs(m)[0].disabled, false);
  await m.type(".slot-1 input", "1.55");
  assert.equal(inputs(m)[0].value, "1.55", "and it still accepts typing");
  await writer.release(0, { kind: "ok", writeId: WRITE });
  await m.unmount();
});

test("a clean cell still takes a cross-tab update", async () => {
  const writer = gatedWriter();
  const m = await mount(tree(snapshot(), writer.write));
  assert.equal(inputs(m)[1].value, "0.5");
  await m.update(
    tree(
      snapshot({
        revision: 2,
        costs: { [ROW1]: "0.4", [ROW2]: "7.77" },
        witnesses: {
          [PAYLOAD_ORDERING_DOMAIN]: FRESH,
          [PACKAGING_DOMAIN]: FRESH,
        },
      }),
      writer.write,
    ),
  );
  await settle();
  assert.equal(inputs(m)[1].value, "7.77", "nobody is editing, so the server wins");
  await m.unmount();
});

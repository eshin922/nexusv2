import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const provider = await readFile(
  new URL("../../src/components/costing-store-provider.tsx", import.meta.url),
  "utf8",
);
const drilldown = await readFile(
  new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url),
  "utf8",
);
const store = await readFile(
  new URL("../../src/lib/costing-store.ts", import.meta.url),
  "utf8",
);
const publication = await readFile(
  new URL(
    "../../drizzle/manual/0036_realtime_publication_phase_2_worksheet_freight.sql",
    import.meta.url,
  ),
  "utf8",
);
const readiness = await readFile(
  new URL("../../scripts/verify/realtime-readiness.ts", import.meta.url),
  "utf8",
);

// The seven live worksheet tables from drizzle 0054. The snapshot table
// from 0055 is deliberately excluded — written once at send, frozen
// thereafter under Pattern 52, so it has no live state to propagate.
const WORKSHEET_TABLES = [
  "freight_subcategories",
  "freight_subcategory_items",
  "freight_destinations",
  "freight_destination_breaks",
  "freight_customs_entries",
  "freight_customs_breaks",
  "freight_destination_tracking",
];

/**
 * Splits the provider source at each `.channel(` call and counts the
 * `postgres_changes` bindings that follow it, so each channel's binding
 * budget can be asserted independently.
 */
function bindingsPerChannel(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  const segments = source.split(/\.channel\(/).slice(1);
  for (const segment of segments) {
    const name = segment.match(/^\s*`([^`]+)`/)?.[1];
    if (!name) continue;
    // Stop at `.subscribe(` — everything after belongs to later code,
    // not this channel's binding list.
    const body = segment.split(".subscribe(")[0];
    counts.set(name, (body.match(/"postgres_changes"/g) ?? []).length);
  }
  return counts;
}

test("no realtime channel exceeds the 10-binding postgres_changes cap", () => {
  const counts = bindingsPerChannel(provider);
  assert.ok(counts.size >= 3, `expected at least 3 channels, saw ${counts.size}`);
  for (const [channel, bindings] of counts) {
    assert.ok(
      bindings <= 10,
      `channel ${channel} has ${bindings} bindings; Supabase silently kills the channel past 10`,
    );
  }
});

test("worksheet Freight subscribes on its own channel, not folded into an existing one", () => {
  const counts = bindingsPerChannel(provider);
  const worksheet = [...counts.entries()].find(([name]) =>
    name.includes("freight-worksheet"),
  );
  assert.ok(worksheet, "expected a dedicated worksheet Freight channel");
  assert.equal(
    worksheet[1],
    WORKSHEET_TABLES.length,
    "worksheet channel should bind exactly the seven live worksheet tables",
  );
});

test("every worksheet table is both subscribed and published", () => {
  for (const table of WORKSHEET_TABLES) {
    assert.match(
      provider,
      new RegExp(`table: "${table}"`),
      `${table} is not subscribed in the provider`,
    );
    assert.match(
      publication,
      new RegExp(`public\\.${table}\\b`),
      `${table} is not added to the supabase_realtime publication`,
    );
  }
});

test("the frozen send-time snapshot table is not published to realtime", () => {
  // Assert against the executable statement only. The file's header
  // comment names this table deliberately, to record why it is absent.
  const statement = publication
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(
    statement.includes("ALTER PUBLICATION"),
    "expected an ALTER PUBLICATION statement",
  );
  assert.ok(
    !statement.includes("quote_snapshot_freight_workbooks"),
    "the send-time snapshot table is frozen under Pattern 52; publishing it spends a binding slot for events that cannot fire",
  );
});

test("realtime readiness verifier covers the worksheet tables and drops the tables Slice 11.5.1 deleted", () => {
  for (const table of WORKSHEET_TABLES) {
    assert.match(readiness, new RegExp(`"${table}"`), `${table} unverified`);
  }
  for (const dropped of ["quote_skus", "packaging_inputs", "production_inputs"]) {
    assert.ok(
      !new RegExp(`^\\s*"${dropped}",`, "m").test(readiness),
      `${dropped} was dropped in Slice 11.5.1; listing it produces a standing false positive`,
    );
  }
});

test("costing store carries the worksheet workbook through hydrate and reconcile", () => {
  assert.match(store, /freightWorkbook: FreightWorkbook;/);
  assert.match(store, /export const selectFreightWorkbook/);
  // Present in the initial state, hydrate, and reconcile — three sites.
  // A reconcile that omits it would leave the surface stale after a
  // remote edit, which is the whole point of PR-F.
  const assignments = store.match(/freightWorkbook: (initial|snapshot)\.freightWorkbook/g) ?? [];
  assert.equal(
    assignments.length,
    3,
    "expected freightWorkbook wired into makeCostingStore, hydrate, and reconcile",
  );
});

test("Freight drilldown derives the workbook from the store, not the frozen RSC prop", () => {
  assert.match(
    drilldown,
    /useCostingStore\(selectFreightWorkbook\)/,
    "drilldown must subscribe to the store (Pattern 41)",
  );
  assert.match(
    drilldown,
    /const workbook = storeWorkbook \?\? props\.workbook/,
    "drilldown must fall back to the prop only before the store hydrates",
  );
  // The destructure must not re-introduce `workbook`, which would
  // shadow the store-derived value and silently restore the stale-prop
  // behaviour this PR exists to remove.
  const destructure = drilldown.match(/const \{[^}]*\} = props;/)?.[0] ?? "";
  assert.ok(
    !/\bworkbook\b/.test(destructure),
    "workbook must not be destructured from props; it would shadow the store-derived value",
  );
});

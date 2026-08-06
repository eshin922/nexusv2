/**
 * Packaging materialization — Setup owns structure, Costs prices it.
 *
 * THE DEFECT. Fan-out existed only on the tier axis. Adding a tier cloned
 * every line group across it; attaching a leaf in Setup wrote nothing. The
 * result therefore depended on authoring ORDER — components-then-tiers
 * materialized, tiers-then-components produced an empty Packaging section —
 * which is why every quote in the database except one had materialized
 * correctly by accident, and why the bug read as intermittent.
 *
 * The contract now lives in one helper on both axes. These tests model the
 * predicate executably and bind the model to the production wiring.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const helper = read("src/lib/packaging-materialization.ts");
const quotes = read("src/app/actions/quotes.ts");
const assemblies = read("src/app/actions/assemblies.ts");
const drilldown = read("src/components/costs/packaging-drilldown.tsx");
const inputActions = read("src/app/actions/assembly-leaf-inputs.ts");
const migration = read("drizzle/0058_packaging_materialization_backfill.sql");

// ---------------------------------------------------------------------------
// Reference model of the materialization predicate
// ---------------------------------------------------------------------------

type Row = { leaf: string; tier: string; group: string };

function materialize(leaves: string[], tiers: string[], existing: Row[]): Row[] {
  const present = new Set(existing.map((r) => `${r.leaf} ${r.tier} ${r.group}`));
  const groupsByLeaf = new Map<string, Set<string>>();
  for (const r of existing) {
    const s = groupsByLeaf.get(r.leaf) ?? new Set<string>();
    s.add(r.group);
    groupsByLeaf.set(r.leaf, s);
  }
  const added: Row[] = [];
  if (tiers.length === 0) return added;
  for (const leaf of leaves) {
    const groups = groupsByLeaf.get(leaf);
    if (!groups || groups.size === 0) {
      const group = `g:${leaf}`;
      for (const tier of tiers) added.push({ leaf, tier, group });
      continue;
    }
    for (const group of groups) {
      for (const tier of tiers) {
        if (present.has(`${leaf} ${tier} ${group}`)) continue;
        added.push({ leaf, tier, group });
      }
    }
  }
  return added;
}

test("a newly attached leaf receives one group spanning every tier", () => {
  const added = materialize(["L1"], ["T1", "T2", "T3", "T4"], []);
  assert.equal(added.length, 4);
  assert.equal(new Set(added.map((r) => r.group)).size, 1);
});

test("52bd0077 shape — 2 leaves x 4 tiers = 8 rows", () => {
  const added = materialize(["L1", "L2"], ["T1", "T2", "T3", "T4"], []);
  assert.equal(added.length, 8);
});

test("a newly added tier gets a row for every existing line group", () => {
  // Two groups on one leaf must both extend to the new tier.
  const existing: Row[] = [
    { leaf: "L1", tier: "T1", group: "A" },
    { leaf: "L1", tier: "T1", group: "B" },
  ];
  const added = materialize(["L1"], ["T1", "T2"], existing);
  assert.deepEqual(added.sort((a, b) => a.group.localeCompare(b.group)), [
    { leaf: "L1", tier: "T2", group: "A" },
    { leaf: "L1", tier: "T2", group: "B" },
  ]);
});

test("repeated materialization is idempotent at (leaf, tier, group)", () => {
  const leaves = ["L1", "L2"];
  const tiers = ["T1", "T2"];
  const first = materialize(leaves, tiers, []);
  const second = materialize(leaves, tiers, first);
  assert.equal(second.length, 0);
});

test("existing rows are never modified or removed", () => {
  // The helper only ever returns rows to INSERT; nothing it produces
  // collides with an existing key.
  const existing: Row[] = [{ leaf: "L1", tier: "T1", group: "A" }];
  const added = materialize(["L1"], ["T1", "T2"], existing);
  const keys = new Set(existing.map((r) => `${r.leaf} ${r.tier} ${r.group}`));
  assert.ok(added.every((r) => !keys.has(`${r.leaf} ${r.tier} ${r.group}`)));
});

test("multi-line-group leaves are preserved, not normalised to one", () => {
  // Three such leaves exist on a frozen quote. The one-group rule governs what
  // is CREATED; rewriting history would change priced rows on a completed quote.
  const existing: Row[] = [
    { leaf: "L1", tier: "T1", group: "A" },
    { leaf: "L1", tier: "T2", group: "A" },
    { leaf: "L1", tier: "T1", group: "B" },
    { leaf: "L1", tier: "T2", group: "B" },
  ];
  assert.equal(materialize(["L1"], ["T1", "T2"], existing).length, 0);
});

test("no tiers means nothing to span", () => {
  assert.equal(materialize(["L1"], [], []).length, 0);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("all three paths route through the one helper — no duplicated fan-out", () => {
  assert.match(quotes, /materializePackagingRows\(tx, quoteId\)/);
  assert.match(assemblies, /materializePackagingRows\(tx, asm\.quoteId\)/);
  // addTier and applyTierPreset each call it; the inline clone loops are gone.
  assert.ok((quotes.match(/materializePackagingRows\(/g) ?? []).length >= 2);
  assert.doesNotMatch(quotes, /const seedRows: \(typeof assemblyLeafInputs/);
  assert.doesNotMatch(quotes, /const newRows: \(typeof assemblyLeafInputs/);
});

test("the helper never updates or deletes", () => {
  assert.doesNotMatch(helper, /\.update\(assemblyLeafInputs\)/);
  assert.doesNotMatch(helper, /\.delete\(assemblyLeafInputs\)/);
  assert.match(helper, /\.insert\(assemblyLeafInputs\)/);
});

test("new rows carry no cost — pricing stays the operator's", () => {
  assert.doesNotMatch(helper, /unitCost:/);
  assert.doesNotMatch(helper, /purchaseQty:/);
});

test("no manual Add Line control or action remains", () => {
  assert.doesNotMatch(drilldown, /AddLineButton|PackagingAddLineActions|Add line/);
  assert.doesNotMatch(inputActions, /export async function addAssemblyLeafInput\b/);
});

test("the empty state directs the operator to Setup", () => {
  assert.match(drilldown, /No components in Setup yet/);
  assert.match(drilldown, /defined in Setup/);
});

test("migration 0058 is draft-only and idempotent", () => {
  // Draft-only: frozen quotes are excluded, per the derived-output freeze
  // discipline that F-7 records.
  assert.ok((migration.match(/q\.status = 'draft'/g) ?? []).length >= 2);
  // Idempotent: every insert gated on absence.
  assert.match(migration, /NOT EXISTS/);
  // Fails rather than compounding an inconsistent base.
  assert.match(migration, /duplicate \(leaf, tier, line_group\) triples already exist/);
  // Never modifies or removes.
  assert.doesNotMatch(migration, /\bUPDATE assembly_leaf_inputs\b/);
  assert.doesNotMatch(migration, /\bDELETE FROM assembly_leaf_inputs\b/);
  // Journalled and executed 2026-08-06 under the eight-row draft-only
  // contract: 275 -> 283 rows, sent-quote gap of 3 preserved, priced rows
  // unchanged at 169, frozen digest identical.
  const journal = read("drizzle/meta/_journal.json");
  assert.match(journal, /0058_packaging_materialization_backfill/);
});

/**
 * A-2 · provenance.
 *
 * The capability answers one question — "who set this value, and when" — and
 * three surfaces ask it. What these tests defend is that it stays ONE answer:
 * one classification of a node key, one resolution against the audit trail, one
 * accessor. Three implementations would be three chances to disagree, which is
 * the failure two surfaces labelled "packaging" already produced by answering
 * one question with two formulas.
 *
 * The other property, and the sharper one: **it fails toward thin.** An
 * unclassifiable key, a missing bridge entry, an audit row with no actor — all
 * resolve to "we cannot say", never to a plausible name. A fabricated human act
 * is worse than an admitted gap, because the admission is visible.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVENANCE_INPUTS,
  classifyNodeKey,
  emptyIdentityIndex,
  indexRecords,
  originFor,
  originForKey,
  resolveProvenance,
  withProvenance,
  type ProvenanceIdentityIndex,
  type ProvenanceRecord,
} from "../../src/lib/pricing-provenance.ts";
import type { CostingNode } from "../../src/lib/costing-nodes.ts";

const QUOTE = "quote-1";
const SKU = "engine-sku-A";
const CANON = "canonical-leaf-A";
const TIER = "tier-1";
const LINE = "line-group-1";

function index(over: Partial<ProvenanceIdentityIndex> = {}): ProvenanceIdentityIndex {
  return {
    ...emptyIdentityIndex(QUOTE),
    // Canonical and engine ids are DIFFERENT here on purpose. A fixture where
    // they coincide cannot detect a classifier that reaches for the wrong one.
    canonicalLeafBySkuId: new Map([[SKU, CANON]]),
    legacyLeafBySkuId: new Map([[SKU, SKU]]),
    assemblyBySkuId: new Map([[SKU, "assembly-1"]]),
    packagingRowByLineTier: new Map([[`${LINE}::${TIER}`, "pkg-row-1"]]),
    productionRowByAssemblyTier: new Map([[`assembly-1::${TIER}`, "prod-row-1"]]),
    firmSettingsId: "firm-1",
    ...over,
  };
}

const rec = (
  entityType: string,
  entityId: string,
  action: string,
  actor: string | null = "Ed Shin",
): ProvenanceRecord => ({
  entityType,
  entityId,
  action,
  actor,
  when: "2026-08-10T12:00:00.000Z",
});

// ── classification ────────────────────────────────────────────────────────

test("a packaging line cost classifies through the row bridge", () => {
  const q = classifyNodeKey(`${SKU}/${TIER}/pkg/${LINE}/cost`, index());
  assert.deepEqual(q, { inputType: "packaging_line_cost", auditId: "pkg-row-1" });
});

test("an applied lift classifies to the CANONICAL address, not the engine id", () => {
  // The whole reason `quote_leaf_lifts` keys canonically. Reaching for the
  // engine id here would look identical and resolve nothing.
  const q = classifyNodeKey(`${SKU}/${TIER}/lift/pct`, index());
  assert.deepEqual(q, { inputType: "applied_lift", auditId: `${CANON}:${TIER}` });
  assert.ok(!q!.auditId!.startsWith(SKU));
});

test("a direct price classifies to the LEGACY address, because that table does", () => {
  // The asymmetry is real and is OD-017. Both are addressed here, correctly and
  // differently, which is why the two identities have to appear side by side.
  const q = classifyNodeKey(`${SKU}/${TIER}/quoted`, index());
  assert.deepEqual(q, { inputType: "sell_price_override", auditId: `${SKU}:${TIER}` });
});

test("bulk raw resolves to the same row as the service fees", () => {
  // One governed input under two section names — `raw` and `prod` are both the
  // per-(assembly, tier) production row.
  const a = classifyNodeKey(`${SKU}/${TIER}/raw/cost/total`, index());
  const b = classifyNodeKey(`${SKU}/${TIER}/prod/cogs/filling`, index());
  assert.deepEqual(a, b);
  assert.equal(a!.inputType, "production_service_fee");
});

test("a resolution's rungs classify to DIFFERENT authorities", () => {
  const over = classifyNodeKey("quote-wide/target-margin/quote-override", index());
  const firm = classifyNodeKey("quote-wide/target-margin/firm-default", index());
  assert.deepEqual(over, { inputType: "quote_target_margin", auditId: QUOTE });
  assert.deepEqual(firm, { inputType: "firm_margin_policy", auditId: "firm-1" });
});

test("the resolution NODE itself classifies to nothing", () => {
  // Nobody authors a choice. Attributing the winner's author to the choice
  // would say a person made the decision the ladder made.
  assert.equal(classifyNodeKey("quote-wide/target-margin", index()), null);
});

test("aggregates classify to nothing — nobody sets a total", () => {
  for (const key of [
    `quote/${TIER}/revenue/${SKU}`,
    `quote/${TIER}/cost-total/${SKU}`,
    `quote/${TIER}/per-unit/pkg/total`,
  ]) {
    assert.equal(classifyNodeKey(key, index()), null, key);
  }
});

// ── known input vs unknown key ────────────────────────────────────────────

test("a KNOWN input with no bridge entry classifies, with a null address", () => {
  // The distinction that was worth correcting. Collapsing this into "unknown
  // key" reports a governed input as unmapped, which understates how much of
  // the graph is governed — the opposite finding, acted on in the opposite way.
  const q = classifyNodeKey(`${SKU}/${TIER}/pkg/other-line/cost`, index());
  assert.deepEqual(q, { inputType: "packaging_line_cost", auditId: null });
});

test("and a null address resolves THIN, not to some other row", () => {
  const o = originForKey(
    `${SKU}/${TIER}/pkg/other-line/cost`,
    index(),
    indexRecords([rec("assembly_leaf_input", "pkg-row-1", "assembly_leaf_input_cell_updated")]),
  );
  assert.equal(o.grade, "thin");
  assert.equal(o.actor, null);
});

// ── resolution ────────────────────────────────────────────────────────────

test("a matching audit row makes a terminal sourced", () => {
  const o = originForKey(
    `${SKU}/${TIER}/lift/pct`,
    index(),
    indexRecords([rec("quote_leaf_lift", `${CANON}:${TIER}`, "pricing_lift_applied")]),
  );
  assert.equal(o.grade, "sourced");
  assert.equal(o.actor, "Ed Shin");
  assert.equal(o.doc, PROVENANCE_INPUTS.applied_lift.doc);
});

test("a row with no actor stays THIN", () => {
  // A record that something changed is not a record of who changed it, and the
  // trace's promise is the latter.
  const o = originForKey(
    `${SKU}/${TIER}/lift/pct`,
    index(),
    indexRecords([rec("quote_leaf_lift", `${CANON}:${TIER}`, "pricing_lift_applied", null)]),
  );
  assert.equal(o.grade, "thin");
});

test("a row for the WRONG entity type does not leak across", () => {
  // Both records name the same id. Only the one whose entity type matches may
  // answer — otherwise a tier's adjustment could attribute a quote's.
  const o = originForKey(
    `${SKU}/${TIER}/lift/pct`,
    index(),
    indexRecords([rec("assembly_leaf_override", `${CANON}:${TIER}`, "assembly_leaf_sell_override_updated")]),
  );
  assert.equal(o.grade, "thin");
});

test("the newest row wins, and ties keep the loader's order", () => {
  const first = rec("quote_leaf_lift", `${CANON}:${TIER}`, "pricing_lift_applied", "Newest");
  const second = { ...first, actor: "Older" };
  const o = originForKey(`${SKU}/${TIER}/lift/pct`, index(), indexRecords([first, second]));
  assert.equal(o.actor, "Newest");
});

test("a per-tier adjustment falls back to the quote-wide lever", () => {
  // Not a guess: with no per-tier row the quote-wide adjustment IS what moved
  // this cell, and it is a different entity entirely.
  const o = originForKey(
    `${SKU}/${TIER}/adjustment`,
    index(),
    indexRecords([rec("quote", QUOTE, "global_price_adj_updated", "Ed Shin")]),
  );
  assert.equal(o.grade, "sourced");
  assert.equal(o.doc, PROVENANCE_INPUTS.global_price_adj.doc);
});

// ── the overlay ───────────────────────────────────────────────────────────

const graph: CostingNode[] = [
  {
    key: `${SKU}/${TIER}/quoted`,
    kind: "override",
    label: "Quoted sell",
    value: 12.5,
    unit: "usd",
    origin: { grade: "thin", actor: null, when: null, doc: null },
    superseded: {
      key: `${SKU}/${TIER}/adjustment`,
      kind: "origin",
      label: "Price adjustment",
      value: 0,
      unit: "pct",
      origin: { grade: "thin", actor: null, when: null, doc: null },
    },
  },
  {
    key: "quote-wide/target-margin",
    kind: "resolution",
    label: "Effective target margin",
    value: 0.35,
    unit: "pct",
    candidates: [
      {
        label: "Quote override",
        value: null,
        chosen: false,
        unavailableReason: "none set",
        provenanceKey: "quote-wide/target-margin/quote-override",
      },
      {
        label: "Firm default",
        value: 0.35,
        chosen: true,
        unavailableReason: null,
        provenanceKey: "quote-wide/target-margin/firm-default",
      },
    ],
  },
];

const RECORDS = [
  rec("assembly_leaf_override", `${SKU}:${TIER}`, "assembly_leaf_sell_override_updated", "Maya"),
  rec("firm_settings", "firm-1", "firm_settings_updated", "Ed Shin"),
];

test("the overlay reaches a superseded chain, not only the active root", () => {
  // An override demotes the computed chain but keeps it reachable, and an
  // operator reading why a price was replaced wants both attributed.
  const map = resolveProvenance(
    graph,
    index(),
    [...RECORDS, rec("quote", QUOTE, "global_price_adj_updated", "Ed Shin")],
  );
  assert.equal(map.get(`${SKU}/${TIER}/quoted`)?.actor, "Maya");
  assert.equal(map.get(`${SKU}/${TIER}/adjustment`)?.actor, "Ed Shin");
});

test("it attributes a candidate by its OWN address", () => {
  const map = resolveProvenance(graph, index(), RECORDS);
  assert.equal(map.get("quote-wide/target-margin/firm-default")?.actor, "Ed Shin");
  // The node is not the rung.
  assert.equal(map.get("quote-wide/target-margin"), undefined);
});

test("only SOURCED entries enter the map", () => {
  // A thin entry in the map would make "has an entry" mean something other than
  // "is attributable", and every read site tests exactly that.
  const map = resolveProvenance(graph, index(), []);
  assert.equal(map.size, 0);
});

test("merging returns the SAME node when nothing resolved", () => {
  // Reference equality is what keeps an unattributed graph from re-rendering
  // every consumer for no change.
  const merged = withProvenance(graph[0], new Map());
  assert.equal(merged, graph[0]);
});

test("merging fills the terminal, the superseded chain and the candidate", () => {
  const map = resolveProvenance(graph, index(), RECORDS);
  const root = withProvenance(graph[0], map);
  assert.equal(root.origin?.grade, "sourced");
  assert.equal(root.origin?.actor, "Maya");
  assert.equal(root.superseded?.origin?.grade, "thin", "no record, so still thin");

  const res = withProvenance(graph[1], map);
  const chosen = (res.candidates ?? []).find((c) => c.chosen)!;
  assert.equal(chosen.origin?.actor, "Ed Shin");
  // And it does NOT mutate the engine's graph.
  assert.equal(graph[1].candidates![1].origin, undefined);
});

test("the accessor answers thin for an absent key", () => {
  assert.deepEqual(originFor("nothing/at/all", new Map()), {
    grade: "thin",
    actor: null,
    when: null,
    doc: null,
  });
  assert.equal(originFor("nothing/at/all", null).grade, "thin");
});

// ── the spec table ────────────────────────────────────────────────────────

test("every governed input names at least one audit action", () => {
  // A spec row with no actions resolves silently to thin forever, which reads
  // as "A-2 shipped and nothing is attributable" rather than as a bug.
  for (const [type, spec] of Object.entries(PROVENANCE_INPUTS)) {
    assert.ok(spec.actions.length > 0, `${type} names no action`);
    assert.ok(spec.entityType.length > 0, `${type} names no entity type`);
    assert.ok(spec.doc.length > 0, `${type} names no document`);
  }
});

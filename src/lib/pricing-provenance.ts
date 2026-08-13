// A-2 · provenance — one capability, projected into every read site.
//
// ── THE CONTRACT ──────────────────────────────────────────────────────────
//
// A trace promises that every chain terminates in a human act. Until now every
// terminal declared `grade: "thin"` — an honest absence, but an absence: the
// audit rows existed and nobody had written the lookup.
//
// This is the lookup, and it is deliberately ONE lookup. The trace overlay,
// CellAction's override attribution and applied-lift provenance are three
// questions with one answer, and three implementations of "who set this" would
// be three chances to disagree about it — the same failure two surfaces
// labelled "packaging" already produced by answering one question with two
// formulas.
//
// ── WHY IT IS AN OVERLAY AND NOT A GRAPH FIELD ────────────────────────────
//
// The engine is pure and cannot read the database, so provenance cannot be
// filled while the graph is built. It could be baked in afterwards, on the
// server — but the client REBUILDS the graph on every optimistic edit, and a
// baked-in field would vanish the moment an operator typed. So provenance is a
// map keyed by node key, carried alongside the graph and merged at read time.
// It survives recomputation because it was never part of what gets recomputed.
//
// ── THE TWO GRADES ARE LOAD-BEARING ───────────────────────────────────────
//
// `thin` is not a deficiency to be filled in later with a plausible guess. It
// states that this terminal cannot name who set it. Upgrading a thin terminal
// to sourced without a record would make the trace assert a human act that
// nothing witnessed — worse than admitting the gap, because the admission is
// visible and the fabrication is not.
//
// Every function here fails toward `thin`.

import type { CostingNode, NodeOrigin } from "./costing-nodes";

/** A terminal whose value a person set, named by what KIND of input it is. */
export type ProvenanceInputType =
  | "packaging_line_cost"
  | "packaging_line_markup"
  | "production_service_fee"
  | "production_policy"
  | "freight_component_cost"
  | "worksheet_freight_amount"
  | "freight_markup"
  | "customs_rate"
  | "sell_price_override"
  | "client_target"
  | "applied_lift"
  | "tier_price_adj"
  | "global_price_adj"
  | "quote_target_margin"
  | "firm_margin_policy";

/**
 * How one governed input type is recorded, and how a node key names it.
 *
 * Declarative on purpose. A new input type is a row here plus an entry in the
 * identity index — not a new branch in three read sites.
 */
export type ProvenanceInputSpec = {
  /** `audit_log.entity_type` the writers use for this input. */
  entityType: string;
  /**
   * `audit_log.action` values that record a change to it.
   *
   * More than one where the same input is authored by more than one path — a
   * per-tier adjustment is written by Apply (P3-016 removed the
   * click-time writer, `applySurgicalAdj`) and by bulk lift, and
   * both are the same commercial fact about the same column.
   */
  actions: readonly string[];
  /** What an operator would call it, for the trace's document line. */
  doc: string;
};

export const PROVENANCE_INPUTS: Record<ProvenanceInputType, ProvenanceInputSpec> = {
  packaging_line_cost: {
    entityType: "assembly_leaf_input",
    actions: ["assembly_leaf_input_cell_updated"],
    doc: "Costs · packaging line",
  },
  packaging_line_markup: {
    entityType: "assembly_leaf_input_line",
    actions: ["assembly_leaf_input_line_updated"],
    doc: "Costs · packaging line markup",
  },
  production_service_fee: {
    entityType: "assembly_production_input",
    actions: ["assembly_production_input_updated"],
    doc: "Costs · production",
  },
  production_policy: {
    entityType: "assembly",
    actions: ["assembly_production_policy_updated"],
    doc: "Costs · production policy",
  },
  freight_component_cost: {
    // NOT the table name. `freight.ts` writes `freight_component_input`, and a
    // plausible-looking guess at the entity type resolves silently to thin —
    // which reads as "A-2 shipped, everything unattributed" rather than as a
    // bug. Every entity type here was read off its writer.
    entityType: "freight_component_input",
    actions: ["freight_component_cost_updated"],
    doc: "Costs · freight",
  },
  // The WORKSHEET model — authoritative on any quote carrying shipment breaks.
  // Freight, duty and tariff amounts are all entered against the shipment's
  // selected destination and audited as one act.
  worksheet_freight_amount: {
    entityType: "freight_destination",
    actions: ["freight_breaks_updated", "freight_destination_updated"],
    doc: "Costs · freight worksheet",
  },
  freight_markup: {
    entityType: "quote",
    actions: ["quote_freight_markup_updated"],
    doc: "Costs · freight markup",
  },
  // The LEGACY leg model's customs rates. Retained because a quote still
  // carrying legs resolves through it; the worksheet path above supersedes it.
  customs_rate: {
    entityType: "freight_leg",
    actions: ["freight_leg_customs_updated"],
    doc: "Costs · customs",
  },
  sell_price_override: {
    entityType: "assembly_leaf_override",
    actions: ["assembly_leaf_sell_override_updated"],
    doc: "Pricing · direct price",
  },
  client_target: {
    entityType: "assembly_leaf_target",
    actions: ["assembly_leaf_client_target_updated"],
    doc: "Pricing · client target",
  },
  // Package 1's evidence. The one input type whose audit entity id is already
  // canonical, because the table it describes is.
  applied_lift: {
    entityType: "quote_leaf_lift",
    actions: ["pricing_lift_applied"],
    doc: "Pricing · applied lift",
  },
  tier_price_adj: {
    entityType: "quote_tier",
    actions: ["tier_price_adj_updated"],
    doc: "Pricing · per-tier adjustment",
  },
  global_price_adj: {
    entityType: "quote",
    actions: ["global_price_adj_updated"],
    doc: "Pricing · quote-wide adjustment",
  },
  quote_target_margin: {
    entityType: "quote",
    actions: ["quote_target_margin_updated"],
    doc: "Pricing · quote target margin",
  },
  firm_margin_policy: {
    // Versioned table: each edit inserts a new row, so the audit id is the row
    // that was current when the value was set — supplied by the loader rather
    // than assumed here.
    entityType: "firm_settings",
    actions: ["firm_settings_updated"],
    doc: "Admin · firm margin policy",
  },
};

/** One audit row, reduced to what provenance needs. */
export type ProvenanceRecord = {
  entityType: string;
  entityId: string;
  action: string;
  actor: string | null;
  when: string | null;
};

/**
 * What a node key needs looked up: which input type, and the id the AUDIT uses.
 *
 * Note the second half. A node key names an identity in the graph's terms; the
 * audit row names one in the writer's terms, and for four of the twelve inputs
 * those differ. The bridge is the identity index below, built from rows the
 * bundle already carries — never inferred, because inferring an id is how a
 * price lands on the wrong commercial line.
 */
export type ProvenanceQuery = {
  inputType: ProvenanceInputType;
  /**
   * Null when the input type is KNOWN but its audit identity could not be
   * located — a missing bridge entry, typically because the row does not exist.
   *
   * The distinction was worth a correction. Collapsing it into "unclassified"
   * reports a governed input as an unknown key, which understates how much of
   * the graph is governed and overstates how much is unmapped — and those are
   * opposite findings that would be acted on in opposite ways. Null resolves
   * THIN: "we know what this is and cannot say who set it", which is true.
   */
  auditId: string | null;
};

/**
 * The bridge between graph identity and audit identity.
 *
 * Supplied by the caller from data it already has. Everything absent from it
 * simply resolves thin, which is the correct outcome for an input whose row
 * cannot be located.
 */
export type ProvenanceIdentityIndex = {
  /** `${lineGroupId}::${tierId}` → `assembly_leaf_inputs.id`. */
  packagingRowByLineTier: ReadonlyMap<string, string>;
  /** engine `skuId` → the assembly that owns it. */
  assemblyBySkuId: ReadonlyMap<string, string>;
  /** `${assemblyId}::${tierId}` → `assembly_production_inputs.id`. */
  productionRowByAssemblyTier: ReadonlyMap<string, string>;
  /** engine `skuId` → legacy `assembly_leaves.id`, for the two sparse tables. */
  legacyLeafBySkuId: ReadonlyMap<string, string>;
  /** engine `skuId` → canonical `quote_leaves.id`, for lifts. */
  canonicalLeafBySkuId: ReadonlyMap<string, string>;
  /** `${legId}::${quoteLeafId}::${tierId}` → `freight_leg_component_tier_costs.id`. */
  freightComponentRowByLegLeafTier: ReadonlyMap<string, string>;
  /** `freight_subcategories.id` -> its selected `freight_destinations.id`. */
  destinationBySubcategoryId: ReadonlyMap<string, string>;
  /** The `firm_settings` row current when the graph was built. */
  firmSettingsId: string | null;
  quoteId: string;
};

/**
 * The same bridge, in a shape that crosses the RSC boundary.
 *
 * Maps arrive as `{}` on the client — the round-trip failure already documented
 * on `HydrateSnapshot` — so the loader returns entry arrays and the client
 * rebuilds. It lives HERE rather than beside the loader because a `"use server"`
 * module may export only async functions, and a sync hydrator in one is a build
 * error rather than a warning.
 */
export type SerialisableIdentityIndex = {
  packagingRowByLineTier: Array<[string, string]>;
  assemblyBySkuId: Array<[string, string]>;
  productionRowByAssemblyTier: Array<[string, string]>;
  legacyLeafBySkuId: Array<[string, string]>;
  canonicalLeafBySkuId: Array<[string, string]>;
  freightComponentRowByLegLeafTier: Array<[string, string]>;
  destinationBySubcategoryId: Array<[string, string]>;
  firmSettingsId: string | null;
  quoteId: string;
};

export function hydrateIdentityIndex(
  i: SerialisableIdentityIndex,
): ProvenanceIdentityIndex {
  return {
    packagingRowByLineTier: new Map(i.packagingRowByLineTier),
    assemblyBySkuId: new Map(i.assemblyBySkuId),
    productionRowByAssemblyTier: new Map(i.productionRowByAssemblyTier),
    legacyLeafBySkuId: new Map(i.legacyLeafBySkuId),
    canonicalLeafBySkuId: new Map(i.canonicalLeafBySkuId),
    freightComponentRowByLegLeafTier: new Map(i.freightComponentRowByLegLeafTier),
    destinationBySubcategoryId: new Map(i.destinationBySubcategoryId),
    firmSettingsId: i.firmSettingsId,
    quoteId: i.quoteId,
  };
}

export function emptyIdentityIndex(quoteId: string): ProvenanceIdentityIndex {
  return {
    packagingRowByLineTier: new Map(),
    assemblyBySkuId: new Map(),
    productionRowByAssemblyTier: new Map(),
    legacyLeafBySkuId: new Map(),
    canonicalLeafBySkuId: new Map(),
    freightComponentRowByLegLeafTier: new Map(),
    destinationBySubcategoryId: new Map(),
    firmSettingsId: null,
    quoteId,
  };
}

const pair = (a: string, b: string) => `${a}::${b}`;

/**
 * A node key → the audit row that records it. The ONE place a node key is
 * interpreted for provenance.
 *
 * Returns null for every key that does not denote a governed input — most of
 * the graph, since arithmetic nodes have no author. Null means thin, and thin
 * is a true statement, so there is no fallback branch to get wrong.
 */
export function classifyNodeKey(
  key: string,
  index: ProvenanceIdentityIndex,
): ProvenanceQuery | null {
  const parts = key.split("/");

  // quote-wide/{name}[/{authority}]
  //
  // A resolution NODE has no author — nobody sets a choice. Its winning RUNG
  // does, and each rung names its own authority (`NodeCandidate.provenanceKey`),
  // which is why these are addressed one level deeper than the node.
  if (parts[0] === "quote-wide") {
    if (parts[1] === "target-margin" || parts[1] === "floor-margin") {
      if (parts[2] === "quote-override") {
        return { inputType: "quote_target_margin", auditId: index.quoteId };
      }
      if (parts[2] === "firm-default") {
        return { inputType: "firm_margin_policy", auditId: index.firmSettingsId };
      }
    }
    return null;
  }

  // quote/{tierId}/...  — aggregates. Nobody authors a total.
  if (parts[0] === "quote") return null;

  // cell scope: {skuId}/{tierId}/...
  const [skuId, tierId, section] = parts;
  if (!skuId || !tierId || !section) return null;

  switch (section) {
    case "pkg": {
      const lineGroupId = parts[3];
      if (!lineGroupId) return null;
      if (parts[4] === "cost") {
        const rowId = index.packagingRowByLineTier.get(pair(lineGroupId, tierId));
        return { inputType: "packaging_line_cost", auditId: rowId ?? null };
      }
      if (parts[4] === "markup") {
        // The line-level audit keys on the line group itself, which IS what the
        // node key carries — no bridge needed for this one.
        return { inputType: "packaging_line_markup", auditId: lineGroupId };
      }
      return null;
    }
    // Bulk raw cost lives on the SAME per-(assembly, tier) row as the service
    // fees, so it is one governed input appearing under two section names.
    case "prod":
    case "raw": {
      const assemblyId = index.assemblyBySkuId.get(skuId);
      // Policy flags are per-assembly; fees and raw are per-(assembly, tier).
      if (section === "prod" && parts[3] === "policy") {
        return { inputType: "production_policy", auditId: assemblyId ?? null };
      }
      const rowId = assemblyId
        ? index.productionRowByAssemblyTier.get(pair(assemblyId, tierId))
        : undefined;
      return { inputType: "production_service_fee", auditId: rowId ?? null };
    }
    case "frt": {
      // WORKSHEET: {sku}/{tier}/frt/shipment/{subcategoryId}/{charge}/{total|markup}
      //
      // Freight, duty and tariff all resolve to the same destination row. That
      // is not a simplification — one edit of the destination's breaks sets
      // all three, so one act is genuinely the answer for all three.
      if (parts[3] === "shipment") {
        const subcategoryId = parts[4];
        if (!subcategoryId) return null;
        if (parts[6] === "markup") {
          return { inputType: "freight_markup", auditId: index.quoteId };
        }
        if (parts[6] === "total") {
          const destinationId = index.destinationBySubcategoryId.get(subcategoryId);
          return {
            inputType: "worksheet_freight_amount",
            auditId: destinationId ?? null,
          };
        }
        return null;
      }
      // LEGACY: {sku}/{tier}/frt/leg/{legId}/...
      if (parts[3] !== "leg") return null;
      const legId = parts[4];
      if (!legId) return null;
      // Duty and tariff rates are per-LEG and the leg id is already in the key,
      // so this one needs no bridge.
      if (parts[5] === "duty" || parts[5] === "tariff") {
        return { inputType: "customs_rate", auditId: legId };
      }
      if (parts[5] === "container" && parts[6] === "cost") {
        const canonical = index.canonicalLeafBySkuId.get(skuId);
        if (!canonical) return null;
        const rowId = index.freightComponentRowByLegLeafTier.get(
          `${legId}::${canonical}::${tierId}`,
        );
        return { inputType: "freight_component_cost", auditId: rowId ?? null };
      }
      return null;
    }
    case "lift": {
      const canonical = index.canonicalLeafBySkuId.get(skuId);
      // `applyCellId` — the durable single-colon address, not the staging `::`.
      return {
        inputType: "applied_lift",
        auditId: canonical ? `${canonical}:${tierId}` : null,
      };
    }
    case "quoted": {
      const legacy = index.legacyLeafBySkuId.get(skuId);
      return {
        inputType: "sell_price_override",
        auditId: legacy ? `${legacy}:${tierId}` : null,
      };
    }
    case "adjustment":
      // Per-tier when one is set, quote-wide otherwise. The resolver tries the
      // tier first and falls back — both are the same commercial lever and the
      // trace names whichever actually moved this cell.
      return { inputType: "tier_price_adj", auditId: tierId };
    default:
      return null;
  }
}

/** Latest record wins. Keyed the way `classifyNodeKey` asks for them. */
export function indexRecords(
  records: readonly ProvenanceRecord[],
): ReadonlyMap<string, ProvenanceRecord> {
  const out = new Map<string, ProvenanceRecord>();
  for (const r of records) {
    const k = pair(r.entityType, r.entityId);
    const seen = out.get(k);
    // Ties keep the first, since the loader orders newest first. Comparing
    // timestamps here would re-implement the ORDER BY and could disagree with it.
    if (!seen) out.set(k, r);
  }
  return out;
}

const THIN: NodeOrigin = { grade: "thin", actor: null, when: null, doc: null };

/**
 * Resolve one node key.
 *
 * Fails to `thin` at every step: unclassifiable key, missing bridge entry,
 * no audit row. Each of those is a real "we cannot say who", and saying so is
 * the whole point of the grade.
 */
export function originForKey(
  key: string,
  index: ProvenanceIdentityIndex,
  byEntity: ReadonlyMap<string, ProvenanceRecord>,
): NodeOrigin {
  const q = classifyNodeKey(key, index);
  if (!q) return THIN;
  // A governed input whose identity could not be located. Thin is the true
  // statement, and stating it is the point of the grade.
  if (q.auditId === null) return THIN;
  const spec = PROVENANCE_INPUTS[q.inputType];

  const record = byEntity.get(pair(spec.entityType, q.auditId));

  // The adjustment's one fallback: no per-tier row means the quote-wide lever
  // is what moved this cell, and that is a different entity entirely.
  if (!record && q.inputType === "tier_price_adj") {
    const g = PROVENANCE_INPUTS.global_price_adj;
    const globalRecord = byEntity.get(pair(g.entityType, index.quoteId));
    if (globalRecord) {
      return {
        grade: "sourced",
        actor: globalRecord.actor,
        when: globalRecord.when,
        doc: g.doc,
      };
    }
    return THIN;
  }

  if (!record) return THIN;
  // An actor is what makes a terminal attributable. A row with none is a record
  // that something changed, not a record of who changed it, and the trace's
  // promise is the latter.
  if (!record.actor) return THIN;
  return { grade: "sourced", actor: record.actor, when: record.when, doc: spec.doc };
}

/** Node key → origin, for every terminal in the graph that has one. */
export type ProvenanceMap = ReadonlyMap<string, NodeOrigin>;

/**
 * Walk the graph once and resolve every terminal.
 *
 * Terminals only — `origin` and `override` carry provenance, and `resolution`
 * carries it on its chosen candidate (see `resolveCandidateOrigin`). Arithmetic
 * nodes have no author: nobody set a sum, so nothing is looked up for one and
 * nothing appears where an answer would be misleading.
 */
export function resolveProvenance(
  roots: readonly CostingNode[],
  index: ProvenanceIdentityIndex,
  records: readonly ProvenanceRecord[],
): ProvenanceMap {
  const byEntity = indexRecords(records);
  const out = new Map<string, NodeOrigin>();

  const visit = (n: CostingNode) => {
    if (n.kind === "origin" || n.kind === "override") {
      const o = originForKey(n.key, index, byEntity);
      if (o.grade === "sourced") out.set(n.key, o);
    }
    if (n.kind === "resolution" && n.candidates) {
      // Every rung, not only the winner. A losing rung is what makes the winner
      // legible — "35% because this quote says so" against "35% because the
      // firm does" — and an operator comparing them wants to know who set each.
      //
      // Keyed by the rung's OWN address. The resolution node itself gets
      // nothing: nobody authors a choice, and attaching the winner's author to
      // the choice would say a person made the decision the ladder made.
      for (const c of n.candidates) {
        if (!c.provenanceKey) continue;
        const o = originForKey(c.provenanceKey, index, byEntity);
        if (o.grade === "sourced") out.set(c.provenanceKey, o);
      }
    }
    for (const child of n.operands ?? []) visit(child);
    if (n.superseded) visit(n.superseded);
  };
  for (const r of roots) visit(r);
  return out;
}

/** The ONE accessor. Every read site goes through it; none re-derives. */
export function originFor(key: string, map: ProvenanceMap | null): NodeOrigin {
  return map?.get(key) ?? THIN;
}

/**
 * Merge the overlay onto a node for rendering.
 *
 * Returns the SAME node when nothing is sourced, so an unattributed graph is
 * not needlessly copied and reference equality still holds for consumers that
 * rely on it. Never downgrades: a node the engine already described stays
 * described, because the overlay adds attribution and does not replace facts.
 */
export function withProvenance(
  node: CostingNode,
  map: ProvenanceMap | null,
): CostingNode {
  if (!map || map.size === 0) return node;

  const nextOrigin = map.get(node.key);
  const nextCandidates = node.candidates?.map((c) => {
    const o = c.provenanceKey ? map.get(c.provenanceKey) : undefined;
    return o ? { ...c, origin: o } : c;
  });
  const nextOperands = node.operands?.map((o) => withProvenance(o, map));
  const nextSuperseded = node.superseded
    ? withProvenance(node.superseded, map)
    : undefined;

  const candidatesChanged =
    nextCandidates !== undefined &&
    nextCandidates.some((c, i) => c !== node.candidates![i]);
  const operandsChanged =
    nextOperands !== undefined && nextOperands.some((o, i) => o !== node.operands![i]);
  const supersededChanged = nextSuperseded !== node.superseded;

  if (!nextOrigin && !candidatesChanged && !operandsChanged && !supersededChanged) {
    return node;
  }
  return {
    ...node,
    ...(nextOrigin ? { origin: nextOrigin } : {}),
    ...(candidatesChanged ? { candidates: nextCandidates } : {}),
    ...(operandsChanged ? { operands: nextOperands } : {}),
    ...(supersededChanged ? { superseded: nextSuperseded } : {}),
  };
}

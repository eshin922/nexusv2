// A-2 · provenance coverage, per governed input type.
//
// A-2 asks for "a written query per input type, proven against production, with
// the cost measured. Inputs with no record are a finding (F5, §6.3)."
//
// This is the proof. It runs the real loader and the real resolver over a real
// quote's real graph, then reports, per input type, how many terminals resolved
// SOURCED and how many stayed THIN.
//
// A thin terminal is not a failure of this script. It is the finding A-2 asks
// for, and the two causes are worth telling apart:
//
//   · nothing has edited that input on this quote since the audit trail began
//   · nothing writes an audit row for that input type at all
//
// The second is reported separately, from the loader's own
// `unattributedInputTypes`, because an empty result cannot distinguish them.
//
//   node --env-file=<env> --experimental-strip-types --conditions=react-server \
//     --experimental-loader ./scripts/support/src-resolver.mjs \
//     scripts/rehearsal/a2-provenance-coverage.ts <quoteId>

import { getCostingBundle } from "../../src/app/actions/costing.ts";
import { loadQuoteProvenance } from "../../src/app/actions/pricing-provenance.ts";
import {
  classifyNodeKey,
  hydrateIdentityIndex,
  indexRecords,
  originForKey,
  PROVENANCE_INPUTS,
  type ProvenanceInputType,
} from "../../src/lib/pricing-provenance.ts";
import type { CostingNode } from "../../src/lib/costing-nodes.ts";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: a2-provenance-coverage.ts <quoteId>");
  process.exit(1);
}

const bundle = await getCostingBundle(quoteId);
if (!bundle.ok) throw new Error(`bundle: ${bundle.error.message}`);
const prov = await loadQuoteProvenance(quoteId);
if (!prov.ok) throw new Error(`provenance: ${prov.error.message}`);

const index = hydrateIdentityIndex(prov.data.index);
const byEntity = indexRecords(prov.data.records);

type Tally = { sourced: number; thin: number; sample: string | null };
const perType = new Map<ProvenanceInputType, Tally>();
let unclassified = 0;
let terminals = 0;
/**
 * Unclassified terminals, tallied by key SHAPE rather than counted.
 *
 * A bare count cannot distinguish "an aggregate nobody authored" from "an
 * authored input the classifier does not know about", and those are opposite
 * findings. The shape is the key with its identifiers removed.
 */
const unclassifiedShapes = new Map<string, number>();
const shapeOf = (key: string) => {
  const p = key.split("/");
  if (p[0] === "quote-wide") return p.slice(0, 3).join("/");
  if (p[0] === "quote") return ["quote", "{tier}", ...p.slice(2, 3)].join("/");
  // {sku}/{tier}/section/...
  return ["{sku}", "{tier}", ...p.slice(2)]
    .map((seg) => (/^[0-9a-f-]{36}$/i.test(seg) ? "{id}" : seg))
    .join("/");
};
const noteUnclassified = (key: string) => {
  unclassified++;
  const sh = shapeOf(key);
  unclassifiedShapes.set(sh, (unclassifiedShapes.get(sh) ?? 0) + 1);
};

const bump = (t: ProvenanceInputType, sourced: boolean, actor: string | null) => {
  const cur = perType.get(t) ?? { sourced: 0, thin: 0, sample: null };
  if (sourced) {
    cur.sourced++;
    cur.sample = cur.sample ?? actor;
  } else cur.thin++;
  perType.set(t, cur);
};

const visit = (n: CostingNode) => {
  if (n.kind === "origin" || n.kind === "override") {
    terminals++;
    const q = classifyNodeKey(n.key, index);
    if (!q) noteUnclassified(n.key);
    else {
      const o = originForKey(n.key, index, byEntity);
      bump(q.inputType, o.grade === "sourced", o.actor);
    }
  }
  for (const c of n.candidates ?? []) {
    if (!c.provenanceKey) continue;
    terminals++;
    const q = classifyNodeKey(c.provenanceKey, index);
    if (!q) noteUnclassified(c.provenanceKey);
    else {
      const o = originForKey(c.provenanceKey, index, byEntity);
      bump(q.inputType, o.grade === "sourced", o.actor);
    }
  }
  for (const child of n.operands ?? []) visit(child);
  if (n.superseded) visit(n.superseded);
};
for (const root of bundle.data.costing.graph.nodes) visit(root);

const rows = (Object.keys(PROVENANCE_INPUTS) as ProvenanceInputType[]).map((t) => {
  const tally = perType.get(t);
  return {
    inputType: t,
    entityType: PROVENANCE_INPUTS[t].entityType,
    terminals: tally ? tally.sourced + tally.thin : 0,
    sourced: tally?.sourced ?? 0,
    thin: tally?.thin ?? 0,
    sampleActor: tally?.sample ?? null,
    // Distinguishes "no rows anywhere for this entity type" from "rows exist,
    // this quote's terminals just did not match one".
    noAuditRowsAtAll: prov.data.unattributedInputTypes.includes(t),
  };
});

console.log(
  JSON.stringify(
    {
      quoteId,
      cost: prov.data.cost,
      terminalsWalked: terminals,
      unclassifiedTerminals: unclassified,
      unclassifiedShapes: Array.from(unclassifiedShapes)
        .sort((a, b) => b[1] - a[1])
        .map(([shape, count]) => ({ shape, count })),
      coverage: rows,
    },
    null,
    1,
  ),
);

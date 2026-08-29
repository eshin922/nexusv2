import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

async function srcFiles(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(rel);
      else if (/\.tsx?$/.test(e.name)) out.push(rel);
    }
  };
  await walk("src");
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// ONE CONSTRUCTED STATE — PROVEN BY CALL-SITE COUNT, NOT BY AGREEING TOTALS.
//
// The same proof shape used for `projectCommercial`, and for the same reason:
// two constructions can agree today and diverge on the next change. Asserting
// that totals match is a claim about a pair of computations at one moment;
// asserting that there is only one computation is a claim about the code.
//
// This is not hypothetical here. Before the cutover the engine and the
// projection each derived one-time charge amounts independently, and they
// disagreed by ~1e-12 on eight real rows — the engine marked up a per-unit
// QUOTIENT, the projection marked up the column TOTAL. Both defensible.
// Neither the other. Every total still reconciled to the cent.
// ═══════════════════════════════════════════════════════════════════════

test("one authoritative construction, invoked once per legitimate owner", async () => {
  // WAS: "the construction is built at exactly ONE place in the tree",
  // asserting a single CALL SITE. That was the right proxy while exactly one
  // owner existed - a leaf - and it stopped being right when OD-028 made the
  // Item Group a construction owner in its own right.
  //
  // The property being protected has NOT changed and is what is asserted now:
  // one authoritative implementation, and no parallel derivation of the same
  // amounts. Counting invocations would forbid a second OWNER; counting
  // implementations forbids a second ANSWER, which is the thing that bit -
  // engine and projection each deriving one-time charge amounts and disagreeing
  // by ~1e-12 on eight real rows, both defensible, neither the other.
  //
  // Both call sites are in the engine, and both call the SAME constructor with
  // the same arguments; the assembly does not compute placement itself.
  const sites: string[] = [];
  const files = await srcFiles();
  for (const f of files) {
    if (f === "src/lib/commercial-recovery/construct.ts") continue;
    const src = codeOnly(await read(f));
    for (const m of src.matchAll(/\b(constructCommercial|composeFromPlacements)\s*[(]/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/export function\s*$/.test(before)) continue;
      sites.push(`${f}: ${m[1]}`);
    }
  }

  // ONE FILE, and it is the engine. A construction anywhere else - a surface, a
  // projection, an action - is a second answer waiting to disagree.
  assert.deepEqual(
    [...new Set(sites.map((x) => x.split(":")[0]))],
    ["src/lib/costing.ts"],
    "a construction exists outside the engine - 'the document matches the " +
      "rollup' is back to being a claim about two computations agreeing",
  );

  // And it is `constructCommercial` each time: nothing reaches past it into
  // `composeFromPlacements` to compose totals without deciding placement.
  assert.deepEqual(
    [...new Set(sites.map((x) => x.split(": ")[1]))],
    ["constructCommercial"],
    "something composes placements without going through the constructor",
  );

  // One per legitimate owner: the leaf cell and the Item Group. If a third
  // appears, it is a new economic owner and belongs in this list deliberately.
  assert.equal(sites.length, 2, `construction call sites: ${sites.join(", ")}`);
});
test("elections reach the ENGINE, and only the engine", async () => {
  // Placement decided at the surface that renders it is the defect this
  // cutover removes. The election therefore enters at the construction and
  // nowhere else.
  const files = await srcFiles();
  const readers: string[] = [];
  for (const f of files) {
    const src = codeOnly(await read(f));
    if (/\bchargeElections\b/.test(src)) readers.push(f);
  }
  readers.sort();
  assert.deepEqual(readers, [
    "src/app/actions/costing.ts", // loads them onto the bundle
    "src/lib/costing-store.ts", // carries them on the snapshot
    "src/lib/costing.ts", // RESOLVES them into the construction
    // Back, and for the reason R5 got wrong. The resolver passes the bundle's
    // elections to the workspace read model, which uses them ONLY to say which
    // treatment is currently in force -- it resolves nothing and prices
    // nothing, because placement and amounts come from `constructed`, asserted
    // separately. A label, not a second decision.
    //
    // It was removed when R5 deleted Commercial recovery from this surface;
    // the registered Customer View authority puts that card back as card 1 of
    // four, so the read model has a consumer again.
    "src/lib/customer-view-resolver.ts",
    // The adapter carries them into the input it builds. REQUIRED there, not
    // optional: it builds the whole `QuoteCostingInput`, so a field it does not
    // carry is a field the engine never sees — which is exactly how an election
    // came to persist, read back as elected, and move nothing.
    "src/lib/costing-adapter.ts",
    // Substitutes a CANDIDATE election into the engine's input to measure what
    // that contract would do to the customer's total, then throws the
    // counterfactual away. It resolves nothing and prices nothing: the answer
    // comes back from `computeQuoteCosting` and the construction it builds.
    //
    // A closed form for the delta would have avoided appearing in this list
    // and would have been the exact defect the list guards -- the ladder is
    // not `(1 + gpa)` once a lift, a tier adjustment or a terminal override is
    // involved, so a formula would be a second authority for the pricing
    // ladder. Running the engine is what keeps there being one.
    "src/lib/commercial-recovery/impact.ts",
  ].sort());
});

// ═══════════════════════════════════════════════════════════════════════
// THE SEVEN-CONSUMER TRACE.
//
// Not "the totals agree" — a claim about where each consumer's number COMES
// FROM. Each step below names the one before it, so a consumer that grew an
// independent opinion about a charge breaks the chain rather than silently
// agreeing with it until it does not.
// ═══════════════════════════════════════════════════════════════════════

test("1+2 · quoteRollup revenue, cost and margin derive from the construction", async () => {
  const src = codeOnly(await read("src/lib/costing.ts"));

  // BOTH placements, which is the half that was missing. `separate_line`
  // reached the tier operands at the cutover; `unit_price` did not — it was
  // still decided by `production.allocateServiceFeesToCost` at the unit-cost
  // line, so half of one decision was made in two places and
  // `constructed.unitPriceCost` was read by nothing at all.
  assert.match(
    src,
    /allocatedServiceFeesPerUnit =[\s\S]{0,60}?constructed\.unitPriceCostLegacy \/ denom : 0;/,
    "the allocated fee is decided by the boolean again, or stopped reading the " +
      "LEGACY bucket — an elected amortization must not come through here, " +
      "because this feeds the marked-up sell build-up",
  );
  assert.doesNotMatch(
    src,
    /production\.allocateServiceFeesToCost && denom > 0/,
    "the unit-price half went back to reading the boolean directly",
  );

  assert.match(src, /const sepCost = pt\.constructed\.separateLineCost;/);
  assert.match(src, /const sepRecovery = pt\.constructed\.separateLineRecovery \?\? 0;/);

  // The operands the tier's revenue and cost are summed FROM.
  assert.match(src, /revenueOperands\.push\(\{[\s\S]{0,400}?value: sepRecovery/);
  assert.match(src, /costOperands\.push\(\{[\s\S]{0,400}?value: sepCost/);
  // And margin is computed from those two totals, not from a third source.
  assert.match(src, /revenue > 0 \? \(revenue - cost\) \/ revenue : null/);
});

test("3+4 · the fingerprint and the SEND gate read that rollup", async () => {
  const gate = codeOnly(await read("src/lib/below-floor-send-gate.ts"));
  assert.match(gate, /bundle\.data\.costing\.quoteRollup/);
  // The fingerprinting moved into `below-floor-projection`, shared with the
  // Customer View footer so the surface and the gate cannot answer the same
  // question differently. The property is unchanged: whatever is fingerprinted
  // must be the rollup that was just read, not a second one.
  assert.match(
    gate,
    /rollups: bundle\.data\.costing\.quoteRollup/,
    "the gate must hand the projection the rollup it just read",
  );
  const proj = codeOnly(await read("src/lib/below-floor-projection.ts"));
  assert.match(
    proj,
    /fingerprintCommercialState\(\{[\s\S]{0,220}?totalRevenue: tier\.totalRevenue[\s\S]{0,120}?totalCost: tier\.totalCost/,
    "the projection fingerprints something other than the rollup it was given",
  );
  assert.doesNotMatch(
    proj,
    /getCostingBundle|computeQuoteCosting/,
    "the projection must not read a second costing of its own",
  );
  // The fingerprint itself takes the three terms and derives nothing.
  const fp = codeOnly(await read("src/lib/below-floor-authorization.ts"));
  assert.match(fp, /export function fingerprintCommercialState\(input: \{[\s\S]{0,200}?totalRevenue: number/);
  assert.doesNotMatch(fp, /getCostingBundle|computeQuoteCosting/, "the fingerprint recomputes its own inputs");
});

test("5 · the customer projection reads the construction and prices nothing", async () => {
  const src = codeOnly(await read("src/lib/commercial-projection.ts"));
  assert.match(src, /constructedFor\(assemblyId, t\.tierId\)/);
  assert.match(src, /placed\.placement !== "separate_line"/);
  assert.match(src, /placed\.revenueContribution/);
  assert.doesNotMatch(src, /resolveCharge/, "the seam resolves placement");
  assert.doesNotMatch(src, /1 \+ productionMarkupPct/, "the seam re-prices a charge");
  assert.doesNotMatch(src, /ChargeElection|electionByCharge/i, "the seam can still be handed elections");
});

test("6 · the frozen matrix is handed the projection INSTANCE, never a rebuild", async () => {
  const send = codeOnly(await read("src/app/actions/quotes.ts"));
  assert.match(send, /freezeCommercialLineSet\(\s*tx,\s*snapshot\.id,\s*resolved\.commercial\s*\)/);
  assert.doesNotMatch(
    send,
    /freezeCommercialLineSet\([^)]*projectCommercial\s*\(/,
    "the send path constructs a second projection to freeze",
  );
  const freeze = codeOnly(await read("src/lib/commercial-freeze.ts"));
  assert.doesNotMatch(freeze, /computeQuoteCosting|projectCommercial\(/, "the freeze recomputes");
});

test("7 · the NetSuite projection reads the FROZEN total, not a live recompute", async () => {
  const complete = codeOnly(await read("src/lib/netsuite/mark-complete.ts"));
  // The order amount comes from the frozen commercial record — decided before
  // this work and load-bearing for it: the repair moved the gate's INPUT and
  // left the external write untouched.
  assert.match(complete, /currentAmount = Number\(decimalFromCents\(frozenOrder\.totalCents\)\)/);
  assert.doesNotMatch(
    complete,
    /currentAmount = Number\(tierRollup\.totalRevenue/,
    "the SO amount went back to a live recompute",
  );
});

test("the whole chain has ONE root, and it is the construction", async () => {
  // Stated as a single assertion so the trace above cannot pass while the
  // thing it traces has been duplicated somewhere new.
  const sites: string[] = [];
  for (const f of await srcFiles()) {
    if (f === "src/lib/commercial-recovery/construct.ts") continue;
    const src = codeOnly(await read(f));
    for (const m of src.matchAll(/(constructCommercial|composeFromPlacements)\s*\(/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/export function\s*$/.test(before)) continue;
      sites.push(f);
    }
  }
  assert.deepEqual([...new Set(sites)], ["src/lib/costing.ts"]);
});

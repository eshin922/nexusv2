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

test("the construction is built at exactly ONE place in the tree", async () => {
  const sites: string[] = [];
  for (const f of await srcFiles()) {
    // The constructor module composing itself is the DEFINITION, not a second
    // construction: `constructCommercial` resolves placement and delegates the
    // arithmetic to `composeFromPlacements` inside the same file.
    if (f === "src/lib/commercial-recovery/construct.ts") continue;
    const src = codeOnly(await read(f));
    for (const m of src.matchAll(/\b(constructCommercial|composeFromPlacements)\s*\(/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/export function\s*$/.test(before)) continue; // declarations
      sites.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(
    sites,
    ["src/lib/costing.ts: constructCommercial"],
    "a second construction exists — 'the document matches the rollup' is back " +
      "to being a claim about two computations agreeing",
  );
});

test("the projection READS the construction and derives nothing", async () => {
  const src = codeOnly(await read("src/lib/commercial-projection.ts"));

  // It looks the state up...
  assert.match(src, /constructedFor\(assemblyId, t\.tierId\)/);
  // ...and gates the customer line on the PLACEMENT rather than reassembling
  // it from a mode and an allocation boolean.
  assert.match(src, /placed\.placement !== "separate_line"/);
  assert.match(src, /placed\.revenueContribution/);

  // And it decides nothing: no resolution, no rate arithmetic, no elections.
  assert.doesNotMatch(src, /resolveCharge/, "the seam resolves placement");
  assert.doesNotMatch(src, /1 \+ productionMarkupPct/, "the seam re-prices a charge");
  assert.doesNotMatch(src, /\belections?\b/i, "the seam can still be handed elections");
});

test("the engine's tier totals read the construction, not a per-unit round trip", async () => {
  const src = codeOnly(await read("src/lib/costing.ts"));

  // `separateServiceFeesPerUnit * tQty` divided a total by tier quantity and
  // multiplied it back out. The bare division round-trips exactly on every
  // live row; the MARKED-UP one does not — 23799.999999999996 against 23800.
  assert.match(src, /const sepCost = pt\.constructed\.separateLineCost;/);
  assert.match(src, /const sepRecovery = pt\.constructed\.separateLineRecovery \?\? 0;/);
  assert.doesNotMatch(
    src,
    /separateServicesMarkupSumPerUnit \* tQty/,
    "the tier operand went back to re-deriving from a per-unit rate",
  );
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
    "src/lib/costing.ts", // resolves them into the construction
  ]);
});

test("every consumer of a commercial total is downstream of the construction", async () => {
  // Not a totals comparison — a statement about where each consumer's number
  // comes from. The rollup is built from the constructed operands; everything
  // below reads the rollup or the projection, so none of them can hold an
  // independent opinion about a charge.
  const engine = codeOnly(await read("src/lib/costing.ts"));
  assert.match(engine, /revenueOperands\.push\(\{[\s\S]{0,400}?value: sepRecovery/);
  assert.match(engine, /costOperands\.push\(\{[\s\S]{0,400}?value: sepCost/);

  // fingerprint + SEND gate read the rollup the operands built
  const gate = codeOnly(await read("src/lib/below-floor-send-gate.ts"));
  assert.match(gate, /bundle\.data\.costing\.quoteRollup/);
  assert.match(gate, /fingerprintCommercialState\(\{[\s\S]{0,200}?totalRevenue: tier\.totalRevenue/);

  // the frozen matrix is handed the projection instance, never a rebuild
  const send = codeOnly(await read("src/app/actions/quotes.ts"));
  assert.match(send, /freezeCommercialLineSet\(\s*tx,\s*snapshot\.id,\s*resolved\.commercial\s*\)/);

  // and the SO amount reads the FROZEN total rather than a live recompute
  const complete = codeOnly(await read("src/lib/netsuite/mark-complete.ts"));
  assert.match(complete, /currentAmount = Number\(decimalFromCents\(frozenOrder\.totalCents\)\)/);
});

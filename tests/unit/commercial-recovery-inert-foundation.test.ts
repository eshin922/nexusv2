import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import { resolveCharge } from "../../src/lib/commercial-recovery/resolve.ts";
import { RECOVERY_CHARGES } from "../../src/lib/commercial-recovery/registry.ts";
import type { QuoteCostingResult } from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// THE INERT-FOUNDATION CLAIM, ASSERTED RATHER THAN ASSERTED-TO.
//
// This branch is offered for review as INFRASTRUCTURE, not as recovery
// implemented. That claim is only worth anything if it can fail, so each part
// of it is a test:
//
//   1. no production path supplies an election;
//   2. nothing imports the writer, so no action endpoint exists;
//   3. with no election the projection computes the IDENTICAL boolean it did
//      before, by no arithmetic;
//   4. the one branch added to the suppression condition is unreachable
//      without an election;
//   5. every fee column resolves — a missing mapping would throw where the
//      old code could not.
//
// The one runtime change this branch does make is named in the last test
// rather than left for a reviewer to find.
// ═══════════════════════════════════════════════════════════════════════

// ── 1 · no production path supplies an election ─────────────────────────

test("the only call site of projectCommercial passes no elections", async () => {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  await walk("src");

  const calls: string[] = [];
  for (const f of files) {
    const src = codeOnly(await read(f));
    for (const m of src.matchAll(/projectCommercial\s*\(([^)]*)\)/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/export function\s*$/.test(before)) continue; // the declaration
      calls.push(`${f}: projectCommercial(${m[1].trim()})`);
    }
  }

  assert.deepEqual(
    calls,
    [
      // The impact preview projects a COUNTERFACTUAL costing to answer "what
      // would this contract do to the customer's total". It substitutes the
      // candidate election into the ENGINE'S input and projects the result --
      // it passes no elections to the projection, which is the property this
      // check exists for. Placement is still decided in exactly one place.
      "src/lib/commercial-recovery/impact.ts: projectCommercial(bundle)",
      "src/lib/customer-view-resolver.ts: projectCommercial(bundle.data)",
    ],
    "a caller began supplying elections to the PROJECTION — placement would be decided twice",
  );

  // The property, asserted directly rather than inferred from the list: no
  // call site hands an election to the projection under any name.
  for (const c of calls) {
    assert.doesNotMatch(
      c,
      /election/i,
      `${c} passes elections to the projection — they must enter at the construction`,
    );
  }
});

// ── 2 · the writer has no caller, so it has no endpoint ─────────────────

test("the election writer has exactly ONE caller, and it is the workspace", async () => {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  await walk("src");

  const callers: string[] = [];
  for (const f of files) {
    if (f === "src/app/actions/commercial-recovery-persist.ts") continue;
    const src = codeOnly(await read(f));
    if (/persistChargeRecoverySet/.test(src)) callers.push(f);
  }

  // Card 1, and only Card 1.
  //
  // Zero while the foundation was inert, one when the workspace shipped, zero
  // again when R5 removed it from Quote Presentation, and one again now that
  // the registered Customer View authority puts Commercial recovery back in
  // the rail as card 1 of four. The number is not the property; the property
  // is that exactly ONE surface may write an election, because a "use server"
  // export becomes a POST-able endpoint by being imported.
  //
  // See docs/design-authority/customer-view/BUNDLE.md D1 and D3: the election
  // moves economics, is governed by Pricing, and lives on this surface.
  // The caller moved from the card to the DRAFT, which is the whole shape of
  // evaluate-first: the card asks for an evaluation, the draft persists behind
  // it, and both gates flush through the same owner. The number is still not
  // the property — the property is that exactly ONE module may write an
  // election, because a `"use server"` export becomes a POST-able endpoint by
  // being imported.
  assert.deepEqual(
    callers,
    ["src/components/quote/use-recovery-draft.ts"],
    "the election writer acquired a caller outside the recovery draft",
  );
});

// ── 3 · the no-election boolean is the OLD boolean, exactly ─────────────

test("with no election, resolution reproduces the pre-recovery boolean", () => {
  // The claim is not "equivalent" but IDENTICAL: for every one-time charge and
  // every value the column can hold, `mode === "included"` equals the
  // expression the projection read before recovery existed.
  for (const charge of RECOVERY_CHARGES.filter((c) => c.grain === "one_time")) {
    for (const stored of [true, false, null, undefined]) {
      const preRecovery = stored ?? true; // the literal old expression
      const resolved = resolveCharge(charge.key, null, stored);
      assert.equal(
        resolved.mode === "included",
        preRecovery,
        `${charge.key} at ${String(stored)}: resolution changed the boolean`,
      );
      assert.equal(resolved.source, "legacy");
    }
  }
});

test("no arithmetic stands between the stored column and the boolean", async () => {
  const src = codeOnly(await read("src/lib/commercial-recovery/resolve.ts"));
  const legacy = src.slice(src.indexOf("const allocate = perAssemblyAllocate"));
  // OD-025: a repair whose premise was that it moved no money moved
  // blendedMarginPct on three real quotes, because subtracting a component and
  // re-adding it does not reproduce the original bits. Nothing here subtracts,
  // and this is what keeps it that way.
  assert.doesNotMatch(
    legacy.slice(0, 200),
    /[+\-*/]\s*\d|Number\(|parseFloat/,
    "arithmetic entered the legacy resolution path",
  );
});

// ── 4 · the added branch is unreachable without an election ─────────────

test("`absorbed` cannot arise from legacy resolution", () => {
  // The suppression condition gained `|| resolved.mode === "absorbed"`. With no
  // election that disjunct must be constantly false, or the branch changes what
  // existing quotes render.
  for (const charge of RECOVERY_CHARGES) {
    for (const stored of [true, false, null, undefined]) {
      assert.notEqual(
        resolveCharge(charge.key, null, stored).mode,
        "absorbed",
        `${charge.key} resolved to absorbed with no election`,
      );
    }
  }
});

// ── 5 · every fee column resolves; none can throw ───────────────────────

const TIER = "11111111-1111-1111-1111-111111111111";

function bundle(allocate: boolean, fees: Record<string, unknown>): HydrateSnapshot {
  const tiers: QuoteCostingResult["tiers"] = [{ tierId: TIER, label: "Tier 1", qty: 1000 }];
  return {
    markupDefaults: { Production: 0.4 },
    skus: [
      { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "Group", canonicalQuoteLeafId: "asm", qtyPerParent: null, sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", canonicalQuoteLeafId: "leaf", qtyPerParent: "1", sortOrder: 0, retailBenchmark: null },
    ],
    production: [{ quoteSkuId: "leaf", tierId: TIER, allocateServiceFeesToCost: allocate, ...fees }],
    costing: {
      tiers,
      skuRollups: [
        {
          skuId: "leaf", canonicalQuoteLeafId: "leaf", skuRole: "leaf", parentSkuId: "asm",
          skuLabel: "L", productName: "Leaf", qtyPerParent: "1",
          perTier: [{ tierId: TIER, requiredSellPerUnit: 1, contributionCostPerUnit: 0.5 }],
        },
      ],
    },
  } as unknown as HydrateSnapshot;
}

test("every fee column projects without throwing, at both allocation states", () => {
  // An unmapped column would throw inside `chargePolicy` where the old code
  // simply read a boolean — a crash, not a wrong number, but still a runtime
  // change and still the customer document failing to render.
  const fees = {
    setupFeeTotal: 100,
    toolingArtworkTotal: 200,
    toolingTotal: 300,
    artworkTotal: 400,
    rdTotal: 500,
    otherServiceTotal: 600,
    testingMicrosTotal: 700,
  };
  for (const allocate of [true, false]) {
    assert.doesNotThrow(() => projectCommercial(bundle(allocate, fees)));
  }
});

// ── the one runtime change, named rather than left to be found ──────────

test("the send transaction's added read is the ONLY runtime change", async () => {
  const src = codeOnly(await read("src/app/actions/quotes.ts"));

  // Named honestly: `sendQuote` now performs one extra SELECT inside its
  // transaction. With zero election rows the INSERT never fires, so the send
  // produces identical state — but the read is real and a reviewer should not
  // have to discover it.
  const at = src.indexOf("tx.insert(quoteSnapshotChargeRecovery)");
  assert.ok(at > 0);
  assert.match(
    src.slice(Math.max(0, at - 500), at),
    /if \(electionsToFreeze\.length > 0\)/,
    "the mirror insert became unconditional — it would write on every send",
  );
});

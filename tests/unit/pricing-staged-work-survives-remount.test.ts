/**
 * A remote pricing change must never silently delete local staged intent.
 *
 * ── THE OBSERVATION ───────────────────────────────────────────────────────
 *
 * Two operators on one quote. A stages a Tier 4 adjustment; B commits a
 * quote-wide change. In one run of that scenario A's staged decision vanished
 * before Apply — no chip, no refusal, nothing written, so PRICING_STALE never
 * had anything to refuse. A second run of the same steps kept the work and was
 * correctly refused. Nondeterministic, and upstream of the guard.
 *
 * ── WHAT THE TRACE FOUND ──────────────────────────────────────────────────
 *
 * No incoming committed update replaces or re-seeds `working`. There is no
 * such path: the sets are seeded at mount and move only on stage, reset and
 * apply-success. The store reconciles underneath them — which is why the
 * quote-wide header and the compliance grid moved while the chips stood — but
 * it never writes to them.
 *
 * That leaves exactly one way for the chip list to empty with nothing written:
 * a REMOUNT. `useState(seed)` runs a second time against a store that has by
 * then reconciled to the other operator's write, both sets come back equal,
 * the diff is empty, and the decision is gone.
 *
 * The mount-seeded quote-wide draft is the witness. In the run that lost the
 * work it read 30 before Apply and 35 after — a value nobody typed. In the run
 * that kept it, it stayed at 35 while the store said 40. Only a remount
 * reseeds a draft.
 *
 * What triggered that remount is not established, and these tests deliberately
 * do not depend on knowing: they assert the invariant against a remount from
 * ANY cause, which is the property the operator actually needs.
 *
 * ── WHY THIS IS A UNIT TEST AND NOT A BROWSER STEP ────────────────────────
 *
 * The failure reproduced once in two attempts. A browser check that passes
 * proves nothing about a race, and one that fails proves only that it can. The
 * seeding decision is pure, so the two-client sequence can be run exactly.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveInitialSets,
  validate,
  type StagedSnapshot,
} from "../../src/lib/pricing-staged-persistence.ts";
import { diffSets, type PricingSet } from "../../src/lib/pricing-staging.ts";

const T4 = "tier-4";
const hasStagedWork = (c: PricingSet, w: PricingSet) => diffSets(c, w).length > 0;

const set = (over: Partial<PricingSet> = {}): PricingSet => ({
  lifts: {},
  overrides: {},
  tierAdj: {},
  globalAdj: 0.3,
  ...over,
});

// ── the two-client sequence, exactly ──────────────────────────────────────

test("client A's staged tier survives client B's commit and A's remount", () => {
  // A mounts against a quote at 30% with no tier overrides.
  const aCommitted = set({ globalAdj: 0.3 });
  // A stages Tier 4 at 12%. Nothing is written.
  const aWorking = set({ globalAdj: 0.3, tierAdj: { [T4]: 0.12 } });
  const snapshot: StagedSnapshot = { committed: aCommitted, working: aWorking };

  // B commits a quote-wide 35%, which also clears tier overrides. A's store
  // reconciles to that, so a fresh mount would seed BOTH sets from it — the
  // exact state in which the staged decision disappeared.
  const storeSeedAfterB = set({ globalAdj: 0.35 });

  const resolved = resolveInitialSets({
    storeSeed: storeSeedAfterB,
    snapshot,
    hasStagedWork,
  });

  assert.equal(resolved.restored, true);
  assert.equal(resolved.working.tierAdj[T4], 0.12, "the staged decision is gone");
  assert.equal(
    diffSets(resolved.committed, resolved.working).length,
    1,
    "the chip must still be on screen",
  );
});

test("the restored baseline is the tab's belief, so the stale guard still fires", () => {
  // Restoring the working set alone would leave intent sitting on a baseline
  // that had advanced, and Apply would sail through against numbers the
  // operator never saw. The baseline travels with it precisely so the server
  // still sees a mismatch and refuses.
  const snapshot: StagedSnapshot = {
    committed: set({ globalAdj: 0.3 }),
    working: set({ globalAdj: 0.3, tierAdj: { [T4]: 0.12 } }),
  };
  const resolved = resolveInitialSets({
    storeSeed: set({ globalAdj: 0.35 }),
    snapshot,
    hasStagedWork,
  });
  assert.equal(resolved.committed.globalAdj, 0.3);
  assert.notEqual(
    resolved.committed.globalAdj,
    0.35,
    "adopting the fresh baseline would hide the concurrent change from the guard",
  );
});

test("the chip list is not fabricated from a baseline that moved underneath it", () => {
  // The other half of carrying both: restore working against the NEW baseline
  // and the diff invents changes nobody staged. Here B cleared a tier override
  // A had never touched — with a mixed baseline it would read as A staging it.
  const snapshot: StagedSnapshot = {
    committed: set({ globalAdj: 0.3, tierAdj: { "tier-2": 0, "tier-3": 0.5 } }),
    working: set({
      globalAdj: 0.3,
      tierAdj: { "tier-2": 0, "tier-3": 0.5, [T4]: 0.12 },
    }),
  };
  const resolved = resolveInitialSets({
    storeSeed: set({ globalAdj: 0.35 }),
    snapshot,
    hasStagedWork,
  });
  const changes = diffSets(resolved.committed, resolved.working);
  assert.equal(changes.length, 1, "only Tier 4 was ever staged");
});

// ── what must NOT be restored ─────────────────────────────────────────────

test("a snapshot with nothing staged defers to the store", () => {
  // It records only that this tab once looked at the quote. Preferring it would
  // pin a baseline the store has moved past, for no benefit.
  const idle = set({ globalAdj: 0.3 });
  const resolved = resolveInitialSets({
    storeSeed: set({ globalAdj: 0.35 }),
    snapshot: { committed: idle, working: idle },
    hasStagedWork,
  });
  assert.equal(resolved.restored, false);
  assert.equal(resolved.committed.globalAdj, 0.35);
});

test("no snapshot means the store seeds both sets, unchanged", () => {
  const seed = set({ globalAdj: 0.35 });
  const resolved = resolveInitialSets({ storeSeed: seed, snapshot: null, hasStagedWork });
  assert.equal(resolved.restored, false);
  assert.deepEqual(resolved.committed, seed);
  assert.deepEqual(resolved.working, seed);
});

// ── a snapshot is untrusted input ─────────────────────────────────────────

test("a malformed snapshot reads as absent, never as half a set", () => {
  // Written by some earlier build, so its shape is not guaranteed by the type
  // system. Restoring part of a pricing set is worse than restoring none.
  for (const bad of [
    null,
    42,
    {},
    { committed: {}, working: {} },
    { committed: { lifts: {}, overrides: {}, tierAdj: {} }, working: {} },
    { committed: set(), working: { ...set(), globalAdj: "0.3" } },
    { committed: set(), working: { ...set(), tierAdj: { t: "0.12" } } },
    { committed: set(), working: { ...set(), globalAdj: Number.NaN } },
  ]) {
    assert.equal(validate(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a well-formed snapshot round-trips through JSON", () => {
  const snap: StagedSnapshot = {
    committed: set({ globalAdj: 0.3 }),
    working: set({ globalAdj: 0.3, tierAdj: { [T4]: 0.12 }, lifts: { "a|b": 0.05 } }),
  };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(snap))), snap);
});

// ── the wiring ────────────────────────────────────────────────────────────

test("the provider seeds through the resolver and keeps the snapshot in step", async () => {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(
    new URL(
      "../../src/components/pricing-surface/pricing-staging-context.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  assert.match(code, /resolveInitialSets\(\{/);
  assert.match(code, /useState<PricingSet>\(seeded\.committed\)/);
  assert.match(code, /useState<PricingSet>\(seeded\.working\)/);
  // Cleared the moment nothing is staged — which is how Apply, Reset and
  // Return to baseline all dispose of it without knowing it exists.
  assert.match(
    code,
    /changes\.length === 0\) clearStagedSnapshot[\s\S]{0,80}?writeStagedSnapshot/,
  );
});

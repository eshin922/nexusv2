/**
 * Consecutive global applies converge — they do not alternate.
 *
 * THE REPRODUCTION. Apply global 50%, correct. Immediately apply global 25%,
 * and the price adjustment becomes zero. No percentage threshold is involved:
 * one apply clears tier overrides correctly, the next path materializes
 * `tier_price_adj_pct = 0.0000`, `tier ?? global` resolves to the explicit
 * zero, and the newly persisted global is inert.
 *
 * This models the persisted STATE MACHINE rather than a single plan, because
 * the defect only exists across transitions — every individual apply looked
 * right. The simulator seeds the intended set from persisted state exactly as
 * the staging context does; seeding it empty is what made an earlier round of
 * tests vacuous.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { planApply } from "../../src/lib/pricing-apply-plan.ts";

type Persisted = { globalAdj: string; tierAdj: Map<string, string> };

const TIERS = ["t1", "t2", "t3", "t4"];

/**
 * One Apply against persisted state, returning the new persisted state.
 *
 * `stagedTierAdj` is what the operator deliberately changed this round; every
 * other tier is carried over from persisted, which is what the UI seeds.
 */
function applyGlobal(
  state: Persisted,
  nextGlobal: string,
  stagedTierAdj: Record<string, string> = {},
): { next: Persisted; created: string[]; removed: string[] } {
  const intended = new Map(state.tierAdj);
  for (const [k, v] of Object.entries(stagedTierAdj)) intended.set(k, v);

  const plan = planApply({
    intendedLifts: new Map(), intendedOverrides: new Map(),
    persistedLifts: new Map(), persistedOverrides: new Map(),
    intendedTierAdj: intended,
    persistedTierAdj: state.tierAdj,
    globalAdjFrom: state.globalAdj,
    globalAdjTo: nextGlobal,
  });

  const tierAdj = new Map(state.tierAdj);
  for (const r of plan.tierAdjRemoved) tierAdj.delete(r.key);
  for (const c of plan.tierAdjSet) tierAdj.set(c.key, c.to);

  return {
    next: { globalAdj: plan.globalAdj ? plan.globalAdj.to : state.globalAdj, tierAdj },
    created: plan.tierAdjSet.map((c) => c.key),
    removed: plan.tierAdjRemoved.map((c) => c.key),
  };
}

/** What each tier actually prices at — `tier ?? global`, the governed rule. */
function effective(state: Persisted): Record<string, string> {
  return Object.fromEntries(
    TIERS.map((t) => [t, state.tierAdj.get(t) ?? state.globalAdj]),
  );
}

const clean = (): Persisted => ({ globalAdj: "0.0000", tierAdj: new Map() });

test("THE REPRODUCTION · global 50% then 25% — no zero rows appear between them", () => {
  let s = clean();
  const first = applyGlobal(s, "0.5000");
  s = first.next;
  assert.deepEqual(first.created, [], "the first apply must create no tier rows");
  assert.deepEqual(effective(s), { t1: "0.5000", t2: "0.5000", t3: "0.5000", t4: "0.5000" });

  const second = applyGlobal(s, "0.2500");
  s = second.next;
  assert.deepEqual(second.created, [], "the second apply must create no tier rows");
  assert.equal(s.tierAdj.size, 0, "no 0.0000 rows may exist after the transition");
  assert.deepEqual(effective(s), { t1: "0.2500", t2: "0.2500", t3: "0.2500", t4: "0.2500" });
});

test("a THIRD consecutive apply confirms convergence, not a shifted alternation", () => {
  // The failure alternated, so two transitions can look healthy on the phase
  // that happens to be correct. Three settles it.
  let s = clean();
  for (const g of ["0.5000", "0.2500", "0.6000"]) {
    const step = applyGlobal(s, g);
    s = step.next;
    assert.deepEqual(step.created, [], `apply ${g} created tier rows`);
    assert.equal(s.tierAdj.size, 0, `apply ${g} left tier rows behind`);
    assert.equal(s.globalAdj, g);
  }
  assert.deepEqual(effective(s), { t1: "0.6000", t2: "0.6000", t3: "0.6000", t4: "0.6000" });
});

test("legacy tier rates are cleared once and STAY cleared", () => {
  // The live quote's starting condition. The first apply clears; the danger is
  // the next one re-creating them, which is precisely what happened.
  let s: Persisted = {
    globalAdj: "0.0000",
    tierAdj: new Map([["t1", "0.2911"], ["t2", "0.1115"], ["t3", "0.1115"], ["t4", "0.1115"]]),
  };
  const first = applyGlobal(s, "0.5000");
  s = first.next;
  assert.deepEqual(first.removed.sort(), TIERS);
  assert.equal(s.tierAdj.size, 0);

  const second = applyGlobal(s, "0.2500");
  s = second.next;
  assert.deepEqual(second.created, [], "cleared rates must not come back");
  assert.deepEqual(effective(s), { t1: "0.2500", t2: "0.2500", t3: "0.2500", t4: "0.2500" });
});

test("an explicit tier override survives until a global Apply, then goes", () => {
  // The governed sequence from the disposition: global 10%, then an explicit
  // Tier 2 override, then a new global that reclaims one authority.
  let s = applyGlobal(clean(), "0.1000").next;
  assert.deepEqual(effective(s), { t1: "0.1000", t2: "0.1000", t3: "0.1000", t4: "0.1000" });

  // Explicit tier decision, no global movement — the override must be written.
  const scoped = applyGlobal(s, s.globalAdj, { t2: "0.0500" });
  s = scoped.next;
  assert.deepEqual(scoped.created, ["t2"]);
  assert.deepEqual(effective(s), { t1: "0.1000", t2: "0.0500", t3: "0.1000", t4: "0.1000" });

  // New global authority clears the exception.
  const reclaim = applyGlobal(s, "0.2000");
  s = reclaim.next;
  assert.deepEqual(reclaim.removed, ["t2"]);
  assert.deepEqual(effective(s), { t1: "0.2000", t2: "0.2000", t3: "0.2000", t4: "0.2000" });
});

test("an operator-authored tier 0% suppresses the global, and only a global Apply removes it", () => {
  // Zero is a lever, not an absence. It must price at 0 while the rest of the
  // quote carries the global — and it must not be silently swept by anything
  // other than the governed global Apply.
  let s = applyGlobal(clean(), "0.1000").next;
  s = applyGlobal(s, s.globalAdj, { t2: "0.0000" }).next;
  assert.deepEqual(effective(s), { t1: "0.1000", t2: "0.0000", t3: "0.1000", t4: "0.1000" });

  // A non-global apply leaves it alone.
  const untouched = applyGlobal(s, s.globalAdj);
  assert.deepEqual(untouched.removed, []);
  assert.equal(untouched.next.tierAdj.get("t2"), "0.0000");

  // The governed global Apply reclaims it.
  const reclaim = applyGlobal(s, "0.3000");
  assert.deepEqual(reclaim.removed, ["t2"]);
  assert.deepEqual(effective(reclaim.next), {
    t1: "0.3000", t2: "0.3000", t3: "0.3000", t4: "0.3000",
  });
});

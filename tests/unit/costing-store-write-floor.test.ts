/**
 * The domain-scoped write floor and per-slice applied witnesses.
 *
 * WHAT THIS IS NOT YET. No reader emits witnesses and no writer returns a
 * write id (steps 4-6 of `cc-reconciliation-contract.md`). Every test here
 * therefore supplies both by hand. The last test asserts the consequence that
 * matters while that is true: with neither in place the mechanism is INERT and
 * reconciliation behaves exactly as it did before it existed.
 *
 * Fixtures use the snapshots proof P1 measured on PostgreSQL 16.14
 * (`cc-reconciliation-p1.md`), not invented ones:
 *
 *     stale  14346:14348:14346     a lower xid held open, a higher one committed
 *     fresh  14348:14348:          the same instant after that lower xid committed
 *
 * Both report `xmax` 14348. The legacy `revision` cannot separate them in
 * either direction; the in-progress list separates them exactly.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReconcile,
  makeCostingStore,
  type HydrateSnapshot,
} from "../../src/lib/costing-store.ts";

const QUOTE = "q1";
const STALE = "14346:14348:14346";
const FRESH = "14348:14348:";
const WRITE = "14346"; // the xid held open in STALE, committed by FRESH
/**
 * The revision BOTH measured reads carry.
 *
 * `revision` is `pg_snapshot_xmax` of the payload read, so it is the `xmax` of
 * the witness beside it — 14348 in both STALE and FRESH. Any fixture that gave
 * them different revisions would be testing a scenario the database does not
 * produce, and would pass on the legacy number without ever reaching dominance.
 */
const SAME_REVISION = 14348;

function snapshot(over: Partial<HydrateSnapshot> = {}): HydrateSnapshot {
  return {
    revision: 1,
    quoteId: QUOTE,
    projectId: "p1",
    globalPriceAdjPct: 0,
    freightMarkupPct: 0,
    targetMarginPct: null,
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [],
    tiers: [],
    packaging: [],
    production: [],
    assemblyProduction: [],
    componentCharges: [],
    componentChargeMeta: [],
    chargeElections: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightComponentTierCosts: [],
    freightShipmentBreaks: [],
    freightCustomerArrangesMeta: [],
    cellOverrides: [],
    cellTargets: [],
    lifts: [],
    costing: { tiers: [], skuRollups: [], quoteRollup: [] },
    persistedWarnings: [],
    ...over,
  } as unknown as HydrateSnapshot;
}

/** A store that already declares `packaging` guarded, as step 4's reader will. */
const armedStore = (over: Partial<HydrateSnapshot> = {}) =>
  makeCostingStore(snapshot({ guardedDomains: ["packaging"], ...over }));

// ── arming: the known-committed precondition (P1 · F2) ────────────────────

test("an acknowledged write with a guarded domain arms", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.deepEqual(store.getState().floor, [
    { writeId: WRITE, domain: "packaging" },
  ]);
});

test("an UNKNOWN outcome never arms — the precondition, not a nicety", () => {
  // A snapshot reports a transaction as finished whether it committed or
  // aborted, so a requirement armed on an undetermined outcome would retire
  // the moment its transaction ended, whichever way it ended.
  const store = armedStore();
  store.getState().armWrite({
    outcome: "unknown",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.deepEqual(store.getState().floor, [], "an unknown outcome must not arm");
});

test("a failed write never arms", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "failed",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.deepEqual(store.getState().floor, []);
});

test("a null or unparseable write id never arms", () => {
  const store = armedStore();
  for (const writeId of [null, "", " 14346", "abc", "-1", "1.5"]) {
    store.getState().armWrite({
      outcome: "acknowledged",
      writeId,
      domains: ["packaging"],
    });
  }
  assert.deepEqual(store.getState().floor, []);
});

test("an UNGUARDED domain never arms, so partial wiring cannot hold a read", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["production"], // real domain, but no reader witnesses it
  });
  assert.deepEqual(store.getState().floor, []);
});

test("a multi-domain write arms once per GUARDED domain", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging", "production"],
  });
  assert.deepEqual(
    store.getState().floor,
    [{ writeId: WRITE, domain: "packaging" }],
    "protected where it is witnessed, and explicitly not elsewhere",
  );
});

test("arming is a set — the same write twice does not double-count", () => {
  const store = armedStore();
  for (let i = 0; i < 3; i += 1) {
    store.getState().armWrite({
      outcome: "acknowledged",
      writeId: WRITE,
      domains: ["packaging"],
    });
  }
  assert.equal(store.getState().floor.length, 1);
});

test("two concurrent writes are both held — a maximum would lose one", () => {
  const store = armedStore();
  for (const writeId of ["14346", "14347"]) {
    store.getState().armWrite({
      outcome: "acknowledged",
      writeId,
      domains: ["packaging"],
    });
  }
  assert.deepEqual(store.getState().floor.map((e) => e.writeId), [
    "14346",
    "14347",
  ]);
});

// ── acceptance ────────────────────────────────────────────────────────────

test("a read that does NOT include the armed write is held", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  const before = store.getState().lastAppliedRevision;
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: STALE } }),
  );
  assert.equal(store.getState().lastAppliedRevision, before, "held, not applied");
  assert.equal(store.getState().floor.length, 1, "and the requirement survives");
});

test("a read that DOES include it applies and retires it", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: FRESH } }),
  );
  assert.equal(store.getState().lastAppliedRevision, 2, "applied");
  assert.deepEqual(store.getState().floor, [], "retired by its own evidence");
  assert.equal(store.getState().appliedWitness.packaging, FRESH);
});

test("a missing required witness holds the read", () => {
  // The slice is present in the snapshot; the EVIDENCE about it is not.
  // Inclusion cannot be established, so the read is declined rather than
  // accepted over a write it cannot account for.
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().reconcile(snapshot({ revision: 2 })); // no witnesses at all
  assert.equal(store.getState().lastAppliedRevision, 1, "held");
  assert.equal(store.getState().floor.length, 1);
});

test("an unparseable witness proves nothing and holds the read", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: "not-a-snapshot" } }),
  );
  assert.equal(store.getState().lastAppliedRevision, 1, "fails closed");
});

// ── the cross-domain non-wedge (contradiction 2) ──────────────────────────

test("an unrelated slice's OLDER witness does not block a packaging write", () => {
  // The bundle's phases are sequential, so the earlier phase's witness is
  // systematically older. Requiring the packaging write to be included THERE
  // would reject a bundle whose packaging data is correct, on every bundle
  // where a write lands in that gap.
  const store = makeCostingStore(
    snapshot({ guardedDomains: ["bundle", "packaging"] }),
  );
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().reconcile(
    snapshot({
      revision: 2,
      witnesses: { bundle: STALE, packaging: FRESH },
    }),
  );
  assert.equal(store.getState().lastAppliedRevision, 2, "must apply");
  assert.deepEqual(store.getState().floor, []);
});

// ── per-slice ordering (contradiction 1) ──────────────────────────────────

test("THE MEASURED PATH — stale first, then the fresh read at the SAME revision", () => {
  // The sequence the operator actually hits, in the order they hit it, with
  // the revisions the database actually produces.
  //
  // This is the case the previous version of this test could not express: it
  // applied FRESH at revision 2 and then STALE at revision 3, so the revisions
  // were INCREASING and the legacy guard never had to be skipped. Reversing
  // the order — which is the real order — put both reads on revision 14348,
  // where `14348 <= 14348` rejected the proven-fresh read before dominance was
  // consulted and the requirement never retired.
  const store = armedStore();

  // 1. The pre-commit read lands first and is applied. Nothing is outstanding
  //    yet, so there is nothing for it to violate.
  store.getState().reconcile(
    snapshot({
      revision: SAME_REVISION,
      witnesses: { bundle: STALE, packaging: STALE },
    }),
  );
  assert.equal(store.getState().appliedWitness.bundle, STALE, "stale applied");

  // 2. The operator's write is acknowledged. 14346 is the xid STALE shows as
  //    still in progress.
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.equal(store.getState().floor.length, 1);

  // 3. The post-commit read arrives carrying the SAME revision, and proves it
  //    contains the write.
  store.getState().reconcile(
    snapshot({
      revision: SAME_REVISION,
      witnesses: { bundle: FRESH, packaging: FRESH },
    }),
  );

  assert.equal(
    store.getState().appliedWitness.packaging,
    FRESH,
    "the proven-fresh read must apply even though its revision is not higher",
  );
  assert.deepEqual(
    store.getState().floor,
    [],
    "and the requirement must retire, or the surface re-reads forever",
  );
});

test("the same revision in the other direction is still refused", () => {
  // The guarantee the fix must not trade away: skipping the legacy number
  // where a witness decides must not let a STALE read in.
  const store = armedStore();
  store.getState().reconcile(
    snapshot({
      revision: SAME_REVISION,
      witnesses: { bundle: FRESH, packaging: FRESH },
    }),
  );
  store.getState().reconcile(
    snapshot({
      revision: SAME_REVISION,
      witnesses: { bundle: STALE, packaging: STALE },
    }),
  );
  assert.equal(
    store.getState().appliedWitness.bundle,
    FRESH,
    "a dominated payload witness is refused at equal revision",
  );
});

test("a dominated payload witness rejects the WHOLE payload, not just its slice", () => {
  // All-or-nothing. The payload axis speaks for every slice `reconcile`
  // replaces, so a fresher packaging witness cannot carry an older bundle in
  // with it.
  const store = makeCostingStore(
    snapshot({
      guardedDomains: ["bundle", "packaging"],
      witnesses: { bundle: FRESH, packaging: STALE },
    }),
  );
  store.getState().reconcile(
    snapshot({
      revision: SAME_REVISION + 1,
      witnesses: { bundle: STALE, packaging: FRESH },
    }),
  );
  assert.equal(
    store.getState().appliedWitness.packaging,
    STALE,
    "nothing applied — not the slice that dominates either",
  );
});

test("a dominated SLICE witness still rejects the read", () => {
  // The per-slice axis, unchanged by the payload axis being added above.
  const store = armedStore();
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: FRESH } }),
  );
  assert.equal(store.getState().appliedWitness.packaging, FRESH);
  store.getState().reconcile(
    snapshot({ revision: 3, witnesses: { packaging: STALE } }),
  );
  assert.equal(
    store.getState().lastAppliedRevision,
    2,
    "a dominated slice witness rejects the read even at a higher revision",
  );
});

test("the legacy number governs when the payload axis is unavailable", () => {
  // Both halves of "unavailable", because they are different situations:
  // nothing stored to compare against, and nothing incoming to compare with.
  const noStored = makeCostingStore(snapshot({ guardedDomains: ["bundle"] }));
  noStored.getState().reconcile(
    snapshot({ revision: 1, witnesses: { bundle: FRESH } }),
  );
  assert.equal(
    noStored.getState().lastAppliedRevision,
    1,
    "no stored payload witness — equal revision is still refused",
  );

  const noIncoming = makeCostingStore(
    snapshot({ guardedDomains: ["bundle"], witnesses: { bundle: STALE } }),
  );
  noIncoming.getState().reconcile(snapshot({ revision: 1 }));
  assert.equal(
    noIncoming.getState().lastAppliedRevision,
    1,
    "no incoming payload witness — the legacy rule decides, as it always did",
  );
  noIncoming.getState().reconcile(snapshot({ revision: 2 }));
  assert.equal(noIncoming.getState().lastAppliedRevision, 2, "and still admits newer");
});

test("an unparseable payload witness falls back rather than admitting the read", () => {
  const store = makeCostingStore(
    snapshot({ guardedDomains: ["bundle"], witnesses: { bundle: FRESH } }),
  );
  store.getState().reconcile(
    snapshot({ revision: 1, witnesses: { bundle: "not-a-snapshot" } }),
  );
  assert.equal(
    store.getState().lastAppliedRevision,
    1,
    "corrupt evidence proves nothing; the weaker instrument still refuses it",
  );
});

test("an identical witness does not re-apply", () => {
  const store = armedStore();
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: FRESH } }),
  );
  store.getState().reconcile(
    snapshot({ revision: 3, witnesses: { packaging: FRESH } }),
  );
  assert.equal(store.getState().lastAppliedRevision, 2, "no new information");
});

test("incomparable witnesses are declined, not guessed between", () => {
  const store = armedStore();
  store.getState().reconcile(
    snapshot({ revision: 2, witnesses: { packaging: "10:20:12" } }),
  );
  store.getState().reconcile(
    snapshot({ revision: 3, witnesses: { packaging: "10:20:15" } }),
  );
  assert.equal(store.getState().lastAppliedRevision, 2);
});

// ── quote change and explicit clearing ────────────────────────────────────

test("a quote change resets unconditionally — even when its read is OLDER", () => {
  // The reset used to be decided AFTER the witness comparison, so a new
  // quote whose read was dominated by the one stored for the quote being LEFT
  // was rejected outright: the reset never happened, and the previous quote's
  // requirements and witnesses survived into a quote they describe nothing
  // about. Two quotes' reads are not competing descriptions of one thing, so
  // there is no ordering question to ask.
  const store = makeCostingStore(
    snapshot({
      guardedDomains: ["bundle", "packaging"],
      // Stored state is the NEWER read...
      witnesses: { bundle: FRESH, packaging: FRESH },
    }),
  );
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.equal(store.getState().floor.length, 1);

  // ...and the new quote arrives with an OLDER one, at a LOWER revision.
  store.getState().reconcile(
    snapshot({
      revision: 0,
      quoteId: "q2",
      witnesses: { bundle: STALE, packaging: STALE },
    }),
  );

  assert.equal(store.getState().quoteId, "q2", "the reset happened");
  assert.deepEqual(
    store.getState().floor,
    [],
    "the previous quote's requirement is meaningless here",
  );
  assert.equal(
    store.getState().appliedWitness.packaging,
    STALE,
    "and its witnesses are replaced, not merged",
  );
  assert.equal(store.getState().lastAppliedRevision, 0, "ordering is not consulted");
});

test("clearWriteFloor drops everything outstanding", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().clearWriteFloor();
  assert.deepEqual(store.getState().floor, []);
  assert.deepEqual(store.getState().appliedWitness, {});
});

// ── hydrate is a reset, explicitly ────────────────────────────────────────

test("hydrate resets the floor and adopts unconditionally — it does not gate", () => {
  const store = armedStore();
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  store.getState().awaitCommitted(99);
  assert.equal(store.getState().floor.length, 1);
  assert.equal(store.getState().awaitedRevision, 99);

  // A snapshot that `reconcile` would REJECT: lower revision, and a witness
  // that does not include the armed write.
  store.getState().hydrate(
    snapshot({ revision: 0, witnesses: { packaging: STALE } }),
  );
  assert.equal(store.getState().lastAppliedRevision, 0, "adopted regardless");
  assert.deepEqual(store.getState().floor, [], "requirements cleared");
  assert.equal(store.getState().awaitedRevision, null, "and the Freight gate too");
  assert.equal(store.getState().appliedWitness.packaging, STALE, "witnesses replaced");
});

// ── the helper, directly ──────────────────────────────────────────────────

test("evaluateReconcile returns null to hold and a verdict to apply", () => {
  const stored = {
    floor: [{ writeId: WRITE, domain: "packaging" }],
    appliedWitness: {},
    quoteId: QUOTE,
  };
  assert.equal(
    evaluateReconcile({ quoteId: QUOTE, witnesses: { packaging: STALE } }, stored),
    null,
  );
  const verdict = evaluateReconcile(
    { quoteId: QUOTE, witnesses: { packaging: FRESH } },
    stored,
  );
  assert.ok(verdict);
  assert.deepEqual(verdict.retained, []);
  assert.deepEqual(verdict.accepted, { packaging: FRESH });
  assert.equal(verdict.ordering, "legacy", "no payload witness pair here");
});

test("evaluateReconcile reports which instrument decided", () => {
  const base = { floor: [], appliedWitness: {}, quoteId: QUOTE };
  assert.equal(
    evaluateReconcile({ quoteId: "other" }, base)?.ordering,
    "reset",
    "a different quote is a reset, never an ordering question",
  );
  assert.equal(
    evaluateReconcile({ quoteId: QUOTE }, base)?.ordering,
    "legacy",
    "nothing to compare — the legacy number decides",
  );
  assert.equal(
    evaluateReconcile(
      { quoteId: QUOTE, witnesses: { bundle: FRESH } },
      { ...base, appliedWitness: { bundle: STALE } },
    )?.ordering,
    "witness",
    "a payload witness pair decides on its own terms",
  );
});

// ── inertness, which is the property that lets steps 0-3 land alone ───────

test("with no witnesses and no arming the mechanism is inert", () => {
  // This is the whole justification for landing the store before its reader
  // and writer: today every snapshot arrives with `witnesses` undefined and
  // `guardedDomains` unset, so nothing can arm and every gate above is a
  // no-op. Reconciliation is exactly the legacy revision rule.
  const store = makeCostingStore(snapshot());
  assert.deepEqual(store.getState().guardedDomains, [], "no reader declares any");
  store.getState().armWrite({
    outcome: "acknowledged",
    writeId: WRITE,
    domains: ["packaging"],
  });
  assert.deepEqual(store.getState().floor, [], "so nothing can arm");

  store.getState().reconcile(snapshot({ revision: 2 }));
  assert.equal(store.getState().lastAppliedRevision, 2, "newer applies");
  store.getState().reconcile(snapshot({ revision: 2 }));
  assert.equal(store.getState().lastAppliedRevision, 2, "equal is rejected");
  store.getState().reconcile(snapshot({ revision: 1 }));
  assert.equal(store.getState().lastAppliedRevision, 2, "older is rejected");
});

test("a non-finite revision fails closed instead of falling through", () => {
  // `Number(undefined)` is `NaN`, and `NaN <= n` is false — so this used to
  // pass the ordering guard and apply, defeating ordering on exactly the path
  // that most needed it.
  const store = makeCostingStore(snapshot({ revision: 5 }));
  for (const revision of [NaN, Infinity, -Infinity]) {
    store.getState().reconcile(snapshot({ revision }));
    assert.equal(
      store.getState().lastAppliedRevision,
      5,
      `revision ${revision} must not apply`,
    );
  }
  store.getState().reconcile(snapshot({ revision: 6 }));
  assert.equal(store.getState().lastAppliedRevision, 6, "valid still applies");
});

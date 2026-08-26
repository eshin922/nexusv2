import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideDealOrderReadiness,
  type DealOrderFacts,
} from "../../src/lib/netsuite/deal-order-readiness-rules.ts";

// Run 1 W9. The refusal is governed and correct; what was wrong is that the
// operator met it by pressing the irreversible button. These assert the
// prediction, and — more importantly — assert the two ways a prediction like
// this goes wrong: refusing something legitimate, and claiming a readiness it
// never established.

const facts = (over: Partial<DealOrderFacts> = {}): DealOrderFacts => ({
  ownSalesOrderId: null,
  hubspotDealId: "58222880425",
  sibling: null,
  provider: { kind: "answered", first: null },
  ...over,
});

test("a deal with no order anywhere is ready", () => {
  const r = decideDealOrderReadiness(facts());
  assert.equal(r.status, "ok");
  assert.equal(r.blocker, null);
});

test("a quote holding its OWN order is never blocked by it", () => {
  // The re-send path resumes an existing order rather than duplicating it.
  // Blocking here would refuse the recovery `mustNotCreate` depends on.
  const r = decideDealOrderReadiness(
    facts({
      ownSalesOrderId: "362341",
      sibling: {
        salesOrderInternalId: "362341",
        salesOrderTranid: "SO2715",
        quoteNumber: "DPS-1053",
        scenarioLabel: "whatever",
      },
    }),
  );
  assert.equal(r.status, "ok");
});

test("a sibling quote's order blocks, and the remedy names an action", () => {
  const r = decideDealOrderReadiness(
    facts({
      sibling: {
        salesOrderInternalId: "362341",
        salesOrderTranid: "SO2715",
        quoteNumber: "DPS-1053",
        scenarioLabel: "ZZ-SOAK-source",
      },
    }),
  );
  assert.equal(r.status, "blocked");
  assert.equal(r.blocker?.salesOrderTranid, "SO2715");
  assert.equal(r.blocker?.siblingQuoteNumber, "DPS-1053");
  // The send-time refusal says "manual reconciliation required", which names
  // no step an operator can take. The whole point of predicting earlier is
  // lost if the prediction inherits that phrasing.
  assert.match(r.blocker!.remediation, /SO2715/);
  assert.match(r.blocker!.remediation, /DPS-1053/);
  assert.match(r.blocker!.remediation, /second deal/);
  assert.doesNotMatch(r.blocker!.remediation, /manual reconciliation/i);
});

test("a sibling is sufficient — the provider is not consulted", () => {
  // Nexus's own record cannot be contradicted by a provider read, so the
  // network call is skipped. `not_consulted` must not turn that into unknown.
  const r = decideDealOrderReadiness(
    facts({
      sibling: {
        salesOrderInternalId: "362341",
        salesOrderTranid: null,
        quoteNumber: null,
        scenarioLabel: null,
      },
      provider: { kind: "not_consulted" },
    }),
  );
  assert.equal(r.status, "blocked");
  assert.match(r.blocker!.remediation, /a Sales Order/);
});

test("an order Nexus never created still blocks, and says nobody claims it", () => {
  // The HubSpot `Auto create NetSuite sales order from won deal` workflow makes
  // these. They consume the deal exactly as ours do, and the operator has no
  // other way to learn of them.
  const r = decideDealOrderReadiness(
    facts({ provider: { kind: "answered", first: { internalId: "999", tranid: "SO9999" } } }),
  );
  assert.equal(r.status, "blocked");
  assert.equal(r.blocker?.siblingQuoteNumber, null);
  assert.equal(r.blocker?.siblingScenarioLabel, null);
});

test("a provider read failure is UNKNOWN, never ok and never blocked", () => {
  // The property this whole module would be worthless without. An outage must
  // not read as a verdict in either direction: not as a false block that stops
  // a legitimate send, and not as a false readiness the surface never earned.
  const r = decideDealOrderReadiness(
    facts({ provider: { kind: "failed", reason: "NetSuite deal lookup failed: 503" } }),
  );
  assert.equal(r.status, "unknown");
  assert.equal(r.blocker, null);
  assert.match(r.unknownReason!, /503/);
});

test("silence from a provider that was never asked is UNKNOWN, not ok", () => {
  // Pattern 60. `not_consulted` and "answered with nothing" are different
  // facts; collapsing them would let an unasked question read as a clean bill.
  const r = decideDealOrderReadiness(
    facts({ provider: { kind: "not_consulted" } }),
  );
  assert.equal(r.status, "unknown");
  assert.equal(r.blocker, null);
});

test("no HubSpot deal means the rule cannot apply", () => {
  const r = decideDealOrderReadiness(
    facts({ hubspotDealId: null, provider: { kind: "not_consulted" } }),
  );
  assert.equal(r.status, "ok");
});

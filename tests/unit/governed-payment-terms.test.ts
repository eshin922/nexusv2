// C.1 — customer-facing payment terms must come from a governed authority.
//
// Nexus printed `firm_settings.payment_terms_default`, one firm-wide free-text
// string with no customer dimension. Measured against the 9 customers with
// verified NetSuite lineage: all 9 had a populated governed Terms record, all 9
// disagreed with what Nexus would print, and 5 disagreed MATERIALLY — governed
// "Net 30" against a printed 50%-deposit commitment. The 4 that agreed did so
// by coincidence of drafting, which is not parity.
//
// Contract under test:
//   NetSuite Customer Terms -> Nexus customer-facing quote terms -> frozen at Send
//
// Scope: the governed STARTING VALUE. A quote-specific override is deliberately
// not implemented — it needs business authority and an approved option source,
// and the NetSuite Terms vocabulary is not enumerable by this integration.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const terms = src("../../src/lib/netsuite/customer-terms.ts");
const resolver = src("../../src/lib/customer-view-resolver.ts");
const quotesAction = src("../../src/app/actions/quotes.ts");

const FIRM_DEFAULT = "50% deposit, 50% on shipment";

/** Mirrors `resolveGovernedPaymentTerms`'s decision, with lineage injected so
 *  the rule is testable without a database or NetSuite. */
type Outcome =
  | { status: "governed"; value: string }
  | { status: "unresolved"; reason: string };

function decide(
  dealId: string | null,
  lineage: Map<string, string>,
  customers: Map<string, { terms?: { refName?: string } | null }>
): Outcome {
  if (!dealId?.trim()) return { status: "unresolved", reason: "no_company" };
  const nsId = lineage.get(dealId);
  if (!nsId) return { status: "unresolved", reason: "no_lineage" };
  const refName = customers.get(nsId)?.terms?.refName?.trim();
  if (!refName) return { status: "unresolved", reason: "no_terms_on_customer" };
  return { status: "governed", value: refName };
}

/** The two real shapes observed across the 9 verified customers. */
const LINEAGE = new Map([
  ["deal-nemah", "72173"], // Net 30 (5 of 9)
  ["deal-epicuren", "88888"], // 50% Deposit/balance at shipment (4 of 9)
  ["deal-orphan", "99999"], // mapped, but no Terms record
]);
const CUSTOMERS = new Map<string, { terms?: { refName?: string } | null }>([
  ["72173", { terms: { refName: "Net 30" } }],
  ["88888", { terms: { refName: "50% Deposit/balance at shipment" } }],
  ["99999", { terms: null }],
]);
const decideFor = (deal: string | null) => decide(deal, LINEAGE, CUSTOMERS);

test("1 · Net 30 customer resolves to Net 30, not the firm default", () => {
  const r = decideFor("deal-nemah");
  assert.equal(r.status, "governed");
  assert.equal((r as any).value, "Net 30");
  assert.notEqual((r as any).value, FIRM_DEFAULT);
});

test("2 · deposit-terms customer resolves to its own governed term", () => {
  const r = decideFor("deal-epicuren");
  assert.equal((r as any).value, "50% Deposit/balance at shipment");
  // Textually distinct from the firm default even though commercially similar —
  // the coincidental-equivalence case that must stop being coincidental.
  assert.notEqual((r as any).value, FIRM_DEFAULT);
});

test("3 · two customers with different NetSuite terms cannot share one value", () => {
  // The defect in one assertion: under the firm default these two received the
  // same printed commitment. They must not.
  const a = decideFor("deal-nemah") as any;
  const b = decideFor("deal-epicuren") as any;
  assert.notEqual(a.value, b.value);
  assert.ok(a.value !== FIRM_DEFAULT && b.value !== FIRM_DEFAULT);
});

test("4 · missing lineage or missing Terms record cannot resolve", () => {
  assert.equal(decideFor("deal-unmapped").status, "unresolved");
  assert.equal(decideFor(null).status, "unresolved");
  const noTerms = decideFor("deal-orphan");
  assert.equal(noTerms.status, "unresolved");
  assert.equal((noTerms as any).reason, "no_terms_on_customer");
});

test("5 · the firm default cannot satisfy the Send gate", () => {
  // Send gates on `status !== "governed"`, so no unresolved outcome — whatever
  // its reason — can pass by falling back to the firm-wide string.
  for (const deal of ["deal-unmapped", "deal-orphan", null]) {
    const r = decideFor(deal as string | null);
    assert.notEqual(r.status, "governed", `${deal} must not be sendable`);
  }
  // And the resolver never substitutes the default into a governed outcome.
  assert.doesNotMatch(
    terms,
    /status:\s*"governed"[\s\S]{0,200}paymentTermsDefault/,
    "governed outcomes must never carry the firm default"
  );
});

test("6 · Send fails closed, before rendering, with an actionable message", () => {
  assert.match(quotesAction, /resolveGovernedPaymentTerms\(/);
  assert.match(
    quotesAction,
    /if \(governedTerms\.status !== "governed"\)[\s\S]{0,200}ActionGuardError/,
    "Send throws when terms are unverifiable"
  );
  assert.match(
    terms,
    /Customer payment terms could not be verified/,
    "operator-facing wording states the problem"
  );
  assert.match(terms, /before sending/, "and what must happen next");
  // The gate precedes the render, so an unsendable quote never produces a PDF
  // asserting unauthorised terms.
  assert.ok(
    quotesAction.indexOf("resolveGovernedPaymentTerms(") <
      quotesAction.indexOf("renderToBuffer("),
    "gate must run before the PDF render"
  );
});

test("7 · the frozen snapshot carries the governed value, not the firm default", () => {
  // Both freeze targets: quotes.payment_terms_snapshot and
  // quote_snapshots.payment_terms.
  assert.match(quotesAction, /paymentTermsSnapshot: governedPaymentTerms/);
  assert.match(quotesAction, /paymentTerms: governedPaymentTerms/);
  assert.doesNotMatch(
    quotesAction,
    /paymentTerms(Snapshot)?: firm\.paymentTermsDefault/,
    "no send path may freeze the firm-wide default"
  );
});

test("8 · sent quotes render the frozen snapshot and never re-resolve", () => {
  // Requirement 5: a later change to the customer's NetSuite Terms must not
  // mutate an already-sent quote. Guaranteed structurally — resolution is
  // skipped entirely when sent.
  assert.match(
    resolver,
    /const governedTerms = isSent\s*\?\s*null\s*:\s*await resolveGovernedPaymentTerms/,
    "sent quotes do not resolve live terms"
  );
  assert.match(
    resolver,
    /paymentTerms = isSent\s*\?\s*quote\.paymentTermsSnapshot/,
    "sent quotes read the snapshot"
  );
});

test("9 · drafts show the governed term, and say so when they cannot", () => {
  assert.match(
    resolver,
    /governedTerms\?\.status === "governed"\s*\?\s*governedTerms\.value/,
    "drafts prefer the governed value"
  );
  assert.match(
    resolver,
    /paymentTermsSource: "frozen" \| "governed" \| "provisional"/,
    "the draft carries its own authority level rather than presenting the firm default as governed"
  );
});

test("10 · Nexus does not write NetSuite SO.terms", () => {
  // Requirement 6: NetSuite remains the accounting authority for the order.
  // Quote terms and SO.terms are preserved independently; equality is never
  // forced, in either direction.
  const soPayload = src("../../src/lib/netsuite/sales-orders.ts");
  assert.doesNotMatch(
    soPayload,
    /["']?\bterms\b["']?\s*:/,
    "the Sales Order payload must not set terms"
  );
});

test("11 · no quote-level override ships in V1", () => {
  // Deferred deliberately: it needs business authority AND an approved option
  // source, and the NetSuite Terms vocabulary is not enumerable by this
  // integration. Pinned so it cannot arrive by accident.
  assert.doesNotMatch(quotesAction, /paymentTermsOverride/);
  assert.match(terms, /DEFERRED, NOT DECLINED/);
});

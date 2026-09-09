// Payment terms may be PRESENTED only with the authority that stands behind
// them — and a customer that has no verified NetSuite lineage must be able to
// acquire one through an operator workflow.
//
// ── THE DEFECT THIS PINS ──────────────────────────────────────────────────
//
// Dr. Squatch is a Net 90 customer. Nexus held its HubSpot company id, had no
// `netsuite_customer_map` row for it, and its quote preview displayed
// "50% deposit, 50% on shipment" — `firm_settings.payment_terms_default` — in
// the same register as a verified commitment.
//
// The resolution layer was already correct. `resolveGovernedPaymentTerms`
// returned a discriminated outcome separating a governed term from four
// distinct failures, `sendQuote` failed closed on all four, and the resolver
// computed `paymentTermsSource: "frozen" | "governed" | "provisional"` for the
// surfaces to read. Nothing read it: the flag had ZERO consumers, so every
// draft printed the firm default unqualified.
//
// Two things were therefore wrong, at different layers:
//
//   1 · PRESENTATION — an unverified default rendered as a customer term.
//   2 · RESOLUTION   — `netsuite_customer_map` had one writer, whose only
//       caller was a gate-1b certification script. No operator or admin could
//       create a mapping, while three separate messages told them to visit
//       `/admin/netsuite-customer-map`, a route that did not exist.
//
// These tests are about the BEHAVIOUR, not about Dr. Squatch. The final case
// asserts there is no customer-specific branch anywhere in `src/`.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  presentPaymentTerms,
  type PaymentTermsUnresolvedReason,
} from "../../src/lib/payment-terms-presentation.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const FIRM_DEFAULT = "50% deposit, 50% on shipment";

// ── 1 · a mapped customer renders its own governed term ────────────────────
test("mapped customer — the governed term is verified and printable", () => {
  const p = presentPaymentTerms({ source: "governed", value: "Net 90" });
  assert.equal(p.kind, "verified");
  if (p.kind !== "verified") return;
  assert.equal(p.value, "Net 90");
  assert.equal(p.basis, "governed");
});

test("a sent quote renders its frozen snapshot — the term actually promised", () => {
  const p = presentPaymentTerms({ source: "frozen", value: FIRM_DEFAULT });
  assert.equal(p.kind, "verified");
  if (p.kind !== "verified") return;
  // Verified because it was PROMISED, not because it is governed. Re-deriving
  // it later would let a change to the customer record rewrite what we are
  // recorded as having offered.
  assert.equal(p.basis, "frozen");
});

// ── 2 · an unmapped customer is never presented as verified ────────────────
test("unmapped customer — the firm default is not presented as a term", () => {
  const p = presentPaymentTerms({
    source: "provisional",
    value: FIRM_DEFAULT,
    unresolvedReason: "no_lineage",
  });
  assert.equal(p.kind, "unverified");
  if (p.kind !== "unverified") return;
  assert.equal(p.reason, "no_lineage");
  assert.equal(p.transient, false);
  // It is carried for the operator notice, under a name that is not `value`.
  assert.equal(p.provisionalValue, FIRM_DEFAULT);
  assert.match(p.action, /no verified NetSuite mapping/i);
  assert.match(p.action, /admin/i);
});

test("the unverified arm has NO `value` field — the compiler is the guard", () => {
  const p = presentPaymentTerms({
    source: "provisional",
    value: FIRM_DEFAULT,
    unresolvedReason: "no_lineage",
  });
  // A `verified: boolean` beside a `value` can be ignored by a renderer that
  // reads `.value` and prints it — which is the defect being repaired,
  // reintroduced one layer up. The union makes that unrepresentable.
  assert.equal("value" in p, false);
});

// ── 3 · a lookup failure is NOT a missing mapping ──────────────────────────
test("temporary lookup failure is distinguished from an absent mapping", () => {
  const down = presentPaymentTerms({
    source: "provisional",
    value: FIRM_DEFAULT,
    unresolvedReason: "netsuite_unavailable",
  });
  const missing = presentPaymentTerms({
    source: "provisional",
    value: FIRM_DEFAULT,
    unresolvedReason: "no_lineage",
  });
  assert.equal(down.kind, "unverified");
  assert.equal(missing.kind, "unverified");
  if (down.kind !== "unverified" || missing.kind !== "unverified") return;

  // Both unverified, and they must not read the same. One is a data gap
  // somebody must close; the other clears itself.
  assert.equal(down.transient, true);
  assert.equal(missing.transient, false);
  assert.notEqual(down.qualifier, missing.qualifier);

  // The dangerous half: telling an admin to create a mapping during an outage
  // sends them to duplicate one that already exists.
  assert.doesNotMatch(down.action, /no verified NetSuite mapping/i);
  assert.match(down.action, /not necessarily missing|try again/i);
});

test("every unresolved reason has distinct operator copy", () => {
  const reasons: PaymentTermsUnresolvedReason[] = [
    "no_company",
    "no_lineage",
    "no_terms_on_customer",
    "netsuite_unavailable",
  ];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const p = presentPaymentTerms({ source: "provisional", value: null, unresolvedReason: reason });
    assert.equal(p.kind, "unverified");
    if (p.kind !== "unverified") continue;
    assert.equal(p.reason, reason);
    assert.ok(p.action.length > 20, `${reason} needs real copy`);
    assert.equal(seen.has(p.action), false, `${reason} duplicates another reason`);
    seen.add(p.action);
  }
});

test("a governed source carrying no string is not printable either", () => {
  // A contradiction, and the safe reading is "unverified" rather than an
  // em-dash that occupies the terms line as though it were a real term.
  const p = presentPaymentTerms({ source: "governed", value: "   " });
  assert.equal(p.kind, "unverified");
});

// ── 4 · ambiguity is surfaced, never resolved ──────────────────────────────
test("the search outcome separates `ran and found nothing` from `could not run`", () => {
  const provider = src("../../src/lib/integrations/netsuite-provider.ts");
  assert.match(provider, /state: "ok"; candidates: NetsuiteCustomerCandidate\[\]/);
  assert.match(provider, /state: "unavailable"; detail: string/);

  const search = src("../../src/lib/netsuite/customer-search.ts");
  // The catch must yield `unavailable`, never an empty candidate list.
  const catchBlock = search.slice(search.indexOf("} catch"));
  assert.match(catchBlock, /state: "unavailable"/);
  assert.doesNotMatch(catchBlock, /candidates: \[\]/);
});

test("mapping requires an explicit customer choice — nothing auto-selects", () => {
  const action = src("../../src/app/actions/netsuite-customer-map.ts");
  assert.match(action, /if \(!netsuiteCustomerId\)/);
  assert.match(action, /ERR\.VALIDATION/);

  const table = src("../../src/app/admin/netsuite-customer-map/customer-map-view.tsx");
  // A multi-match says so rather than quietly presenting the first.
  assert.match(table, /candidates\.length > 1/);
  // The selection rule itself is NOT asserted here. An earlier version of this
  // test pinned the literal text of an onClick handler, which broke the moment
  // the handler was refactored while the behaviour it described was intact --
  // a check measuring the shape of the code rather than what the code does.
  // The rule now lives in `customer-search-session` and is exercised directly
  // in `customer-mapping-workflow.test.ts`, including the case this file could
  // never have reached: a company switched while a search is still in flight.
  assert.match(table, /canChoose\(/, "selection must route through the guard");
});

test("a mapping is not saved on a read the workflow could not confirm", () => {
  const action = src("../../src/app/actions/netsuite-customer-map.ts");
  const catchBlock = action.slice(action.indexOf("} catch"));
  // The refusal must precede any write, and must not read as "no such customer".
  assert.match(catchBlock, /was not confirmed and the mapping was not saved/);
  assert.match(catchBlock, /connection problem, not a missing customer/);
  assert.ok(
    action.indexOf("was not confirmed and the mapping was not saved") <
      action.indexOf("upsertCustomerMap({"),
    "the refusal must come before the write",
  );
});

// ── 5 · different customers carry different terms ──────────────────────────
test("two customers with different governed terms each keep their own", () => {
  const net30 = presentPaymentTerms({ source: "governed", value: "Net 30" });
  const net90 = presentPaymentTerms({ source: "governed", value: "Net 90" });
  assert.equal(net30.kind, "verified");
  assert.equal(net90.kind, "verified");
  if (net30.kind !== "verified" || net90.kind !== "verified") return;
  assert.equal(net30.value, "Net 30");
  assert.equal(net90.value, "Net 90");
  // Neither is the firm-wide string, which has no customer dimension at all.
  assert.notEqual(net30.value, FIRM_DEFAULT);
  assert.notEqual(net90.value, FIRM_DEFAULT);
});

// ── the three render sites all gate on the same fact ───────────────────────
test("every surface that prints a term reads the presenter", () => {
  const sites = [
    "../../src/components/quote/customer-view-live.tsx",
    "../../src/components/quote-umbrella/tab-sales-order.tsx",
    "../../src/lib/customer-view-to-cpdf.ts",
  ];
  for (const site of sites) {
    const text = src(site);
    assert.match(text, /presentPaymentTerms/, `${site} must use the presenter`);
    assert.match(
      text,
      /kind === "verified"/,
      `${site} must gate on verification`,
    );
    // The raw field must no longer be printed unconditionally.
    assert.doesNotMatch(
      text,
      /\{quote\.paymentTerms \?\? "—"\}|view\.quote\.paymentTerms \?\? "—"|view\.quote\.paymentTerms \?\? ""/,
      `${site} still prints the unqualified term`,
    );
  }
});

test("the reason reaches the view rather than collapsing to `provisional`", () => {
  const resolver = src("../../src/lib/customer-view-resolver.ts");
  assert.match(resolver, /paymentTermsUnresolvedReason/);
  assert.match(
    resolver,
    /governedTerms\?\.status === "unresolved" \? governedTerms\.reason : null/,
  );
  // And it is actually carried on the payload, not merely computed.
  const payload = resolver.slice(resolver.indexOf("      paymentTerms,"));
  assert.match(payload.slice(0, 200), /paymentTermsUnresolvedReason,/);
});

// ── the finalization guard is PRESERVED ────────────────────────────────────
test("Send still fails closed on any unresolved term", () => {
  const quotesAction = src("../../src/app/actions/quotes.ts");
  assert.match(quotesAction, /if \(governedTerms\.status !== "governed"\)/);
  assert.match(quotesAction, /ActionGuardError\(\s*ERR\.VALIDATION/);
});

// ── the operator can now close the gap ─────────────────────────────────────
test("the route every message points at exists, and is reachable from the nav", () => {
  // Three places told operators to go here. It did not exist; `/admin/netsuite`
  // maps items only.
  const page = src("../../src/app/admin/netsuite-customer-map/page.tsx");
  assert.match(page, /requireAdminPage/);

  const sections = src("../../src/app/admin/sections.ts");
  // ONE list feeds both the nav and the index — a section absent from it ships
  // unreachable, which is the failure that list exists to prevent.
  assert.match(sections, /href: "\/admin\/netsuite-customer-map"/);

  const map = src("../../src/lib/netsuite/customer-map.ts");
  assert.match(map, /\/admin\/netsuite-customer-map/);
});

test("the mapping table shows unmapped companies, not just existing mappings", () => {
  const action = src("../../src/app/actions/netsuite-customer-map.ts");
  // A list of what IS mapped cannot show the gap, and the gap is the work.
  assert.match(action, /hubspotDealsCache/);
  assert.match(action, /Unmapped first/);
});

// ── no customer-specific branch, anywhere ──────────────────────────────────
//
// Asserted against CODE, with comments stripped first.
//
// The first draft of this test read the raw file and failed on its own
// sibling module, because a doc comment explains the defect using the phrase
// "a Net 90 customer". That is prose describing why the rule exists, not a
// branch implementing an exception to it — and a check that cannot tell those
// apart reports a failure that is not there, which is the same defect as one
// that cannot report a failure that is.
function code(path: string): string {
  return src(path)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .toLowerCase();
}

test("Dr. Squatch resolves through the general path — no named exception", () => {
  const files = [
    "../../src/lib/payment-terms-presentation.ts",
    "../../src/lib/netsuite/customer-terms.ts",
    "../../src/lib/netsuite/customer-map.ts",
    "../../src/lib/netsuite/customer-search.ts",
    "../../src/lib/customer-view-resolver.ts",
    "../../src/app/actions/netsuite-customer-map.ts",
    "../../src/components/quote/customer-view-live.tsx",
    "../../src/components/quote/quote-host.tsx",
    "../../src/lib/customer-view-to-cpdf.ts",
  ];
  for (const f of files) {
    const text = code(f);
    assert.doesNotMatch(text, /squatch/, `${f} names a specific customer`);
    assert.doesNotMatch(text, /net 90/, `${f} hardcodes a specific term`);
    assert.doesNotMatch(
      text,
      /10427807265/,
      `${f} hardcodes a specific company id`,
    );
  }
});

test("the comment-stripper can actually see a violation", () => {
  // A filter that cannot express the failure it excludes proves nothing, so
  // the stripper is checked against a string that must survive it.
  const stripped = "const x = 1; /* squatch */ // squatch\nconst customer = \"squatch\";"
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .toLowerCase();
  assert.match(stripped, /squatch/, "code occurrences must survive stripping");
  assert.equal((stripped.match(/squatch/g) ?? []).length, 1, "only the code one");
});

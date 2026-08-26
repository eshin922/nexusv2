import assert from "node:assert/strict";
import test from "node:test";

import {
  composeContactName,
  selectContact,
  selectPrimaryCompany,
} from "../../src/lib/hubspot-customer-identity.ts";

/**
 * #431 Step 2 — the governed V1 contact-selection rule.
 *
 * The output of this function is a named individual printed on a
 * customer-facing quotation. The tests below are mostly about what it REFUSES
 * to do, because that is where the cost of being wrong lands.
 */

test("explicit primary wins", () => {
  const r = selectContact([
    { contactId: "a", isPrimary: false },
    { contactId: "b", isPrimary: true },
    { contactId: "c", isPrimary: false },
  ]);
  assert.deepEqual(r, { contactId: "b", selection: "primary" });
});

test("exactly one association is used", () => {
  assert.deepEqual(selectContact([{ contactId: "solo", isPrimary: false }]), {
    contactId: "solo",
    selection: "sole",
  });
});

test("zero associations is blank, and says which kind of blank", () => {
  assert.deepEqual(selectContact([]), { contactId: null, selection: "none_zero" });
});

test("several with no primary is blank — NOT the first one", () => {
  const r = selectContact([
    { contactId: "first", isPrimary: false },
    { contactId: "second", isPrimary: false },
  ]);
  assert.equal(r.contactId, null, "picked a contact where the rule says blank");
  assert.equal(r.selection, "none_multiple");
});

test("order does not change the answer", () => {
  // The falsification that matters: if any ordering heuristic were in play,
  // reversing the input would change the result. It must not.
  const forward = selectContact([
    { contactId: "x", isPrimary: false },
    { contactId: "y", isPrimary: false },
    { contactId: "z", isPrimary: false },
  ]);
  const reversed = selectContact([
    { contactId: "z", isPrimary: false },
    { contactId: "y", isPrimary: false },
    { contactId: "x", isPrimary: false },
  ]);
  assert.deepEqual(forward, reversed);
  assert.equal(forward.contactId, null);
});

test("several marked primary is a contradiction, not a tie to break", () => {
  const r = selectContact([
    { contactId: "p1", isPrimary: true },
    { contactId: "p2", isPrimary: true },
  ]);
  assert.equal(r.contactId, null);
  assert.equal(r.selection, "none_multiple");
});

test("the sole-contact branch does not fire when a primary is contradictory", () => {
  // Two primaries among three: falling through to "sole" would be absurd, and
  // falling through to first-wins would be the banned heuristic.
  const r = selectContact([
    { contactId: "p1", isPrimary: true },
    { contactId: "p2", isPrimary: true },
    { contactId: "n", isPrimary: false },
  ]);
  assert.equal(r.contactId, null);
});

test("company selection takes the explicit primary, never position", () => {
  // typeId 5 is HubSpot's "Primary" for deal->companies, confirmed against the
  // live schema. The primary here is deliberately NOT first.
  assert.equal(
    selectPrimaryCompany([
      { companyId: "notPrimary", typeIds: [341] },
      { companyId: "primary", typeIds: [5, 341] },
    ]),
    "primary",
  );
});

test("no primary company is null, not the first row", () => {
  assert.equal(
    selectPrimaryCompany([
      { companyId: "a", typeIds: [341] },
      { companyId: "b", typeIds: [341] },
    ]),
    null,
  );
  assert.equal(selectPrimaryCompany([]), null);
});

test("contact name composes from parts, or is absent", () => {
  assert.equal(composeContactName("Jennifer", "Sevilla"), "Jennifer Sevilla");
  assert.equal(composeContactName("Jennifer", null), "Jennifer");
  assert.equal(composeContactName(null, "Sevilla"), "Sevilla");
  assert.equal(composeContactName(null, null), null);
  assert.equal(composeContactName("  ", ""), null);
});

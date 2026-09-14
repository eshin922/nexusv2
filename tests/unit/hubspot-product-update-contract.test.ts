// The UPDATE contract, tested where it can actually be wrong.
//
// Every assertion here corresponds to a way the first implementation of the
// Library edit was defective. It reused the CREATE input, so it could not
// express "leave this alone", could not express "clear this", and injected a
// price default on every edit. None of those produced an error; they produced
// a quietly wrong product in HubSpot.
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHubspotWriteOutcome,
  hubspotUpdateLanded,
  hubspotWriteOutcomeOf,
  normalizeHubSpotProductCreateInput,
  toHubSpotProductUpdateProperties,
  type HubSpotProductSnapshot,
} from "../../src/lib/integrations/hubspot-provider.ts";
import { mapLeafToHubspotUpdate } from "../../src/lib/hubspot-mapper.ts";

// ── untouched, cleared, set — three states, not two ───────────────────────

test("an omitted field is not transmitted, so HubSpot keeps its value", () => {
  const props = toHubSpotProductUpdateProperties({ name: "Renamed" });
  assert.deepEqual(props, { name: "Renamed" });
  assert.equal("hs_url" in props, false);
  assert.equal("hs_cost_of_goods_sold" in props, false);
});

test("an explicit null is transmitted as an empty string, which is how HubSpot clears", () => {
  const props = toHubSpotProductUpdateProperties({ name: "N", hs_url: null });
  assert.equal(props.hs_url, "");
  assert.equal("hs_url" in props, true, "clearing must not degrade to omission");
});

test("undefined and null are DIFFERENT on the wire", () => {
  // This is the whole defect in one assertion. The create mapper dropped empty
  // strings, so both intents arrived as omission and one of them was wrong.
  const untouched = toHubSpotProductUpdateProperties({ hs_url: undefined });
  const cleared = toHubSpotProductUpdateProperties({ hs_url: null });
  assert.notDeepEqual(untouched, cleared);
  assert.deepEqual(untouched, {});
  assert.deepEqual(cleared, { hs_url: "" });
});

test("values are trimmed but not otherwise rewritten", () => {
  const props = toHubSpotProductUpdateProperties({ hs_sku: "  DPS-1  " });
  assert.equal(props.hs_sku, "DPS-1");
});

// ── no create-time price default ──────────────────────────────────────────

test("an edit transmits NO price, ever", () => {
  const props = toHubSpotProductUpdateProperties({
    name: "Renamed",
    hs_cost_of_goods_sold: "12.50",
  });
  assert.equal("price" in props, false);
});

test("the create normalizer WOULD have injected 0.00 — which is why update has its own", () => {
  // Establishes the defect rather than asserting it away: the create path is
  // correct for a create, and reusing it on an edit overwrote a real price
  // with zero as a side effect of renaming a product.
  const created = normalizeHubSpotProductCreateInput({ name: "X" });
  assert.equal(created.price, "0.00");

  const edited = toHubSpotProductUpdateProperties(
    mapLeafToHubspotUpdate({
      name: "X",
      sku: null,
      unitCost: null,
      url: null,
      hubspotProductType: null,
    }),
  );
  assert.equal("price" in edited, false);
});

// ── the leaf mapper ───────────────────────────────────────────────────────

test("emptying a field on the edit surface CLEARS it in HubSpot", () => {
  const props = toHubSpotProductUpdateProperties(
    mapLeafToHubspotUpdate({
      name: "Lube 4oz",
      sku: "DPS-1",
      unitCost: null,
      url: null,
      hubspotProductType: null,
    }),
  );
  assert.equal(props.hs_url, "");
  assert.equal(props.hs_cost_of_goods_sold, "");
  assert.equal(props.hs_product_type, "");
});

test("a still-missing SKU leaves HubSpot's alone rather than blanking it", () => {
  // null here means "this product still has no SKU", not "unset HubSpot's".
  // Clearing an established SKU is refused before it reaches the mapper.
  const props = toHubSpotProductUpdateProperties(
    mapLeafToHubspotUpdate({
      name: "N",
      sku: null,
      unitCost: "1",
      url: "https://x.invalid",
      hubspotProductType: "Primary",
    }),
  );
  assert.equal("hs_sku" in props, false);
});

// ── outcome certainty ─────────────────────────────────────────────────────

test("a 4xx is REJECTED — nothing applied, and that is established", () => {
  assert.equal(classifyHubspotWriteOutcome(400), "rejected");
  assert.equal(classifyHubspotWriteOutcome(401), "rejected");
  assert.equal(classifyHubspotWriteOutcome(404), "rejected");
  assert.equal(classifyHubspotWriteOutcome(409), "rejected");
});

test("a timeout, a throttle, a 5xx and a silent failure are all UNCERTAIN", () => {
  // The default matters more than the cases. An unrecognised failure is one
  // nobody adjudicated, and "I do not know" must not resolve to "nothing
  // happened" — that is the statement the operator would act on.
  assert.equal(classifyHubspotWriteOutcome(408), "uncertain");
  assert.equal(classifyHubspotWriteOutcome(429), "uncertain");
  assert.equal(classifyHubspotWriteOutcome(500), "uncertain");
  assert.equal(classifyHubspotWriteOutcome(502), "uncertain");
  assert.equal(classifyHubspotWriteOutcome(null), "uncertain");
});

test("an error's own verdict wins; a bare error is uncertain", () => {
  assert.equal(hubspotWriteOutcomeOf({ outcome: "rejected" }), "rejected");
  assert.equal(hubspotWriteOutcomeOf(Object.assign(new Error("x"), { code: 400 })), "rejected");
  assert.equal(hubspotWriteOutcomeOf(new Error("socket hang up")), "uncertain");
  assert.equal(hubspotWriteOutcomeOf(undefined), "uncertain");
});

// ── reconciliation is strict ──────────────────────────────────────────────

function snap(properties: Record<string, string | null>): HubSpotProductSnapshot {
  return { id: "998", archived: false, properties };
}

test("a landing requires EVERY submitted value to be present", () => {
  const input = { name: "New", hs_sku: "DPS-1" };
  assert.equal(hubspotUpdateLanded(snap({ name: "New", hs_sku: "DPS-1" }), input), true);
});

test("a PARTIAL landing is not a landing", () => {
  // Recording this as success would mark Nexus synchronized against a product
  // holding some mixture of old and new values.
  const input = { name: "New", hs_sku: "DPS-1" };
  assert.equal(hubspotUpdateLanded(snap({ name: "New", hs_sku: "OLD" }), input), false);
  assert.equal(hubspotUpdateLanded(snap({ name: "Old", hs_sku: "DPS-1" }), input), false);
});

test("a cleared field lands when it reads back absent or empty", () => {
  assert.equal(hubspotUpdateLanded(snap({ hs_url: null }), { hs_url: null }), true);
  assert.equal(hubspotUpdateLanded(snap({}), { hs_url: null }), true);
  assert.equal(
    hubspotUpdateLanded(snap({ hs_url: "https://old.invalid" }), { hs_url: null }),
    false,
    "a field that still holds its old value was not cleared",
  );
});

test("an untransmitted field is not compared", () => {
  // The product's price differing from anything is irrelevant: we did not
  // address it, so it cannot be evidence about whether our write landed.
  assert.equal(
    hubspotUpdateLanded(snap({ name: "New", price: "99.00" }), { name: "New" }),
    true,
  );
});

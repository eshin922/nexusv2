import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommercialSettingsForLifecycle } from "../../src/lib/commercial-settings-contract.ts";

const live = { targetMarginPct: 0.35, floorMarginPct: 0.25, freightMarkupPct: 0.3, markupDefaults: { Other: 0.3 } };
const pinned = { targetMarginPct: 0.4, floorMarginPct: 0.28, freightMarkupPct: 0.42, markupDefaults: { Other: 0.32 } };

test("drafts always resolve live commercial settings", () => {
  assert.deepEqual(resolveCommercialSettingsForLifecycle({ status: "draft", live, pinned }), { ...live, source: "live" });
});

test("sent, accepted, and complete states resolve their pin", () => {
  for (const status of ["sent", "accepted", "complete"] as const) {
    assert.deepEqual(resolveCommercialSettingsForLifecycle({ status, live, pinned }), { ...pinned, source: "pinned" });
  }
});

test("legacy sent Quotes without a pin retain approved read-live behavior", () => {
  assert.deepEqual(resolveCommercialSettingsForLifecycle({ status: "sent", live, pinned: null }), { ...live, source: "legacy_live" });
});

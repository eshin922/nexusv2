import assert from "node:assert/strict";
import test from "node:test";
import { resolveBreakFieldSources } from "../../src/lib/freight-break-write.ts";

// Behavioural coverage for the authority case: "one value, all breaks"
// governs the freight amount ONLY. Mode and shipment description remain
// per-break, because the same shipment family may legitimately be LTL at one
// break and FTL at another while carrying one negotiated amount across all
// of them.
//
// These assert outcomes, not source text.

const TIERS = { t1: "tier-1", t2: "tier-2", t3: "tier-3" };

const allFieldsSubmitted = (flat: boolean) =>
  new Set([
    // Flat mode renders one amount cell; differs-by-break renders all three.
    ...(flat
      ? [`freightAmount:${TIERS.t1}`, `freightMarkupPct:${TIERS.t1}`]
      : Object.values(TIERS).flatMap((id) => [`freightAmount:${id}`, `freightMarkupPct:${id}`])),
    // Mode + description always render for every break, in both states.
    ...Object.values(TIERS).flatMap((id) => [`mode:${id}`, `shipmentNote:${id}`]),
  ]);

test("flat mode sources one amount for every break", () => {
  const submittedKeys = allFieldsSubmitted(true);
  for (const rowTierId of Object.values(TIERS)) {
    const resolved = resolveBreakFieldSources({ flat: true, sourceTierId: TIERS.t1, rowTierId, submittedKeys });
    assert.equal(resolved.amountKey, TIERS.t1, `${rowTierId} must take its amount from the flat tier`);
  }
});

test("flat mode keeps mode and description per-break", () => {
  const submittedKeys = allFieldsSubmitted(true);

  // The authority case: one shared amount, different operational identity on
  // two of the three breaks.
  const t1 = resolveBreakFieldSources({ flat: true, sourceTierId: TIERS.t1, rowTierId: TIERS.t1, submittedKeys });
  const t2 = resolveBreakFieldSources({ flat: true, sourceTierId: TIERS.t1, rowTierId: TIERS.t2, submittedKeys });
  const t3 = resolveBreakFieldSources({ flat: true, sourceTierId: TIERS.t1, rowTierId: TIERS.t3, submittedKeys });

  // One amount across all breaks...
  assert.equal(t1.amountKey, TIERS.t1);
  assert.equal(t2.amountKey, TIERS.t1);
  assert.equal(t3.amountKey, TIERS.t1);

  // ...while each break writes its OWN mode and description. If any of these
  // resolved to the flat tier, LTL-at-25K / FTL-at-100K would be unwritable.
  assert.equal(t1.modeKey, TIERS.t1);
  assert.equal(t2.modeKey, TIERS.t2);
  assert.equal(t3.modeKey, TIERS.t3);
  assert.equal(t1.noteKey, TIERS.t1);
  assert.equal(t2.noteKey, TIERS.t2);
  assert.equal(t3.noteKey, TIERS.t3);
});

test("differs-by-break sources every field from its own break", () => {
  const submittedKeys = allFieldsSubmitted(false);
  for (const rowTierId of Object.values(TIERS)) {
    const resolved = resolveBreakFieldSources({ flat: false, sourceTierId: TIERS.t1, rowTierId, submittedKeys });
    assert.equal(resolved.amountKey, rowTierId);
    assert.equal(resolved.modeKey, rowTierId);
    assert.equal(resolved.noteKey, rowTierId);
  }
});

test("absent operational fields are preserved, not cleared", () => {
  // A submission that carries only amounts — e.g. a future caller, or a
  // collapsed detail pane. Mode and description must survive untouched.
  const submittedKeys = new Set([`freightAmount:${TIERS.t1}`, `freightMarkupPct:${TIERS.t1}`]);

  for (const rowTierId of Object.values(TIERS)) {
    const resolved = resolveBreakFieldSources({ flat: true, sourceTierId: TIERS.t1, rowTierId, submittedKeys });
    assert.equal(resolved.modeKey, null, "absent mode must resolve to preserve, not overwrite");
    assert.equal(resolved.noteKey, null, "absent description must resolve to preserve, not overwrite");
  }
});

test("toggling flat on and off preserves tier-specific operational values", () => {
  const rowTierId = TIERS.t3;

  // Differs-by-break: t3 owns its mode.
  const before = resolveBreakFieldSources({
    flat: false, sourceTierId: TIERS.t1, rowTierId, submittedKeys: allFieldsSubmitted(false),
  });
  // Operator switches to one-value-all-breaks.
  const during = resolveBreakFieldSources({
    flat: true, sourceTierId: TIERS.t1, rowTierId, submittedKeys: allFieldsSubmitted(true),
  });
  // ...and back again.
  const after = resolveBreakFieldSources({
    flat: false, sourceTierId: TIERS.t1, rowTierId, submittedKeys: allFieldsSubmitted(false),
  });

  // The amount source moves with the flat state, as it should.
  assert.equal(before.amountKey, rowTierId);
  assert.equal(during.amountKey, TIERS.t1);
  assert.equal(after.amountKey, rowTierId);

  // The operational identity never moves. No transition redirects t3's mode
  // or description to another break, so no transition can overwrite them.
  for (const state of [before, during, after]) {
    assert.equal(state.modeKey, rowTierId);
    assert.equal(state.noteKey, rowTierId);
  }
});

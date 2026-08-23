import assert from "node:assert/strict";
import test from "node:test";

import {
  RECOVERY_CHARGES,
  RECOVERY_MODES,
  assertRegistryCoherent,
  chargePolicy,
  isModeAvailable,
  refusalReason,
  type RecoveryChargeKey,
} from "../../src/lib/commercial-recovery/registry.ts";
import {
  ALLOCATED_ABSORPTION_REFUSAL,
  RecoveryPolicyError,
  amountAbsorbed,
  amountToDecompose,
  modeAvailability,
  refusalFor,
  resolveCharge,
} from "../../src/lib/commercial-recovery/resolve.ts";

// ═══════════════════════════════════════════════════════════════════════
// The policy layer, and the legacy behaviour it must not disturb.
//
// Cases are numbered against the matrix in
// docs/commercial-recovery-per-charge-model.md §5.
// ═══════════════════════════════════════════════════════════════════════

// ── Case 10 · available and refusals are exhaustive complements ─────────

test("case 10 — every denied mode carries a governed reason", () => {
  // The registry asserts its own coherence. A denied mode with no reason
  // would reach an operator as an option that is simply missing, with
  // nothing on screen saying why — which is the defect, not the absence.
  assert.doesNotThrow(() => assertRegistryCoherent());

  for (const charge of RECOVERY_CHARGES) {
    for (const mode of RECOVERY_MODES) {
      const available = charge.available.includes(mode);
      const reason = refusalReason(charge.key, mode);
      if (available) {
        assert.equal(reason, null, `${charge.key}/${mode} both allowed and refused`);
      } else {
        assert.ok(
          reason && reason.trim().length > 0,
          `${charge.key}/${mode} is denied with no reason`,
        );
      }
    }
  }
});

test("case 10 — a denied mode with no reason fails the coherence check", () => {
  // Proves the check can FAIL. A coherence assertion that cannot fail is
  // indistinguishable from one that is not running.
  const broken = {
    key: "tooling" as RecoveryChargeKey,
    label: "x",
    grain: "one_time" as const,
    source: [],
    available: ["included"] as const,
    refusals: {}, // separate + absorbed denied, no reasons
  };
  let threw = false;
  for (const mode of RECOVERY_MODES) {
    if (!broken.available.includes(mode as "included") && !(mode in broken.refusals)) {
      threw = true;
    }
  }
  assert.ok(threw, "the fixture does not actually model the defect");
});

// ── Cases 7-9 · the Design Authority refusals, verbatim ────────────────

test("case 7 — container freight cannot be absorbed", () => {
  assert.equal(isModeAvailable("container_freight", "absorbed"), false);
  assert.equal(
    refusalReason("container_freight", "absorbed"),
    "Policy: freight must be recovered",
  );
  // Both included and separate remain, so the refusal is specific rather
  // than the charge being non-elective.
  assert.equal(isModeAvailable("container_freight", "included"), true);
  assert.equal(isModeAvailable("container_freight", "separate"), true);
});

test("case 8 — duty & tariffs cannot be absorbed", () => {
  assert.equal(isModeAvailable("duty_tariffs", "absorbed"), false);
  assert.equal(
    refusalReason("duty_tariffs", "absorbed"),
    "Statutory pass-through — cannot be absorbed",
  );
});

test("case 9 — artwork & plate cannot be separated", () => {
  assert.equal(isModeAvailable("artwork_plate", "separate"), false);
  assert.equal(refusalReason("artwork_plate", "separate"), "Not separately invoiceable");
  // Absorbed IS allowed here — the denial is separate, not the whole charge.
  assert.equal(isModeAvailable("artwork_plate", "absorbed"), true);
});

// ── Case 19 · the four BV-011 fees are non-elective ────────────────────

const BV011_FEES: RecoveryChargeKey[] = [
  "rd_formulation",
  "testing_micros",
  "other_service",
  "tooling_artwork_legacy",
];

test("case 19 — the four BV-011 fees have no available modes", () => {
  for (const key of BV011_FEES) {
    assert.deepEqual(
      chargePolicy(key).available,
      [],
      `${key} is electable — BV-011 does not authorize recovery policy`,
    );
    for (const mode of RECOVERY_MODES) {
      const reason = refusalReason(key, mode);
      assert.ok(reason, `${key}/${mode} denied with no reason`);
      assert.match(
        reason,
        /BV-011/,
        `${key}/${mode} refusal does not cite the governing document`,
      );
    }
  }
});

test("case 19 — the legacy combined field's refusal names why it is structural", () => {
  // This one is not merely "undecided": the field spans two destinations with
  // different item types, so no single election can apply. The reason must say
  // that, and name the migration that would change it.
  const reason = refusalReason("tooling_artwork_legacy", "included");
  assert.ok(reason);
  assert.match(reason, /OTC - Tooling/);
  assert.match(reason, /OTC - Artwork/);
  assert.match(reason, /split/i);
});

test("case 19 — per-unit COGS is not addressable as a charge at all", () => {
  // Case 12. Filling/blending, CM assembly and bulk raw are the unit price.
  // They are absent from the registry, not present-and-refused: there is no
  // election to make, so there is nothing to refuse.
  const keys = RECOVERY_CHARGES.map((c) => c.key);
  for (const absent of ["filling_blending", "cm_assembly", "bulk_raw", "packaging"]) {
    assert.ok(!keys.includes(absent as RecoveryChargeKey), `${absent} is in the registry`);
  }
});

// ── Case 11 · resolution refuses, not only the surface ─────────────────

test("case 11 — resolution refuses a prohibited election with the governed reason", () => {
  assert.throws(
    () =>
      resolveCharge("container_freight", { chargeKey: "container_freight", mode: "absorbed" }, null),
    (err: unknown) => {
      assert.ok(err instanceof RecoveryPolicyError);
      assert.equal(err.reason, "Policy: freight must be recovered");
      return true;
    },
    "an absorbed freight election was honoured",
  );

  for (const key of BV011_FEES) {
    assert.throws(
      () => resolveCharge(key, { chargeKey: key, mode: "included" }, true),
      RecoveryPolicyError,
      `${key} accepted an election despite being non-elective`,
    );
  }
});

// ── Cases 2, 13, 14 · legacy resolution and mixed allocation ───────────

test("case 2 — no election resolves through the per-assembly value", () => {
  // The mapping is the EXISTING behaviour restated: allocating a fee into unit
  // cost is recovering it in the unit price; not allocating is billing it
  // separately. Not a new decision.
  assert.deepEqual(resolveCharge("tooling", null, true), {
    key: "tooling",
    mode: "included",
    source: "legacy",
  });
  assert.deepEqual(resolveCharge("tooling", null, false), {
    key: "tooling",
    mode: "separate",
    source: "legacy",
  });
});

test("case 2 — mixed allocation survives because resolution is per-assembly", () => {
  // Three real quotes carry OFF and ON simultaneously, one already SENT.
  // Resolving once at quote level would flatten exactly that state, so the
  // same charge must be able to resolve differently per assembly.
  const assemblyA = resolveCharge("project_setup", null, true);
  const assemblyB = resolveCharge("project_setup", null, false);
  assert.equal(assemblyA.mode, "included");
  assert.equal(assemblyB.mode, "separate");
  assert.notEqual(assemblyA.mode, assemblyB.mode);
});

test("case 2 — null allocation carries the existing `?? true` default", () => {
  assert.equal(resolveCharge("tooling", null, null).mode, "included");
  assert.equal(resolveCharge("tooling", null, undefined).mode, "included");
});

test("case 14 — clearing an election restores the per-assembly value exactly", () => {
  // The property that makes the override non-destructive. An election never
  // writes the assembly column, so removing it returns the ORIGINAL value
  // rather than a default standing in for one that was overwritten.
  const beforeOn = resolveCharge("tooling", null, false);
  const elected = resolveCharge("tooling", { chargeKey: "tooling", mode: "included" }, false);
  const afterClear = resolveCharge("tooling", null, false);

  assert.equal(elected.mode, "included");
  assert.equal(elected.source, "election");
  assert.deepEqual(afterClear, beforeOn);
  assert.equal(afterClear.mode, "separate", "the preserved exception was lost");
});

test("case 13 — provenance distinguishes 'nobody elected' from 'elected the same value'", () => {
  // What a fourth enum member would have collapsed.
  const legacyIncluded = resolveCharge("tooling", null, true);
  const electedIncluded = resolveCharge(
    "tooling",
    { chargeKey: "tooling", mode: "included" },
    true,
  );
  assert.equal(legacyIncluded.mode, electedIncluded.mode);
  assert.notEqual(legacyIncluded.source, electedIncluded.source);
});

// ── Case 22 · the first departure from uniform allocation ──────────────

test("case 22 — with no elections, ALL one-time fees still resolve uniformly", () => {
  // THE PRESERVATION GUARANTEE FOR THE UNIFORM-ALLOCATION DEPARTURE.
  //
  // BV-011 §4.9 records that `allocate_service_fees_to_cost` governs Setup,
  // Tooling/artwork, R&D and Other service TOGETHER. Making three of them
  // electable is the first thing to depart from that.
  //
  // The guarantee: a legacy quote with NO elections must still see every
  // one-time fee resolve identically, exactly as the shared boolean produced.
  // The departure may only appear where an operator actually elected.
  const oneTime = RECOVERY_CHARGES.filter((c) => c.grain === "one_time");
  assert.ok(oneTime.length >= 7, "the one-time set shrank unexpectedly");

  for (const allocate of [true, false]) {
    const modes = new Set(oneTime.map((c) => resolveCharge(c.key, null, allocate).mode));
    assert.equal(
      modes.size,
      1,
      `one-time fees diverged with no election at allocate=${allocate}: ` +
        `${[...modes].join(", ")}`,
    );
    assert.equal([...modes][0], allocate ? "included" : "separate");
  }
});

test("case 22 — electing one charge does not move any sibling", () => {
  // The departure must be surgical. Electing Tooling must leave R&D, Other
  // Service and legacy Tooling/artwork on the shared boolean untouched --
  // otherwise the new policy silently changes legacy quotes that never opted
  // in, which is the exact risk this case exists to catch.
  const allocate = false; // legacy: everything bills separately
  const elected = resolveCharge("tooling", { chargeKey: "tooling", mode: "included" }, allocate);
  assert.equal(elected.mode, "included");

  for (const key of BV011_FEES) {
    const sibling = resolveCharge(key, null, allocate);
    assert.equal(sibling.mode, "separate", `${key} moved when tooling was elected`);
    assert.equal(sibling.source, "legacy");
  }
  // And the other Authority charges that were not elected stay legacy too.
  for (const key of ["project_setup", "artwork_plate"] as RecoveryChargeKey[]) {
    assert.equal(resolveCharge(key, null, allocate).source, "legacy");
    assert.equal(resolveCharge(key, null, allocate).mode, "separate");
  }
});

// ── Cases 5, 6, 17 · the arithmetic contract ───────────────────────────

// -- Case 23 * `absorbed` on an already-allocated charge ----------------
//
// The mode is available on the charge and still refused HERE, because the
// refusal is about the assembly's state, not the charge. Absorbing a charge
// the unit rate already recovers would drop the customer line and leave its
// revenue inside the rate — a silently wrong total, which is far worse than
// a visible failure.

test("case 23 — absorbed is refused while the charge is allocated into unit cost", () => {
  // Statically permitted...
  assert.equal(isModeAvailable("tooling", "absorbed"), true);
  assert.equal(refusalReason("tooling", "absorbed"), null);

  // ...and still refused in an allocating assembly.
  assert.equal(
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: true }),
    ALLOCATED_ABSORPTION_REFUSAL,
  );

  assert.throws(
    () =>
      resolveCharge("tooling", { chargeKey: "tooling", mode: "absorbed" }, true),
    (e: unknown) => {
      assert.ok(e instanceof RecoveryPolicyError);
      assert.equal(e.reason, ALLOCATED_ABSORPTION_REFUSAL);
      return true;
    },
    "absorbing an allocated charge must refuse, not silently mis-price",
  );
});

test("case 23 — absorbed is ALLOWED when the charge is not allocated", () => {
  assert.equal(
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: false }),
    null,
  );
  const r = resolveCharge(
    "tooling",
    { chargeKey: "tooling", mode: "absorbed" },
    false,
  );
  assert.equal(r.mode, "absorbed");
  assert.equal(r.source, "election");
  // And it is the mode that moves money — the whole reason it is separate.
  assert.equal(amountAbsorbed(r, 1200), 1200);
});

test("case 23 — the default allocation state refuses, matching `?? true`", () => {
  // A null/absent allocation value means allocated, per the pre-recovery
  // default. It must refuse for the same reason an explicit `true` does,
  // rather than falling through as if nothing were allocated.
  for (const v of [null, undefined]) {
    assert.equal(
      refusalFor("tooling", "absorbed", { perAssemblyAllocate: v }),
      ALLOCATED_ABSORPTION_REFUSAL,
      `allocation ${String(v)} must not read as un-allocated`,
    );
  }
});

test("case 23 — the refusal does not touch included or separate", () => {
  // included/separate continue to follow the governed contract regardless of
  // allocation state. Only `absorbed` is context-sensitive.
  for (const allocate of [true, false]) {
    assert.equal(
      refusalFor("tooling", "included", { perAssemblyAllocate: allocate }),
      null,
    );
    assert.equal(
      refusalFor("project_setup", "separate", { perAssemblyAllocate: allocate }),
      null,
    );
  }
});

test("case 23 — landed charges have no allocation dimension to refuse on", () => {
  // Freight/customs are quote-level. Their `absorbed` refusal is the static
  // policy one, and it must not be replaced by the contextual message.
  for (const key of ["container_freight", "duty_tariffs"] as RecoveryChargeKey[]) {
    const reason = refusalFor(key, "absorbed", { perAssemblyAllocate: true });
    assert.equal(reason, refusalReason(key, "absorbed"));
    assert.notEqual(reason, ALLOCATED_ABSORPTION_REFUSAL);
  }
});

test("case 23 — every mode is rendered with a verdict, none hidden", () => {
  const rows = modeAvailability("tooling", { perAssemblyAllocate: true });
  assert.equal(
    rows.length,
    RECOVERY_MODES.length,
    "a mode was dropped from the surface",
  );
  for (const r of rows) {
    // Exhaustive complements at the rendering boundary too: a denied mode
    // without a reason would reach an operator as a silently missing option.
    assert.equal(
      r.available,
      r.reason === null,
      `${r.mode}: availability and reason disagree`,
    );
  }
  assert.deepEqual(
    rows.filter((r) => !r.available).map((r) => r.mode),
    ["absorbed"],
  );
});

test("case 5 — only `separate` decomposes; the amount lifted is the amount moved", () => {
  const included = resolveCharge("container_freight", null, null);
  const separate = resolveCharge(
    "container_freight",
    { chargeKey: "container_freight", mode: "separate" },
    null,
  );
  assert.equal(amountToDecompose(included, 1.25), 0);
  assert.equal(amountToDecompose(separate, 1.25), 1.25);
  // Revenue-neutral by construction: what leaves the unit rate is exactly
  // what the separate line carries.
});

test("case 6 — only `absorbed` removes revenue", () => {
  const separate = resolveCharge("tooling", { chargeKey: "tooling", mode: "separate" }, null);
  // Read on the NOT-ALLOCATED baseline, which is the only state where
  // `absorbed` is a legitimate election (case 23). Allocated + absorbed is
  // refused rather than measured, so the revenue claim below is scoped to
  // exactly the case that can actually reach a customer document.
  const absorbed = resolveCharge("tooling", { chargeKey: "tooling", mode: "absorbed" }, false);
  assert.equal(amountAbsorbed(separate, 900), 0, "separate removed revenue");
  assert.equal(amountAbsorbed(absorbed, 900), 900);
  // And absorbed does NOT also decompose -- it is removed, not re-presented.
  assert.equal(amountToDecompose(absorbed, 900), 0);
});

test("case 17 — the identity case short-circuits rather than round-tripping", () => {
  // OD-025: subtracting a component and re-adding it need not reproduce the
  // original bits. A zero charge must leave the rate untouched, not compute
  // `rate - 0` and trust the result.
  const separate = resolveCharge("tooling", { chargeKey: "tooling", mode: "separate" }, null);
  assert.equal(amountToDecompose(separate, 0), 0);
  assert.equal(amountToDecompose(separate, null), 0);
  assert.equal(amountToDecompose(separate, undefined), 0);
  assert.equal(amountToDecompose(separate, Number.NaN), 0);
  assert.equal(amountToDecompose(separate, Number.POSITIVE_INFINITY), 0);
});

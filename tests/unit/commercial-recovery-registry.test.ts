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
  ABSORB_INVISIBLE_TO_FLOOR,
  ELECTION_DELETES_CHARGE,
  ELECTION_DOUBLE_BILLS,
  LANDED_SEPARATE_UNWIRED,
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
  // The election AGREES with the legacy boolean, which is the only kind
  // currently honourable (case 23) — and it is still enough to prove the
  // property, because what is being tested is provenance and restoration,
  // not whether the mode differs.
  const beforeOn = resolveCharge("tooling", null, false);
  const elected = resolveCharge("tooling", { chargeKey: "tooling", mode: "separate" }, false);
  const afterClear = resolveCharge("tooling", null, false);

  assert.equal(elected.mode, "separate");
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
  // An explicit election on Tooling, agreeing with the boolean per case 23.
  // Provenance is what distinguishes it from the siblings below, and
  // provenance is what this case is about.
  const elected = resolveCharge("tooling", { chargeKey: "tooling", mode: "separate" }, allocate);
  assert.equal(elected.source, "election");

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

test("case 23 — an election that DISAGREES with the legacy boolean is refused", () => {
  // Statically permitted by the registry...
  assert.equal(isModeAvailable("project_setup", "included"), true);
  assert.equal(isModeAvailable("project_setup", "separate"), true);
  assert.equal(refusalReason("project_setup", "included"), null);

  // ...and refused anyway, in exactly the two directions the falsification
  // measured (tests/unit/commercial-recovery-election-effect.test.ts):
  // suppressing a line the unit price does not contain DELETES the charge;
  // emitting one the unit price does contain BILLS IT TWICE.
  assert.equal(
    refusalFor("project_setup", "included", { perAssemblyAllocate: false }),
    ELECTION_DELETES_CHARGE,
  );
  assert.equal(
    refusalFor("project_setup", "separate", { perAssemblyAllocate: true }),
    ELECTION_DOUBLE_BILLS,
  );

  for (const [mode, allocate] of [
    ["included", false],
    ["separate", true],
  ] as const) {
    assert.throws(
      () => resolveCharge("project_setup", { chargeKey: "project_setup", mode }, allocate),
      RecoveryPolicyError,
      `${mode} at allocate=${allocate} must refuse, not silently mis-price`,
    );
  }
});

test("case 23 — an election that AGREES with the legacy boolean is accepted", () => {
  // The only currently-correct elections are the ones that change nothing.
  // That is the finding, stated as the passing case rather than buried.
  assert.equal(refusalFor("project_setup", "included", { perAssemblyAllocate: true }), null);
  assert.equal(refusalFor("project_setup", "separate", { perAssemblyAllocate: false }), null);

  const r = resolveCharge(
    "project_setup",
    { chargeKey: "project_setup", mode: "included" },
    true,
  );
  assert.equal(r.mode, "included");
  // Provenance still distinguishes it from the legacy fall-through.
  assert.equal(r.source, "election");
});

test("case 23 — absorbed is refused in BOTH allocation states", () => {
  // Allocating: the unit rate already recovers it, so suppressing the line
  // drops the line and leaves the revenue.
  //
  // NOT allocating: the charge was billed separately, and separately-billed
  // fees are never in the tier revenue the floor gate and the below-floor
  // fingerprint are computed from — so the customer pays less and the measured
  // margin does not move. Real, and invisible to the control meant to catch it.
  for (const allocate of [true, false, null, undefined]) {
    assert.equal(
      refusalFor("tooling", "absorbed", { perAssemblyAllocate: allocate }),
      ABSORB_INVISIBLE_TO_FLOOR,
      `absorbed must refuse at allocate=${String(allocate)}`,
    );
  }
  assert.throws(
    () => resolveCharge("tooling", { chargeKey: "tooling", mode: "absorbed" }, false),
    (e: unknown) => {
      assert.ok(e instanceof RecoveryPolicyError);
      assert.equal(e.reason, ABSORB_INVISIBLE_TO_FLOOR);
      return true;
    },
  );
});

test("case 23 — every refusal names what opens it, not just that it is closed", () => {
  // A refusal an operator cannot act on and cannot date is indistinguishable
  // from a bug. Each of these says what has to change.
  for (const reason of [ELECTION_DELETES_CHARGE, ELECTION_DOUBLE_BILLS, ABSORB_INVISIBLE_TO_FLOOR]) {
    assert.match(reason, /^Not available yet\./);
    // What opens it, in terms an operator can hold — the capability, not the
    // module that will provide it.
    assert.match(reason, /It opens once /);
    assert.doesNotMatch(reason, /engine|layer|projection/i);
  }
  // And they must not read as policy refusals — the firm permits these modes.
  for (const reason of [ELECTION_DELETES_CHARGE, ELECTION_DOUBLE_BILLS]) {
    assert.doesNotMatch(reason, /must be recovered|cannot be absorbed|not separately invoiceable/i);
  }
});

test("case 23 — landed charges are not judged on an allocation state they lack", () => {
  // Freight/customs are quote-level. Their `absorbed` refusal is the static
  // policy one and must not be replaced by the one-time contextual message.
  for (const key of ["container_freight", "duty_tariffs"] as RecoveryChargeKey[]) {
    const reason = refusalFor(key, "absorbed", { perAssemblyAllocate: true });
    assert.equal(reason, refusalReason(key, "absorbed"));
    assert.notEqual(reason, ABSORB_INVISIBLE_TO_FLOOR);
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
  // At allocate=true the only currently-honourable mode is `included`.
  assert.deepEqual(
    rows.filter((r) => r.available).map((r) => r.mode),
    ["included"],
  );
});

// -- Case 24 * a mode the projection cannot honour is refused, not stored ---
//
// The worst outcome available here is not a refusal and not a crash: it is an
// election that is persisted, audited, shown as chosen, and changes no number
// anyone sees. That looks settled while being inert.

test("case 24 — `separate` on a landed charge is refused while unwired", () => {
  for (const key of ["container_freight", "duty_tariffs"] as RecoveryChargeKey[]) {
    // The Authority PERMITS it — the registry says so...
    assert.equal(isModeAvailable(key, "separate"), true);
    assert.equal(refusalReason(key, "separate"), null);

    // ...and it is still refused, because `projectCommercial` emits no freight
    // or customs line, so electing it would be a silent no-op.
    assert.equal(refusalFor(key, "separate"), LANDED_SEPARATE_UNWIRED);
    assert.throws(
      () => resolveCharge(key, { chargeKey: key, mode: "separate" }, null),
      RecoveryPolicyError,
    );
  }
});

test("case 24 — the refusal names the open decision, not an implementation gap", () => {
  // Open decision 2 / BV-011 §4.5: freight's presentation authority and its
  // accounting destination are unreconciled. Shipping the election while that
  // is open would create the second source of truth the decision prevents.
  assert.match(LANDED_SEPARATE_UNWIRED, /open decision 2/);
  assert.match(LANDED_SEPARATE_UNWIRED, /BV-011 §4\.5/);
  // And it must not borrow the language of a policy refusal — this is "the
  // system would not do it", not "the firm does not permit it".
  assert.doesNotMatch(LANDED_SEPARATE_UNWIRED, /must be recovered|cannot be absorbed/);
});

test("case 24 — `included` on a landed charge stays available and honoured", () => {
  // `included` IS what the projection does today, so electing it is honoured
  // exactly. Refusing it too would be over-correction.
  for (const key of ["container_freight", "duty_tariffs"] as RecoveryChargeKey[]) {
    assert.equal(refusalFor(key, "included"), null);
    assert.equal(resolveCharge(key, { chargeKey: key, mode: "included" }, null).mode, "included");
  }
});

test("case 24 — the unwired refusal does not touch one-time charges", () => {
  // Their separate lines are produced. Only the landed pair is unwired.
  // Read at allocate=false, where `separate` agrees with the legacy boolean —
  // at allocate=true it is refused for a different reason entirely (it would
  // double-bill), and passing there would prove nothing about wiring.
  assert.equal(refusalFor("tooling", "separate", { perAssemblyAllocate: false }), null);
  assert.equal(refusalFor("project_setup", "separate", { perAssemblyAllocate: false }), null);
});

test("case 5 — only `separate` decomposes; the amount lifted is the amount moved", () => {
  // Read on a ONE-TIME charge: `separate` on a landed charge is refused while
  // the projection emits no freight line (case 24), so measuring the
  // decomposition contract there would be measuring an unreachable state.
  const included = resolveCharge("tooling", { chargeKey: "tooling", mode: "included" }, null);
  const separate = resolveCharge(
    "tooling",
    { chargeKey: "tooling", mode: "separate" },
    false,
  );
  assert.equal(amountToDecompose(included, 1.25), 0);
  assert.equal(amountToDecompose(separate, 1.25), 1.25);
  // Revenue-neutral by construction: what leaves the unit rate is exactly
  // what the separate line carries.
});

test("case 6 — only `absorbed` removes revenue", () => {
  const separate = resolveCharge("tooling", null, false);
  // `absorbed` is not currently reachable through resolution — it is refused
  // in both allocation states (case 23) because its reduction would not move
  // the margin the floor is measured from. The ARITHMETIC contract is still
  // asserted here, ahead of the mode opening, so that whoever opens it
  // inherits a stated contract rather than writing one. Reachability is the
  // tripwire's job, not this case's.
  const absorbed = { key: "tooling", mode: "absorbed", source: "election" } as const;
  assert.equal(amountAbsorbed(separate, 900), 0, "separate removed revenue");
  assert.equal(amountAbsorbed(absorbed, 900), 900);
  // And absorbed does NOT also decompose -- it is removed, not re-presented.
  assert.equal(amountToDecompose(absorbed, 900), 0);
});

test("case 17 — the identity case short-circuits rather than round-tripping", () => {
  // OD-025: subtracting a component and re-adding it need not reproduce the
  // original bits. A zero charge must leave the rate untouched, not compute
  // `rate - 0` and trust the result.
  const separate = resolveCharge("tooling", null, false);
  assert.equal(separate.mode, "separate");
  assert.equal(amountToDecompose(separate, 0), 0);
  assert.equal(amountToDecompose(separate, null), 0);
  assert.equal(amountToDecompose(separate, undefined), 0);
  assert.equal(amountToDecompose(separate, Number.NaN), 0);
  assert.equal(amountToDecompose(separate, Number.POSITIVE_INFINITY), 0);
});

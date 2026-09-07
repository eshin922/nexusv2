/**
 * The discriminator that lets readiness tell a COMPONENT-owned OTC line from a
 * LEGACY per-column one, asserted at its source.
 *
 * ── WHY THIS TEST EXISTS ────────────────────────────────────────────────
 *
 * `projection-readiness` refuses a component charge with a message that says
 * the charge type has no governed accounting destination and that re-sending
 * will not help. It refuses a legacy line with a different message, which says
 * to revise and re-send — correct there, because that line's destination is
 * knowable and simply was not captured.
 *
 * Only one of those two instructions can succeed for a given line, and the
 * readiness check has nothing to tell them apart by except `quoteLeafId`. The
 * frozen snapshot carries no `charge_instance_id` column, so the identity the
 * projection treats as first-class does not survive the freeze; this pair of
 * fields is what does.
 *
 * That makes the discriminator load-bearing for OPERATOR INSTRUCTIONS rather
 * than for arithmetic, which is exactly the kind of coupling that rots quietly:
 * nothing would fail if a future projection started setting both fields, and
 * the only symptom would be an operator being told to perform a step that
 * cannot work. So the invariant is asserted here, at the projection, rather
 * than assumed at the reader.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { disposeDestination } from "../../src/lib/netsuite/destination-disposition.ts";

const root = process.cwd();
const src = readFileSync(
  path.join(root, "src/lib/commercial-projection.ts"),
  "utf8",
);

test("the two OTC producers set owner and leaf identity oppositely", () => {
  // The legacy per-column loop: owned by an assembly, no leaf.
  assert.match(
    src,
    /key: `otc:\$\{assemblyId\}:\$\{fee\.field\}`,\s*\n\s*kind: "otc",\s*\n\s*owningAssemblyId: assemblyId,\s*\n\s*quoteLeafId: null,/,
    "the legacy OTC line no longer sets owningAssemblyId with a null quoteLeafId",
  );

  // The component loop: owned by a leaf, no assembly.
  assert.match(
    src,
    /key: `otc:instance:\$\{chargeInstanceId\}`,\s*\n\s*kind: "otc",\s*\n\s*owningAssemblyId: null,\s*\n\s*quoteLeafId: meta\.quoteLeafId,/,
    "the component OTC line no longer sets quoteLeafId with a null owningAssemblyId",
  );
});

test("a component OTC line records its governed accounting destination", () => {
  // AMENDED 2026-09-06. This test used to pin the OPPOSITE — that a component
  // line records NO destination — and said so explicitly: "pinned so the day a
  // destination model lands, this test fails and the readiness refusal has to
  // be revisited with it."
  //
  // That day is this one. The pin did its job: it failed, and the refusal was
  // revisited with it rather than the assertion being deleted to make room.
  //
  // Decided at PROJECTION because this is the last layer that knows the charge
  // INSTANCE. A frozen line carries no instance id, so anything downstream
  // could only recover a `tooling` classification by joining back on owner and
  // type — ambiguous the moment one component owns two charges.
  const component = src.slice(src.indexOf("otc:instance:${chargeInstanceId}"));
  const block = component.slice(0, 3000);
  assert.match(block, /componentChargeDestination\(\{/);
  assert.match(block, /toolingClassification: meta\.toolingClassification/);
  assert.match(block, /bv011Destination: r\.destination/);
});

test("BOTH halves of the resolution are carried, not just the destination", () => {
  // AMENDED 2026-09-07. This used to assert
  // `r.kind === "resolved" ? r.destination : null` — which discarded WHY a
  // resolution failed at the one boundary that knew it, and left the readiness
  // gate to recover it from `displayName`. It could not: it compared a frozen
  // customer-facing name against an operator-facing label, "Tooling" against
  // "Tooling & dies", so every unclassified tooling line was told its type had
  // no governed destination and should be removed from the tier.
  //
  // The reason is now persisted beside the destination it explains, exactly as
  // `legacyUnresolved` is and for the reason its own comment gives.
  const component = src.slice(src.indexOf("otc:instance:${chargeInstanceId}"));
  const block = component.slice(0, 3000);
  assert.match(block, /destinationUnresolvedReason: null,/);
  assert.match(block, /"tooling_classification_missing" as const/);
  assert.match(block, /"component_type_ungoverned" as const/);
  // And the classification is read WITHOUT coalescing. A `?? null` here is what
  // made an absent field indistinguishable from a stated one, which is how the
  // loader's omission stayed invisible through a type check and 3016 tests.
  assert.doesNotMatch(
    block,
    /toolingClassification: meta\.toolingClassification \?\?/,
    "the classification is coalesced, which hides an absent field again",
  );
});

test("the projection derives no destination of its own", () => {
  // One authority. The projection ASKS `componentChargeDestination`; it must
  // not carry its own map, or a charge type would have two answers.
  const component = src.slice(src.indexOf("otc:instance:${chargeInstanceId}"));
  const block = component.slice(0, 2200);
  for (const shape of [/otc_print_plates/, /otc_samples/, /otc_mould/, /otc_dies/]) {
    assert.doesNotMatch(block, shape, "the destination is resolved, never named here");
  }
});

test("readiness refuses a component charge with an instruction that can succeed", () => {
  const readiness = readFileSync(
    path.join(root, "src/lib/netsuite/projection-readiness.ts"),
    "utf8",
  );
  const body = readiness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // -- THE DISPOSITION IS DECIDED ONCE, BY A PURE FUNCTION ---------------
  //
  // AMENDED 2026-09-07. This used to grep a chain of inline branches, which is
  // how the defect it was meant to guard survived: the discriminator was
  // `displayName.startsWith(COMPONENT_CHARGE_LABELS.tooling)` — a frozen
  // CUSTOMER-facing name against an OPERATOR-facing label, "Tooling" against
  // "Tooling & dies" — and it read plausibly in source while never once being
  // true. Reading source is not how that gets caught. The four eras are
  // falsified as BEHAVIOUR below.
  assert.match(body, /disposeDestination\(\{/);
  assert.match(body, /unresolvedReason: line\.unresolvedReason/);

  // -- AND COPY CANNOT REACH THE DECISION AT ALL -------------------------
  //
  // The strongest form of "a label change cannot change accounting behaviour"
  // is that no label map is in scope to be read, and no display string is
  // inspected. Asserted on the whole module, so a future edit cannot
  // reintroduce one somewhere else in it.
  assert.doesNotMatch(
    body,
    /_LABELS|displayName\.startsWith|displayName\.includes|displayName ===/,
    "readiness reads display copy to decide an accounting disposition",
  );
  // Same guarantee at the decider, which is the module that actually decides.
  const decider = readFileSync(
    path.join(root, "src/lib/netsuite/destination-disposition.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    decider,
    /displayName|_LABELS|label/i,
    "the destination decider can see a label",
  );

  // -- NEVER otc_tooling -------------------------------------------------
  //
  // It is a real destination with a real item, so a fallback would post cutting
  // dies to the mould account silently — the exact error the classification
  // exists to prevent, reintroduced as a convenience.
  assert.doesNotMatch(decider, /otc_tooling/);
});

// ══════════════════════════════════════════════════════════════════════
// The four eras, as behaviour
// ══════════════════════════════════════════════════════════════════════

test("ERA 1 · frozen before the model → revise and re-send", () => {
  // No destination and NO REASON. The resolution never ran on this line because
  // it did not exist when the line froze, and the absence of a reason is the
  // only thing that says so — which is why no backfill was written for that
  // column. Inventing a reason for a historical row would erase the signal.
  //
  // This is the era that was getting the wrong instruction. DPS-1074 v1's Print
  // plates charge has a governed destination AND a mapped item, and was still
  // told "re-sending the quote will not change that." A re-send is the entire
  // remedy.
  assert.deepEqual(
    disposeDestination({ destination: null, unresolvedReason: null, isMapped: false }),
    { kind: "destination_not_recorded" },
  );
});

test("ERA 2 · current projection, Tooling unclassified → classify on Costs", () => {
  // A fact an operator can state in one click. Distinct from era 3 because the
  // remedies are different and only one of them is theirs to perform.
  assert.deepEqual(
    disposeDestination({
      destination: null,
      unresolvedReason: "tooling_classification_missing",
      isMapped: false,
    }),
    { kind: "tooling_classification_missing" },
  );
});

test("ERA 3 · governed but unmapped → a configuration blocker, not a quote one", () => {
  // An admin adds one row in Settings and every quote posting here is
  // unblocked. Reporting this as a quote problem would send an operator to
  // change a quote that is already correct.
  assert.deepEqual(
    disposeDestination({
      destination: "otc_mould",
      unresolvedReason: null,
      isMapped: false,
    }),
    { kind: "unmapped_destination", destination: "otc_mould" },
  );
});

test("ERA 4 · governed and mapped → readiness clears", () => {
  for (const d of ["otc_mould", "otc_dies", "otc_print_plates", "otc_samples"] as const) {
    assert.deepEqual(
      disposeDestination({ destination: d, unresolvedReason: null, isMapped: true }),
      { kind: "ready", destination: d },
    );
  }
});

test("a resolved destination clears REGARDLESS of what produced the line", () => {
  // The narrowing that matters: a component-owned charge WITH a destination is
  // not a special case. It posts like any other line. The branch used to refuse
  // every component charge outright, which is why O3 could not reach the ERP at
  // all — and a reason left over from an earlier state must not re-refuse a
  // line that has since resolved.
  assert.deepEqual(
    disposeDestination({
      destination: "otc_mould",
      unresolvedReason: "tooling_classification_missing",
      isMapped: true,
    }),
    { kind: "ready", destination: "otc_mould" },
  );
});

test("the four nulls stay four, and no two collapse", () => {
  // The whole job of this function. If any two of these compared equal, an
  // operator would be sent to the wrong screen for one of them.
  const outcomes = [
    disposeDestination({ destination: null, unresolvedReason: null, isMapped: false }).kind,
    disposeDestination({
      destination: null,
      unresolvedReason: "tooling_classification_missing",
      isMapped: false,
    }).kind,
    disposeDestination({
      destination: null,
      unresolvedReason: "component_type_ungoverned",
      isMapped: false,
    }).kind,
    disposeDestination({ destination: "otc_mould", unresolvedReason: null, isMapped: false }).kind,
  ];
  assert.equal(new Set(outcomes).size, outcomes.length, "two null states produce one answer");
});

test("every disposition the decider can produce is handled by readiness", () => {
  // A state with no branch is a line that falls through and emits anyway — the
  // short order that reconciles to its own short sum, which is the specific
  // failure REG-4 exists to catch and the hardest to notice.
  const readiness = readFileSync(
    path.join(root, "src/lib/netsuite/projection-readiness.ts"),
    "utf8",
  );
  const decider = readFileSync(
    path.join(root, "src/lib/netsuite/destination-disposition.ts"),
    "utf8",
  );
  const kinds = [...decider.matchAll(/kind: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 5, "the decider's states could not be enumerated");
  for (const k of new Set(kinds)) {
    if (k === "ready") continue; // the success path; it emits rather than blocks
    assert.ok(
      readiness.includes(`"${k}"`),
      `readiness has no branch for the disposition ${k}`,
    );
  }
});

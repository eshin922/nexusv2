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
  const block = component.slice(0, 2200);
  assert.match(block, /bv011Destination: \(\(\) => \{/);
  assert.match(block, /componentChargeDestination\(\{/);
  assert.match(block, /toolingClassification: meta\.toolingClassification/);
  // Unresolved still means null — the readiness gate decides what that means,
  // and it distinguishes "an operator can state this" from "nothing governs it".
  assert.match(block, /r\.kind === "resolved" \? r\.destination : null/);
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

  // The discriminator is used, and used before the generic null test — which
  // would otherwise claim the line first and hand out the wrong remedy.
  //
  // Measured inside the RESOLUTION LOOP, not across the file: both kinds are
  // named in the blocker union far above, and comparing declaration order
  // there would compare the wrong thing entirely while looking like it worked.
  const loopAt = readiness.indexOf("for (const line of lines) {");
  assert.ok(loopAt > 0, "the resolution loop was not found — this test is blind");
  const body = readiness.slice(loopAt);
  const componentAt = body.indexOf("tooling_classification_missing");
  const genericAt = body.indexOf('kind: "destination_not_recorded"');
  assert.ok(componentAt > 0, "the component blockers are absent");
  assert.ok(
    componentAt < genericAt,
    "the generic null-destination blocker would claim component lines first",
  );

  const branch = body.slice(componentAt, genericAt);

  // ── THE REFUSAL NARROWED ─────────────────────────────────────────────
  //
  // It used to refuse EVERY component charge. Now it refuses only one with no
  // destination, so a governed charge falls through and posts like any line.
  assert.match(body, /line\.quoteLeafId !== null && destination === null/);

  // ── AND SPLIT, BECAUSE THEY ARE DIFFERENT PROBLEMS ───────────────────
  //
  // An unclassified Tooling charge is a fact an operator can state; a type with
  // no governed destination is a gap they cannot close from the quote. One kind
  // with one message sends half of them to a screen that cannot help.
  assert.match(branch, /is billed as its own line, so it needs an accounting classification/);
  assert.match(branch, /re-sending the quote will not change that/);

  // Neither reuses the generic remedy, which cannot work for either.
  assert.doesNotMatch(
    branch,
    /Revise and re-send so the line records its destination/,
    "a component refusal reuses the remedy that cannot work for it",
  );

  // ── NEVER otc_tooling ────────────────────────────────────────────────
  //
  // It is a real destination with a real item, so a fallback would post cutting
  // dies to the mould account silently — the exact error the classification
  // exists to prevent, reintroduced as a convenience.
  assert.doesNotMatch(branch, /otc_tooling/);
});

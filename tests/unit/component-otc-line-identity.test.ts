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

test("a component OTC line records no accounting destination", () => {
  // Not an omission — there is no governed `charge_key -> destination` map at
  // all, and `otc_dies` / `otc_print_plates` / `otc_samples` are assigned by
  // nothing anywhere. Pinned so the day a destination model lands, this test
  // fails and the readiness refusal has to be revisited with it.
  const component = src.slice(src.indexOf("otc:instance:${chargeInstanceId}"));
  assert.match(
    component.slice(0, 900),
    /bv011Destination: null,\s*\n\s*legacyUnresolved: false,/,
    "a component charge acquired a destination without the destination model",
  );
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
  const componentAt = body.indexOf("component_destination_ungoverned");
  const genericAt = body.indexOf('kind: "destination_not_recorded"');
  assert.ok(componentAt > 0, "the component blocker is absent");
  assert.ok(
    componentAt < genericAt,
    "the generic null-destination blocker would claim component lines first",
  );

  // And the message must not tell the operator to re-send, because a re-send
  // records `null` again. This is the specific defect: an instruction that
  // reads as a step they failed to perform.
  const branch = body.slice(componentAt, genericAt);
  assert.doesNotMatch(
    branch,
    /Revise and re-send so the line records its destination/,
    "the component refusal reuses the remedy that cannot work for it",
  );
  assert.match(branch, /re-sending the quote will not change that/);
});

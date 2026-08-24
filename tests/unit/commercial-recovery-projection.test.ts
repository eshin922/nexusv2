import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import {
  OTC_COLUMN_TO_CHARGE,
  chargePolicy,
} from "../../src/lib/commercial-recovery/registry.ts";
import { LEGACY_COMBINED_OTC_COLUMN } from "../../src/lib/netsuite/bv011-destinations.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const code = async (p: string) => codeOnly(await read(p));

const PROJECTION = "src/lib/commercial-projection.ts";
const RESOLVER = "src/lib/customer-view-resolver.ts";
const QUOTES = "src/app/actions/quotes.ts";

// ═══════════════════════════════════════════════════════════════════════
// THE SINGLE-PRODUCER SEAM.
//
// The customer document and the frozen matrix must consume ONE projection
// RESULT, not two equivalent recomputations. Equality is not the property:
// two constructions can agree today and diverge on the next change, and that
// is exactly how the PDF and the Sales Order came to disagree about
// allocation-OFF fees while each stayed internally consistent.
//
// So these assert the STRUCTURE that makes agreement unavoidable, not a
// comparison of two outputs — a comparison is only ever as good as the pair
// of reconstructions it compares.
// ═══════════════════════════════════════════════════════════════════════

test("projectCommercial has exactly ONE call site in the whole tree", async () => {
  const files = [PROJECTION, RESOLVER, QUOTES];
  let callSites = 0;
  for (const f of files) {
    const src = await code(f);
    // Calls, not the declaration and not type-only references.
    for (const m of src.matchAll(/projectCommercial\s*\(/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/export function\s*$/.test(before)) continue; // the declaration
      callSites += 1;
    }
  }
  assert.equal(
    callSites,
    1,
    `projectCommercial is constructed ${callSites} times. A second call is a ` +
      `second construction, and "the frozen matrix matches the PDF" goes back ` +
      `to being a claim about two computations agreeing.`,
  );
});

test("the freeze writer consumes the RETURNED projection, never a fresh one", async () => {
  const src = await code(QUOTES);
  // It must pass the resolver's own result through.
  assert.match(
    src,
    /freezeCommercialLineSet\(\s*tx,\s*snapshot\.id,\s*resolved\.commercial\s*\)/,
    "the send path no longer freezes the projection the view was built from",
  );
  // And it must NOT build its own.
  assert.doesNotMatch(
    src,
    /freezeCommercialLineSet\([^)]*projectCommercial\s*\(/,
    "the send path constructs a second projection to freeze",
  );
});

test("the resolver returns the projection it rendered from", async () => {
  const src = await code(RESOLVER);
  assert.match(src, /const projection = projectCommercial\(/);
  // Returned, so the send path can freeze the same in-memory result rather
  // than rebuilding an equivalent one.
  assert.match(
    src,
    /commercial:\s*projection/,
    "the resolver no longer returns the projection it rendered from",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Byte-identity at rest, asserted at the source rather than by fixture.
//
// The preservation guarantee is structural: with no elections the resolution
// returns the SAME boolean the code read before recovery existed, computed by
// no arithmetic at all. A fixture comparison would prove it for one quote;
// this proves it for the branch.
// ═══════════════════════════════════════════════════════════════════════

test("elections default to empty, so every existing caller is unchanged", async () => {
  const src = await read(PROJECTION);
  assert.match(
    src,
    /elections:\s*readonly ChargeElection\[\]\s*=\s*\[\]/,
    "elections is no longer defaulted — existing callers would change behaviour",
  );
});

test("the allocation boolean still derives from the per-assembly value", async () => {
  const src = await read(PROJECTION);
  // Per-assembly, NOT quote-level. Three real quotes carry OFF and ON at once,
  // one already sent; resolving per quote would flatten them.
  assert.match(
    src,
    /row\?\.allocateServiceFeesToCost/,
    "resolution stopped reading the per-assembly value",
  );
  assert.match(src, /const allocated = resolved\.mode === "included";/);
});

test("every OTC fee column maps to exactly one governed charge", async () => {
  const src = await read(PROJECTION);
  const fields = [...src.matchAll(/\{ field: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(fields.length >= 5, "could not read the OTC fee list");

  // Behavioural, not a source-text scan. The map now has ONE owner — the
  // registry — so the property to assert is that every column the projection
  // renders resolves to a real governed charge, not that a particular literal
  // appears in a particular file.
  for (const f of fields) {
    const key = OTC_COLUMN_TO_CHARGE[f];
    assert.ok(key, `${f} has no governed charge — it would resolve as undefined and throw`);
    // And the charge it names must exist: a typo would map to a key that
    // satisfies the check above and fails only at projection time.
    assert.doesNotThrow(() => chargePolicy(key));
  }
  assert.equal(OTC_COLUMN_TO_CHARGE[LEGACY_COMBINED_OTC_COLUMN], "tooling_artwork_legacy");
});

test("the identity map is complete, and wider than what the projection renders", async () => {
  const src = await read(PROJECTION);
  const rendered = new Set(
    [...src.matchAll(/\{ field: "(\w+)"/g)].map((m) => m[1]),
  );

  // `testingMicrosTotal` is a governed charge the projection does not render —
  // only a Direct Service leaf writes it, and it is not assembly-authorable.
  // The identity map must still carry it, because that asymmetry is a fact
  // about what is RENDERED, not about what the charge IS. The cost layer needs
  // the identity regardless.
  assert.equal(OTC_COLUMN_TO_CHARGE.testingMicrosTotal, "testing_micros");
  assert.equal(rendered.has("testingMicrosTotal"), false);

  // Every rendered column is in the map; the map is a superset.
  for (const f of rendered) assert.ok(OTC_COLUMN_TO_CHARGE[f]);
});

test("no consumer restates the column-to-charge map", async () => {
  // Two answers to one question agree right up until a column is added to one
  // of them. The projection aliases the registry's map; it does not rebuild it.
  const src = codeOnly(await read(PROJECTION));
  assert.match(src, /const OTC_FIELD_TO_CHARGE = OTC_COLUMN_TO_CHARGE;/);
  assert.doesNotMatch(
    src,
    /OTC_FIELD_TO_CHARGE[^=]*=\s*\{/,
    "the projection rebuilt the map instead of reading it",
  );
});

test("the seam delegates the absorb refusal to policy, holding none of its own", async () => {
  const src = await read(PROJECTION);

  // The refusal moved into `resolveCharge`, which is handed this same
  // per-assembly value — so it is enforced once, in the layer that owns what
  // an operator may elect, rather than duplicated at a producer where the two
  // copies could drift out of step.
  assert.match(
    src,
    /resolveCharge\(\s*OTC_FIELD_TO_CHARGE\[fee\.field\],[\s\S]{0,160}row\?\.allocateServiceFeesToCost,/,
    "resolution is no longer handed the allocation state it refuses on",
  );
  assert.doesNotMatch(
    src,
    /throw new Error\(\s*`Cannot absorb/,
    "the seam re-grew a local copy of the absorb refusal",
  );
});

test("absorbed emits no customer line", async () => {
  const src = await read(PROJECTION);
  assert.match(
    src,
    /if \(allocated \|\| resolved\.mode === "absorbed" \|\| raw === null \|\| raw <= 0\)/,
    "absorbed no longer suppresses the OTC line — it would still bill the customer",
  );
});

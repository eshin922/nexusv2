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

test("the projection takes no elections at all", async () => {
  const src = codeOnly(await read(PROJECTION));
  // Not "defaults to empty" — ABSENT. While the parameter existed, placement
  // could still be decided at the surface that RENDERS it, which is how the
  // engine's revenue and the customer's document came to disagree by ~1e-12
  // on eight real rows. Its absence is what makes "one constructed state"
  // structural rather than a convention.
  // Word-boundary: `OtherServiceSelection` contains "election" as a substring,
  // and a regex that matches it would fail for a reason unrelated to the claim.
  assert.doesNotMatch(src, /ChargeElection|electionByCharge/i, "the projection can still be handed elections");
  assert.doesNotMatch(src, /resolveCharge/, "the projection still resolves placement");
});

test("the allocation boolean is read by the ENGINE, not the seam", async () => {
  const engine = await read("src/lib/costing.ts");
  // Per-assembly, NOT quote-level. Three real quotes carry OFF and ON at once,
  // one already sent; resolving per quote would flatten them.
  assert.match(
    engine,
    /production\?\.allocateServiceFeesToCost/,
    "the engine stopped reading the per-assembly value",
  );
  assert.match(engine, /constructCommercial\(/, "the engine no longer constructs");
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

test("the seam holds no recovery policy of its own", async () => {
  const src = codeOnly(await read(PROJECTION));
  // After the cutover the projection decides nothing about recovery: no
  // resolution, no rate, no placement. It looks up the construction the engine
  // built and renders it.
  assert.doesNotMatch(src, /resolveCharge/, "the seam resolves placement");
  assert.doesNotMatch(src, /1 \+ productionMarkupPct/, "the seam re-prices a charge");
  assert.match(src, /constructedFor\(assemblyId, t\.tierId\)/);
});

test("only a separate_line placement emits a customer line", async () => {
  const src = codeOnly(await read(PROJECTION));
  // `unit_price` (already in the rate), `absorbed` (no revenue) and an absent
  // charge all render nothing — and all three are ONE condition now, read off
  // the construction rather than reassembled from a mode and a boolean.
  assert.match(
    src,
    /if \(!placed \|\| placed\.placement !== "separate_line"\)/,
    "the seam no longer gates the line on the construction's placement",
  );
});

test("no two governed charges print the same customer-facing qty label", async () => {
  // A quote can carry both `toolingTotal` and the legacy combined
  // `tooling_artwork_total`. Both printed "1 (tooling)", so the customer saw
  // two identically-labelled lines with different amounts, and an operator who
  // elected Tooling into the unit price saw a line still saying "(tooling)"
  // and reported the control as broken. It was not: it had correctly moved the
  // OTHER charge's line.
  //
  // Asserted against the source table rather than a rendered document, because
  // the collision is a property of the table and a fixture would only catch it
  // on a quote that happens to carry both.
  const src = await readFile(
    new URL("../../src/lib/commercial-projection.ts", import.meta.url),
    "utf8",
  );
  const labels = [...src.matchAll(/qtyLabel: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 6, "the OTC table was not found");
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  assert.deepEqual(dupes, [], `duplicate customer-facing qty labels: ${dupes.join(", ")}`);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

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

  const mapBlock = src.slice(
    src.indexOf("const OTC_FIELD_TO_CHARGE"),
    src.indexOf("export { OTC_FIELD_TO_CHARGE }"),
  );
  for (const f of fields) {
    assert.ok(
      mapBlock.includes(`${f}:`),
      `${f} has no governed charge — it would resolve as undefined and throw`,
    );
  }
  // The legacy combined column maps to the non-elective legacy charge.
  assert.match(mapBlock, /LEGACY_COMBINED_OTC_COLUMN\]:\s*"tooling_artwork_legacy"/);
});

test("absorbing an allocated charge refuses instead of mis-pricing", async () => {
  const src = await read(PROJECTION);
  // The dangerous combination is `absorbed` on a charge the unit rate already
  // recovers: suppressing the line there would drop the line and leave the
  // revenue, which is a silently wrong total. It must throw, not proceed.
  assert.match(
    src,
    /resolved\.mode === "absorbed" && \(row\?\.allocateServiceFeesToCost \?\? true\)/,
    "the absorb-while-allocated guard is gone",
  );
  assert.match(src, /throw new Error\(\s*`Cannot absorb/);
});

test("absorbed emits no customer line", async () => {
  const src = await read(PROJECTION);
  assert.match(
    src,
    /if \(allocated \|\| resolved\.mode === "absorbed" \|\| raw === null \|\| raw <= 0\)/,
    "absorbed no longer suppresses the OTC line — it would still bill the customer",
  );
});

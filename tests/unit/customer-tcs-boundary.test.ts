import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * Customer Terms & Conditions must reach the customer.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * `CustomerView.tcs` has always been resolved — Admin Settings
 * (`firm_settings.tcs_default`) on a draft, the quote's own `tcs_snapshot`
 * once sent. `customer-view-to-cpdf` dropped it, `CpdfDoc` had no field for
 * it, and the PDF Terms block never rendered it.
 *
 * So the firm could configure a clause, see it stored, and the customer's
 * artifact of record would never print it. Nothing failed, nothing warned;
 * the field simply stopped at an adapter.
 *
 * It surfaced only because a SECOND renderer was built from the same
 * projection and rendered a field the first one ignored. A divergence between
 * two consumers made visible a gap that one consumer alone could hide — which
 * is an argument for the two-renderer architecture, not against it.
 */

test("T&Cs survive the adapter boundary", async () => {
  const adapter = await read("src/lib/customer-view-to-cpdf.ts");
  const types = await read("src/components/pdf/customer-pdf-types.ts");

  assert.match(adapter, /tcs: view\.quote\.tcs/, "the adapter must carry T&Cs");
  assert.match(types, /tcs: string \| null;/, "CpdfDoc must have somewhere to put them");

  // NULL must pass through as null. `?? ""` would render an empty Terms
  // heading over nothing, which tells the customer a clause exists and then
  // declines to state it.
  assert.doesNotMatch(
    adapter,
    /tcs: view\.quote\.tcs \?\? ""/,
    "null means unconfigured, not empty",
  );
});

test("the customer PDF renders T&Cs, and omits them only when unconfigured", async () => {
  const block = await read("src/components/pdf/customer-pdf-terms-block.tsx");
  const doc = await read("src/components/pdf/customer-pdf-document.tsx");

  assert.match(block, /export function TcsBlock/);
  assert.match(doc, /<TcsBlock tcs=\{quote\.tcs\}/, "the document must compose it");

  // Absent when unconfigured — no heading, no placeholder.
  assert.match(block, /if \(tcs == null \|\| tcs\.length === 0\) return null;/);
});

test("both renderers read the same T&Cs field", async () => {
  // Parity is not two renderers agreeing by coincidence; it is both reading
  // one already-resolved fact.
  const live = await read("src/components/quote/customer-view-live.tsx");
  const doc = await read("src/components/pdf/customer-pdf-document.tsx");
  assert.match(live, /quote\.tcs/, "the live renderer reads the projection's T&Cs");
  assert.match(doc, /quote\.tcs/, "so does the PDF");
});

test("a sent quote's T&Cs are frozen, not re-read from Admin Settings", async () => {
  // Otherwise a later edit to the firm default would restate a quote the
  // customer already holds. The resolver picks the snapshot once sent, and
  // sendQuote writes it at send.
  const resolver = await read("src/lib/customer-view-resolver.ts");
  assert.match(
    resolver,
    /const tcs = isSent \? quote\.tcsSnapshot : \(firm\?\.tcsDefault \?\? null\)/,
    "draft reads the firm default; sent reads its own snapshot",
  );
  const actions = await read("src/app/actions/quotes.ts");
  assert.match(actions, /tcsSnapshot: firm\.tcsDefault \?\? null/, "send freezes it");
});

test("the pending stub cannot suppress configured T&Cs", async () => {
  // `{tcs-pending — configure on /admin/firm-settings}` exists in QUOTE_STUBS.
  // Its legitimate case is a genuinely unconfigured firm setting, and it must
  // never stand in front of a real value.
  //
  // Verified by absence of use: QUOTE_STUBS is referenced nowhere outside its
  // own module, so the resolver returns the configured value or null and the
  // stub cannot intercept either. If a consumer ever adopts it, this fails and
  // the constraint has to be re-argued rather than assumed.
  const fixtures = await read("src/lib/quote-fixtures.ts");
  assert.match(fixtures, /tcs: "\{tcs-pending/, "the stub still exists as documentation");

  const resolver = await read("src/lib/customer-view-resolver.ts");
  assert.doesNotMatch(resolver, /QUOTE_STUBS/, "the resolver must not substitute a stub for T&Cs");
});

test("both documents label T&Cs, not just carry them", async () => {
  // Parity finding 3. Both renderers printed the T&Cs BODY; only the PDF put
  // it under a heading, so the same clause carried different labels in the two
  // documents and the customer reading the HTML would take it as a
  // continuation of the notes above.
  //
  // It also exposed a reporting error worth keeping: the first parity report
  // claimed "T&Cs present in both" on the strength of a regex matching /terms/,
  // which matches "Payment terms". An instrument that cannot tell the heading
  // it is looking for from unrelated text will report the answer you expect.
  const live = await read("src/components/quote/customer-view-live.tsx");
  const block = await read("src/components/pdf/customer-pdf-terms-block.tsx");
  // Asserted on the EXACT section heading, never a generic /terms/ pattern.
  // The broad pattern is what produced the false green: it matches "Payment
  // terms" in the terms grid, which sits three lines above the clause it was
  // supposed to be finding. A pattern that matches the neighbourhood of the
  // thing is not a pattern for the thing.
  // Asserted on the heading TEXT, not on the class that carries it. The class
  // changed once already (Gate B moved the heading onto the canonical `.label`
  // register), and a test pinned to the class would have failed for a styling
  // change while a test pinned to `/terms/` would have passed for a missing
  // heading. The text is the thing under contract.
  assert.match(live, /<div className="label">Terms &amp; conditions<\/div>/);
  assert.match(block, /\{"Terms & conditions"\.toUpperCase\(\)\}/);

  // And the broad pattern must not be what either assertion rests on. If a
  // future edit loosens these back to /terms/, this fails.
  for (const [name, src] of [["live", live], ["pdf", block]] as const) {
    const headingCount = (src.match(/Terms &(amp;)? conditions/g) ?? []).length;
    assert.ok(headingCount >= 1, `${name} must carry the exact heading text`);
  }
});

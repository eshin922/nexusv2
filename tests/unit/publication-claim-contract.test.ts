import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildSnapshotRepresentation } from "../../src/lib/quote-snapshot-representation.ts";
import type { CustomerView } from "../../src/types/quote.ts";

// ═══════════════════════════════════════════════════════════════════════
// PUBLICATION OWNERSHIP AND THE NUMBER ON THE DOCUMENT.
//
// DPS-1072 was frozen with `cpdf_data.quote.quote_number = ""` while
// `quotes.quote_number` and `quote_snapshots.quote_number` both read
// DPS-1072. The number was minted by `nextval` inside the send transaction,
// 54 lines AFTER `renderToBuffer` — so every finalized document was rendered
// before its own number existed, and the model could not say so because
// `CpdfQuote.quote_number` was typed `string` and absence was coerced to `""`.
//
// Nothing failed. The e2e send test asserts the DB columns agree with each
// other and never opens the document, which is why this shipped.
//
// The ORDERING and OWNERSHIP proofs are here as source contracts; the
// CONCURRENCY proofs need two real connections racing for a real row lock and
// live in `scripts/gate-1b/publication-claim-concurrency.ts`, which exercises
// the shipped statements against PostgreSQL rather than against a mock.
// ═══════════════════════════════════════════════════════════════════════

const SEND = () => readFile("src/app/actions/quotes.ts", "utf8");
const CLAIM = () => readFile("src/lib/publication-claim.ts", "utf8");

function sendQuoteBody(src: string): string {
  const start = src.indexOf("export async function sendQuote");
  assert.ok(start > 0, "sendQuote must be findable");
  const end = src.indexOf("export async function", start + 1);
  return src.slice(start, end);
}

// ── ORDER ────────────────────────────────────────────────────────────────

test("the number is claimed BEFORE the artifact is rendered", async () => {
  const body = sendQuoteBody(await SEND());
  const claim = body.indexOf("await claimPublication(");
  const render = body.indexOf("renderToBuffer(");
  const upload = body.indexOf("artifacts.put(");

  assert.ok(claim > 0, "sendQuote must claim publication");
  assert.ok(render > claim, "the render must happen after the number exists");
  assert.ok(upload > render, "upload still follows the render");
});

test("render and upload still happen BEFORE the transaction", async () => {
  // Unchanged rule, asserted so the repair cannot be read as having moved it:
  // a rejected send must leave no external artifact.
  const body = sendQuoteBody(await SEND());
  const render = body.indexOf("renderToBuffer(");
  const tx = body.indexOf("result = await db.transaction(");
  assert.ok(render > 0 && tx > render, "the transaction opens after the upload");
});

test("the transaction allocates nothing", async () => {
  const body = sendQuoteBody(await SEND());
  const tx = body.slice(body.indexOf("result = await db.transaction("));
  assert.doesNotMatch(
    tx,
    /nextval\(/,
    "a second nextval inside the transaction would mint a number the rendered artifact does not carry",
  );
});

test("nextval is reachable from exactly one place", async () => {
  const send = await SEND();
  const claim = await CLAIM();
  assert.doesNotMatch(send, /nextval\('quote_number_seq'\)/);
  assert.equal(
    claim.match(/nextval\('quote_number_seq'\)/g)?.length,
    1,
    "allocation lives in the claim statement and nowhere else",
  );
});

// ── OWNERSHIP ────────────────────────────────────────────────────────────

test("the claim elects one owner and allocates in ONE statement", async () => {
  const src = await CLAIM();
  const stmt = src.slice(src.indexOf("UPDATE ${quotes}"), src.indexOf("RETURNING quote_number"));

  // Allocation and election are the same decision. Splitting them leaves a
  // window where a number exists with no owner, reachable by the second caller.
  assert.match(stmt, /COALESCE\(/, "reuse an existing number rather than mint a second");
  assert.match(stmt, /nextval\('quote_number_seq'\)/);
  assert.match(stmt, /publication_claim_token = /);
  assert.match(stmt, /publication_claimed_at = now\(\)/);

  // The predicate that makes a live publisher un-overtakeable.
  assert.match(stmt, /status\} = 'draft'/);
  assert.match(stmt, /publicationClaimToken\} IS NULL/);
  assert.match(stmt, /make_interval\(secs => /);
});

test("release is scoped to the releaser's own token", async () => {
  const src = await CLAIM();
  const body = src.slice(src.indexOf("export async function releasePublicationClaim"));
  // The whole point: a publisher that fails slowly can reach its release AFTER
  // a newer publisher has legitimately claimed the quote. Unscoped, it would
  // clear the live claim.
  assert.match(body, /eq\(quotes\.publicationClaimToken, args\.token\)/);
});

test("every failure after the claim releases it", async () => {
  const body = sendQuoteBody(await SEND());
  const claim = body.indexOf("await claimPublication(");
  const cat = body.indexOf("} catch (error) {", claim);
  const release = body.indexOf("releasePublicationClaim(", cat);
  assert.ok(cat > claim, "the work after the claim is guarded");
  assert.ok(release > cat, "the guard releases the claim");
  assert.match(
    body.slice(cat),
    /releasePublicationClaim\(db, \{ quoteId, token: claim\.token \}\)/,
    "released with THIS caller's token",
  );
  assert.match(body.slice(cat), /throw error;/, "and the original error still surfaces");
});

test("success clears the claim in the same statement that publishes", async () => {
  const body = sendQuoteBody(await SEND());
  const set = body.indexOf('publicationClaimToken: null');
  const sent = body.indexOf('status: "sent"', set);
  assert.ok(set > 0 && sent > set && sent - set < 400,
    "the claim is cleared by the UPDATE that sets status, so a rollback restores both");
});

test("a numbered draft is not a published quote", async () => {
  // `quote_number != NULL` must never be read as lifecycle completion. A failed
  // publication deliberately leaves the number in place so the retry reuses it.
  const schema = await readFile("src/db/schema.ts", "utf8");
  assert.match(
    schema,
    /Transient publication ownership\. NOT lifecycle state\./,
    "the columns must say what they are not",
  );
  const resolver = await readFile("src/lib/customer-view-resolver.ts", "utf8");
  assert.match(
    resolver,
    /const quoteNumber = isSent \? quote\.quoteNumber : null;/,
    "the customer document gates the number on being SENT, not on the column",
  );
});

// ── THE NUMBER REACHES THE ARTIFACT ──────────────────────────────────────

test("the model can represent a number that publication has not governed", async () => {
  const types = await readFile("src/components/pdf/customer-pdf-types.ts", "utf8");
  assert.match(types, /quote_number: string \| null;/);

  const adapter = await readFile("src/lib/customer-view-to-cpdf.ts", "utf8");
  assert.doesNotMatch(
    adapter,
    /quote_number: view\.quote\.quoteNumber \?\? ""/,
    "absence must not be coerced to an empty string",
  );
});

test("absence is rendered as absence, not as a blank", async () => {
  const masthead = await readFile("src/components/pdf/customer-pdf-masthead.tsx", "utf8");
  assert.match(
    masthead,
    /quote\.quote_number !== null && quote\.quote_number\.length > 0 && \(/,
    "the masthead line is omitted rather than emptied",
  );
});

test("the governed number is carried into the frozen representation", async () => {
  // FUNCTIONAL, not a grep: this is the artifact's data of record, and it is
  // exactly what `quote_snapshot_artifacts.cpdf_data` stores. DPS-1072's says
  // "".
  const view = (): CustomerView =>
    ({
      vendor: { name: "V", sub: "", address: "" },
      customer: { name: "C", contact: null, role: null, email: null, address: null },
      quote: {
        quoteNumber: null, projectTitle: null, sentDate: null, validUntil: null,
        paymentTerms: null, leadTime: null, customerFacingNotes: null,
        incoterms: null, tcs: null,
      },
      preparedBy: null,
      tiers: [],
      skus: [],
      serviceFees: [],
      freightLines: [],
      recommendedTierIdx: null,
      feeBasisTierIdx: null,
      foldFeesIntoTotal: true,
      pdfLayout: "tier_table",
      detailLevel: "itemized",
      includeSpecAddendum: false,
      includeFeeLines: true,
      includeTerms: true,
    }) as unknown as CustomerView;

  const published = buildSnapshotRepresentation({
    view: view(),
    addendumData: null,
    structure: [],
    todayIso: "2026-08-31",
    quoteNumber: "DPS-1073",
  });
  assert.equal(
    published.cpdfData.quote.quote_number,
    "DPS-1073",
    "the frozen artifact must carry the number persisted beside it",
  );

  // And a preview, which correctly has none, says so as null rather than "".
  const preview = buildSnapshotRepresentation({
    view: view(),
    addendumData: null,
    structure: [],
    todayIso: "2026-08-31",
  });
  assert.equal(preview.cpdfData.quote.quote_number, null);
});

test("the send passes the claimed number into the representation", async () => {
  const body = sendQuoteBody(await SEND());
  const build = body.indexOf("buildSnapshotRepresentation({");
  const block = body.slice(build, body.indexOf("});", build));
  assert.match(block, /quoteNumber,/, "the representation is built with the governed number");
  assert.ok(
    body.indexOf("const quoteNumber = claim.quoteNumber;") < build,
    "and that number came from the claim",
  );
});

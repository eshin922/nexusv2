import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The `presentation_profile` table's source, sliced on its export declarations.
 *
 * Sliced this way because the first attempt matched on `pgTable(
  "..."` and
 * the file has CRLF line endings, so both indexOf calls returned -1 and
 * `slice(-1, -1)` produced "". The absence tests below then passed against an
 * empty string — a green result from a slice that had found nothing, which is
 * the failure mode these tests exist to catch, reproduced inside them.
 *
 * So the markers are asserted before the slice is used. An unfound marker now
 * fails loudly instead of certifying emptiness.
 */
function profileTableSource(schema: string): string {
  const start = schema.indexOf("export const presentationProfile = pgTable");
  const end = schema.indexOf("export const presentationProfileTier = pgTable");
  assert.ok(start >= 0, "presentationProfile declaration not found in schema.ts");
  assert.ok(end > start, "presentationProfileTier declaration not found after it");
  const src = schema.slice(start, end);
  assert.ok(src.includes("quote_version"), "the slice does not look like the table");
  return src;
}

/**
 * G4 · the presentation profile, and the customer note's freeze.
 *
 * These assert the CONTRACTS the disposition settled, not the wiring. Each one
 * pins a decision that was argued and could otherwise be quietly undone by a
 * later edit that looks locally reasonable.
 */

test("there is exactly one owner of the customer note", async () => {
  // ── M1 ──────────────────────────────────────────────────────────────────
  //
  // The disposition's §3 record listed `customer_note text? max 400`. The §0.5
  // pass caught it before any DDL: `quotes.customer_facing_notes` already
  // existed, was already authored on Setup, and already printed verbatim above
  // How to accept. A second column would have given one printed sentence two
  // owners and two authoring surfaces, with nothing in the schema saying which
  // one the customer receives.
  //
  // Edward's disposition: no second column. `include_note` decides whether the
  // note PRINTS; it never decides what it says.
  const schema = codeOnly(await read("src/db/schema.ts"));
  const profile = profileTableSource(schema);
  for (const forbidden of ["customer_note", "customerNote", "note_text"]) {
    assert.ok(
      !profile.includes(forbidden),
      `presentation_profile must not carry ${forbidden} — the note's content is a quote fact`,
    );
  }
  // And it DOES carry the presentation half.
  assert.ok(profile.includes("include_note"), "include_note is the presentation fact");
});

test("the profile carries no recommendation", async () => {
  // Same split, the other instance: the recommended tier is a quote fact with
  // its own column and its own audit action. Card 2 edits it there.
  const schema = codeOnly(await read("src/db/schema.ts"));
  const profile = profileTableSource(schema);
  for (const forbidden of ["recommended", "featured_tier", "featuredTier"]) {
    assert.ok(
      !profile.includes(forbidden),
      `presentation_profile must not carry ${forbidden} — quote_tiers.recommended owns it`,
    );
  }
});

test("the profile reuses the existing enums rather than minting new ones", async () => {
  // `pdf_layout` and `detail_level` already exist and are already used by
  // quotes.*_snapshot and quote_snapshots. A parallel `presentation_layout`
  // would be one vocabulary with two spellings — the divergence this whole
  // record exists to prevent, one level down.
  const migration = await read("drizzle/0102_presentation_profile.sql");
  assert.match(migration, /"layout" "pdf_layout"/);
  assert.match(migration, /"detail_level" "detail_level"/);
  assert.doesNotMatch(
    migration,
    /CREATE TYPE/i,
    "0102 must not mint an enum; the vocabulary already exists",
  );
});

test("a revision inherits the profile, and never writes through to the old one", async () => {
  // ── C2 ──────────────────────────────────────────────────────────────────
  //
  // The profile is keyed per version and `reviseQuote` bumps the version on the
  // SAME quotes row. Without a carry-forward the new version has no profile,
  // the surface falls back to defaults, and an operator revising a sent quote
  // silently loses every presentation choice the customer has already seen.
  const actions = codeOnly(await read("src/app/actions/quotes.ts"));
  const revise = actions.slice(actions.indexOf("export async function reviseQuote"));

  assert.match(revise, /presentationProfile/, "reviseQuote must carry the profile forward");
  assert.match(revise, /presentationProfileTier/, "per-tier visibility travels with it");

  // Inside the transaction: a revision either gets its profile or does not
  // happen. `tx.insert` rather than `db.insert` is the whole difference.
  assert.match(
    revise,
    /tx\s*\n?\s*\.insert\(presentationProfile\)/,
    "the carry-forward must be inside the revision transaction",
  );

  // The copy reads priorVersion and writes newVersion. If it ever wrote
  // priorVersion it would be editing the record the customer already saw,
  // which is the failure the carry-forward exists to prevent.
  const copyBlock = revise.slice(
    revise.indexOf("priorProfile"),
    revise.indexOf("// Audit"),
  );
  // Asserted as an ABSENCE, because presence is too weak here. The block
  // contains two inserts — the profile and the per-tier rows — so
  // `match(/quoteVersion: newVersion/)` still passes when ONE of them has been
  // switched to priorVersion. Falsifying it caught exactly that: the profile
  // insert was pointed at the old version and the test stayed green on the
  // other insert's line.
  assert.ok(
    !/quoteVersion:\s*priorVersion/.test(copyBlock),
    "the copy must never WRITE the prior version — that is the record the customer already saw",
  );
  // And every version written in the block is the new one.
  const written = [...copyBlock.matchAll(/quoteVersion:\s*(\w+)/g)].map((m) => m[1]);
  assert.ok(written.length >= 2, "both the profile and its tier rows must be copied");
  assert.deepEqual([...new Set(written)], ["newVersion"]);

  assert.ok(
    !/\.update\(presentationProfile\)/.test(copyBlock),
    "a revision must COPY the prior profile, never update it in place",
  );
});

test("a sent quote refuses presentation edits", async () => {
  // §5.4. These fields decide what the customer document shows and are frozen
  // at send; if a sent quote could still edit them, the record of what the
  // customer saw would become editable after they saw it.
  const src = codeOnly(await read("src/app/actions/presentation-profile.ts"));

  const writers = [
    "updatePresentationInclude",
    "updatePresentationLayout",
    "updatePresentationDetail",
    "updatePresentationTierShown",
  ];
  for (const w of writers) {
    const body = src.slice(src.indexOf(`export async function ${w}`));
    const scoped = body.slice(0, body.indexOf("\n}\n") + 1);
    assert.match(scoped, /quoteByIdDraft/, `${w} must refuse a non-draft quote`);
    // Redundant on purpose: the §0.5 protocol greps for this symbol, and a
    // writer that satisfies the rule through a differently-named guard is
    // invisible to the check that exists to find it.
    assert.match(scoped, /assertNotFrozen/, `${w} must be findable by the §0.5 grep`);
  }
});

test("these actions write presentation state and nothing else", async () => {
  // The boundary is only real if crossing it is visible. A presentation write
  // that touched the recommendation or the note's text would be the exact
  // conflation the disposition split apart.
  const src = codeOnly(await read("src/app/actions/presentation-profile.ts"));
  for (const forbidden of [
    /\.update\(quotes\)/,
    /\.update\(quoteTiers\)/,
    /customerFacingNotes:/,
    /recommended:/,
  ]) {
    assert.doesNotMatch(
      src,
      forbidden,
      `presentation actions must not write ${forbidden} — that is a quote fact with its own owner`,
    );
  }
});

test("showing a tier deletes its row, so absence keeps meaning shown", async () => {
  // One representation of the default. A tier added tomorrow is presented
  // without anyone writing a row to say so, and the table cannot disagree with
  // itself about what "no row" means.
  const src = codeOnly(await read("src/app/actions/presentation-profile.ts"));
  const fn = src.slice(src.indexOf("export async function updatePresentationTierShown"));
  assert.match(fn, /if \(shown\) \{[\s\S]*?\.delete\(presentationProfileTier\)/);
});

test("the customer note is frozen at send and read frozen thereafter", async () => {
  // ── M2 ──────────────────────────────────────────────────────────────────
  //
  // It was the ONE customer-facing text read live on a sent quote. Payment
  // terms, lead time, incoterms and T&Cs all branch; the note did not, and
  // nothing captured it in either store. Editing it after send restated a
  // quote the customer already held.
  const resolver = codeOnly(await read("src/lib/customer-view-resolver.ts"));
  assert.match(
    resolver,
    /customerFacingNotes: isSent/,
    "the resolver must branch on isSent, like every field beside it",
  );

  const actions = codeOnly(await read("src/app/actions/quotes.ts"));
  assert.match(
    actions,
    /customerFacingNotesSnapshot: quote\.customerFacingNotes/,
    "sendQuote must freeze the note into the store the resolver reads",
  );
  assert.match(
    actions,
    /customerFacingNotes: quote\.customerFacingNotes \?\? null/,
    "and into the versioned record, in the same transaction",
  );
});

test("the note has one author and one frozen copy", async () => {
  // The freeze must not become a second place the note is written. Only
  // sendQuote may populate the snapshot, and it copies — it never composes.
  const src = codeOnly(await read("src/app/actions/presentation-profile.ts"));
  assert.ok(
    !src.includes("customerFacingNotesSnapshot"),
    "presentation actions must not touch the frozen note",
  );
});

test("the freeze list records both, so the next writer is told", async () => {
  // Convention that is written down survives; convention that is remembered
  // does not. The note was outside this list for as long as it existed.
  const doc = await read("docs/pattern-52-freeze-list.md");
  assert.match(doc, /customer_facing_notes_snapshot/);
  assert.match(doc, /presentation_profile/);
  assert.match(doc, /quoteByIdDraft/, "the guard future writers must call is named");
});

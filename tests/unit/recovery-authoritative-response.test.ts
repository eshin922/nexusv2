import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const EVALUATE = "src/app/actions/commercial-recovery-evaluate.ts";
const DRAFT = "src/components/quote/use-recovery-draft.ts";
const HOST = "src/components/quote/quote-host.tsx";
const CARD = "src/components/quote/card-commercial-recovery.tsx";

/**
 * The election's answer arrives before the write, not after it.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * A recovery election committed in under a second and the result reached the
 * screen only when a full-page revalidation landed. Measured repeatedly on
 * production: 1994-4041ms from click to any visible change, with the selected
 * segment and the customer document both moving in a single frame at the very
 * end.
 *
 * For those seconds the control looked like it had done nothing. Operators
 * reported it as broken, and every diagnosis answering "the write persisted"
 * was answering a question nobody had asked.
 *
 * The first repair returned the post-write projection from the writer, which
 * removed the second render but kept the database round trip on the critical
 * path. This removes the round trip: the engine evaluates a PROPOSED election
 * and the write follows behind the answer.
 */

test("the evaluator runs the engine and writes nothing", async () => {
  const src = codeOnly(await read(EVALUATE));
  assert.match(src, /resolveCustomerView\(\{ quoteId, proposedElections: elections \}\)/);
  for (const forbidden of [/db\.insert/, /db\.update/, /db\.delete/, /writeAuditEntry/]) {
    assert.doesNotMatch(src, forbidden, "evaluating is not an act; it must not write");
  }
});

test("it is THE resolver, not a cheaper parallel projection", async () => {
  // The whole safety of evaluate-first rests here. A second, lighter
  // computation of "what probably changed" would be a second authority over
  // customer economics, and the first time it disagreed the operator would be
  // reading a number the customer's document does not carry.
  const src = codeOnly(await read(EVALUATE));
  assert.match(src, /import \{ resolveCustomerView \}/);
  for (const forbidden of [/computeQuoteCosting/, /composeTierMoney/, /projectCommercial/]) {
    assert.doesNotMatch(src, forbidden, "the evaluator must re-run the resolver, not assemble a projection");
  }
});

test("the proposal reaches the engine as INPUT, through the existing seam", async () => {
  // `QuoteCostingInput.chargeElections` has always been an input — the engine
  // takes elections as data and does not fetch them, which is what
  // `measureRecoveryImpact` has always relied on. Nothing new computes here.
  const costing = codeOnly(await read("src/app/actions/costing.ts"));
  assert.match(costing, /proposedElections\?: ProposedElections/);
  assert.match(
    costing,
    /proposedElections !== undefined\s*\?\s*\[\.\.\.proposedElections\]\s*:\s*await loadChargeElections\(quoteId\)/,
  );
  const resolver = codeOnly(await read("src/lib/customer-view-resolver.ts"));
  assert.match(resolver, /proposedElections\?: ProposedElections/);
});

test("the solve path still reads the PERSISTED set", async () => {
  // `applyClientTargetSolveTierAdj` writes the answer it computes, so it must
  // solve against the elections actually in force — not against a candidate an
  // operator is still exploring.
  const costing = codeOnly(await read("src/app/actions/costing.ts"));
  const fn = costing.slice(costing.indexOf("export async function applyClientTargetSolveTierAdj"));
  const upTo = fn.slice(0, fn.indexOf("chargeElections:") + 200);
  assert.match(upTo, /chargeElections: await loadChargeElections\(quoteId\)/);
  assert.doesNotMatch(upTo, /proposedElections/);
});

test("the client renders the response and computes nothing from it", async () => {
  const host = codeOnly(await read(HOST));
  const card = codeOnly(await read(CARD));

  assert.match(host, /const shownView = authoritative\?\.view \?\? view/);
  assert.match(host, /const shownRecoveryRows = authoritative\?\.recoveryRows \?\? recoveryRows/);
  // The call takes a SET since OD-032 recovery grain — one pick, or N for a
  // group action. The claim is unchanged: the card ASKS and renders the answer.
  assert.match(card, /await onPropose\(\s*\n?\s*subjects\.map/);

  // NOT optimistic: nothing is applied before the server answers, and the
  // client derives no commercial consequence of its own.
  for (const forbidden of [/optimistic/i, /computeQuoteCosting/, /\* \(1 \+/]) {
    assert.doesNotMatch(host, forbidden, "the surface must not guess or compute");
    assert.doesNotMatch(card, forbidden, "the surface must not guess or compute");
  }
});

test("a newer server render supersedes the response", async () => {
  // Otherwise the surface pins the first answer and ignores every later one —
  // including a change made somewhere else entirely.
  const host = codeOnly(await read(HOST));
  assert.match(host, /lastPropView\.current !== view/);
  assert.match(host, /setAuthoritative\(null\)/);
});

test("Card 1 and the document cannot be a render apart", async () => {
  // Both read the SAME projection. If the card took the evaluated answer and
  // the document waited for the revalidation, the operator would watch the
  // selection move against a document still showing the old answer — a worse
  // failure than the wait, because it looks like a disagreement about money.
  //
  // This is the condition the whole design is held to: one authoritative
  // object, two consumers.
  const host = codeOnly(await read(HOST));
  assert.match(host, /<CustomerViewLive view=\{shownView\} \/>/);
  assert.match(host, /recoveryRows=\{shownRecoveryRows\}/);
  // And the draft is fed the shown rows, so a proposal composes onto what is
  // displayed rather than onto a stale prop.
  assert.match(host, /rows: shownRecoveryRows/);
});

test("the card no longer writes", async () => {
  // It asks for an evaluation. The write is the draft's, behind the answer.
  const card = codeOnly(await read(CARD));
  assert.doesNotMatch(card, /persistChargeRecoverySet/);
  assert.doesNotMatch(card, /setChargeRecovery/);
});

test("the persist-first writer is gone, not merely unused", async () => {
  // A writer that persists before evaluating, sitting beside one that does not,
  // is an invitation to wire the wrong one.
  const actions = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  assert.doesNotMatch(actions, /export async function setChargeRecovery/);
});

test("the draft owns evaluation, persistence and the flush", async () => {
  const draft = codeOnly(await read(DRAFT));
  assert.match(draft, /evaluateChargeRecovery\(/);
  assert.match(draft, /persistChargeRecoverySet\(/);
  assert.match(draft, /export function useRecoveryDraft/);
});

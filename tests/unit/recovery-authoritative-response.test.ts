import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The election's answer arrives with the write, not with the next render.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * A recovery election committed in under a second, and the result reached the
 * screen only when the full-page revalidation landed. Measured repeatedly on
 * production: 1994-4041ms from click to any visible change, with the selected
 * segment and the customer document both changing in a single frame at the
 * very end.
 *
 * For those seconds the control looked like it had done nothing. Operators
 * reported it as broken, repeatedly, and every diagnosis that answered with
 * "the write persisted" was answering a question nobody had asked. A write
 * whose consequences are already computed should not be invisible until an
 * unrelated render delivers it.
 */

test("the action returns the projection its own write produced", async () => {
  const src = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  const fn = src.slice(src.indexOf("export async function setChargeRecovery"));

  // Resolved AFTER the write, so it reflects the row that now exists.
  const writeAt = fn.indexOf("revalidateQuoteTree");
  const resolveAt = fn.indexOf("resolveCustomerView({ quoteId })");
  assert.ok(resolveAt > 0, "the action must resolve the post-write state");
  assert.ok(resolveAt < writeAt, "and do it before handing back");

  assert.match(fn, /projection = \{ view: resolved\.view, recoveryRows: resolved\.recoveryRows \}/);
});

test("it is THE resolver, not a cheaper parallel projection", async () => {
  // The whole safety of this rests here. A second, lighter computation of
  // "what probably changed" would be a second authority over customer
  // economics, and the first time it disagreed the operator would be reading a
  // number the customer's document does not carry.
  const src = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  assert.match(src, /import \{ resolveCustomerView \}/);

  // No hand-rolled recomputation in the action: it re-resolves, it does not
  // re-derive.
  for (const forbidden of [/computeQuoteCosting/, /composeTierMoney/, /projectCommercial/]) {
    assert.doesNotMatch(
      src,
      forbidden,
      "the action must re-run the resolver, never assemble a projection itself",
    );
  }
});

test("a failed re-read degrades to the old behaviour, never to a wrong document", async () => {
  // The write is committed by this point. Throwing away a successful election
  // because a re-read did not come back would turn a display problem into a
  // commercial one; the revalidation still delivers the result either way.
  const src = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  const fn = src.slice(src.indexOf("export async function setChargeRecovery"));
  assert.match(fn, /try \{[\s\S]{0,400}resolveCustomerView[\s\S]{0,300}\} catch \{[\s\S]{0,80}projection = null/);
});

test("the client renders the response, and computes nothing from it", async () => {
  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  const card = codeOnly(await read("src/components/quote/card-commercial-recovery.tsx"));

  assert.match(host, /const shownView = authoritative\?\.view \?\? view/);
  assert.match(host, /const shownRecoveryRows = authoritative\?\.recoveryRows \?\? recoveryRows/);
  assert.match(card, /onAuthoritative\?\.\(res\.data\.projection\)/);

  // NOT optimistic: nothing is applied before the server answers, and the
  // client derives no commercial consequence of its own.
  for (const forbidden of [/optimistic/i, /computeQuoteCosting/, /\* \(1 \+/]) {
    assert.doesNotMatch(host, forbidden, "the surface must not guess or compute");
    assert.doesNotMatch(card, forbidden, "the surface must not guess or compute");
  }
});

test("a newer server render supersedes the response", async () => {
  // Otherwise the surface pins the first post-write answer and ignores every
  // later one — including a change made somewhere else entirely. The
  // revalidation still runs; it is simply no longer what the operator waits on.
  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  assert.match(host, /lastPropView\.current !== view/);
  assert.match(host, /setAuthoritative\(null\)/);
});

test("Card 1 and the document cannot be a render apart", async () => {
  // Both read from the SAME projection. If the card took the response and the
  // document waited for the revalidation, the operator would watch the
  // selection move against a document still showing the old answer — a worse
  // failure than the wait, because it looks like a disagreement about money.
  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  assert.match(host, /<CustomerViewLive view=\{shownView\} \/>/);
  assert.match(host, /recoveryRows=\{shownRecoveryRows\}/);
});

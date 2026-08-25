import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The last two pieces of Track A: the authored instruction to Accounting, and
 * the Finalize action.
 */

test("the accounting instruction never reaches the customer", async () => {
  // Structural, not remembered. `CustomerView` is the customer document; if the
  // instruction were on it, the only thing standing between an internal note
  // and a customer would be every renderer choosing not to print it.
  const types = codeOnly(await read("src/types/quote.ts"));
  const view = types.slice(
    types.indexOf("export type CustomerView = {"),
    types.indexOf("\n};", types.indexOf("export type CustomerView = {")),
  );
  assert.ok(view.length > 0, "CustomerView not found");
  assert.ok(
    !/accountingInstruction/i.test(view),
    "the instruction must not be on the customer projection",
  );

  // And neither renderer mentions it.
  for (const f of [
    "src/components/quote/customer-view-live.tsx",
    "src/lib/customer-view-to-cpdf.ts",
    "src/components/pdf/customer-pdf-document.tsx",
  ]) {
    assert.ok(
      !/accountingInstruction|accounting_instruction/i.test(codeOnly(await read(f))),
      `${f} must not carry the accounting instruction`,
    );
  }
});

test("the instruction is a quote fact, written by its own module", async () => {
  // It began in `presentation-profile.ts` because it is edited on the same card
  // and guarded the same way. A test refused it — "these actions write
  // presentation state and nothing else" caught the `.update(quotes)` — and was
  // right to: presentation actions write presentation facts, and this writes a
  // quote fact. Housing them together made the boundary something a reader had
  // to notice rather than something the code showed.
  const own = codeOnly(await read("src/app/actions/accounting-instruction.ts"));
  assert.match(own, /export async function updateAccountingInstruction/);
  assert.match(own, /\.update\(quotes\)/);

  const presentation = codeOnly(await read("src/app/actions/presentation-profile.ts"));
  assert.ok(
    !presentation.includes("updateAccountingInstruction"),
    "the presentation actions must not house a quote-fact writer",
  );
});

test("the instruction is guarded and frozen like every other quote fact", async () => {
  const own = codeOnly(await read("src/app/actions/accounting-instruction.ts"));
  // Refused once sent: Accounting acts on this after acceptance, and an
  // instruction editable then would describe a quote that had moved on.
  assert.match(own, /quoteByIdDraft/);
  assert.match(own, /assertNotFrozen/);

  const actions = codeOnly(await read("src/app/actions/quotes.ts"));
  assert.match(
    actions,
    /accountingInstruction: quote\.accountingInstruction \?\? null/,
    "sendQuote must freeze it with the version",
  );
});

test("the audit row records the transition, not the prose", async () => {
  // Free-form internal text may name people and commercial circumstances, and
  // an audit log has a wider readership than the field. Presence, length and
  // the transition are what a forensic reader needs; the text itself is
  // already in the column.
  const own = codeOnly(await read("src/app/actions/accounting-instruction.ts"));
  assert.match(own, /from_present/);
  assert.match(own, /to_present/);
  assert.ok(
    !/diffJson: \{[\s\S]{0,200}instruction,/.test(own),
    "the instruction text must not be copied into the audit row",
  );
});

test("Finalize calls the certified path and invents no gate of its own", async () => {
  const btn = codeOnly(await read("src/components/quote/finalize-quote-button.tsx"));
  assert.match(btn, /sendQuote\(fd\)/, "it calls the certified action");

  // No local floor logic. The footer's disabled state PREDICTS sendQuote's
  // refusal from the shared projection; a button that decided for itself would
  // be the third opinion on a question that now has one.
  for (const forbidden of [/floorMarginPct/, /BELOW_FLOOR/, /blendedMargin/]) {
    assert.doesNotMatch(btn, forbidden, "Finalize must not judge the floor itself");
  }

  // A refusal is shown, not swallowed. The gate's sentence names the tier and
  // distinguishes three reasons; discarding it would leave the operator with a
  // button that did nothing.
  assert.match(btn, /setError\(r\.error\.message\)/);
});

test("the button says what it does; the action keeps the name the system knows", async () => {
  const rail = await read("src/components/quote/customer-view-rail.tsx");
  assert.match(rail, /Finalize quote/);
  assert.match(rail, /Nexus does not email the customer/);

  // The ACTION is still sendQuote. That name is the certified path — the send
  // gate, snapshot writes, PDF persistence, audit row and below-floor refusal
  // all hang off it — and renaming a transaction to match a button is how a
  // rename becomes a regression.
  const btn = codeOnly(await read("src/components/quote/finalize-quote-button.tsx"));
  assert.match(btn, /from "@\/app\/actions\/quotes"/);
});

test("Finalize is refused on a frozen quote and on an unauthorized floor", async () => {
  const rail = codeOnly(await read("src/components/quote/customer-view-rail.tsx"));
  assert.match(
    rail,
    /disabled=\{!isDraft \|\| blocked\}/,
    "both refusals, from the shared verdict",
  );
  // `blocked` is the shared projection, not a local margin comparison — pinned
  // by the footer-authority suite, and asserted here too because this is the
  // control that acts on it.
  assert.match(rail, /const blocked = !belowFloor\.ok/);
});

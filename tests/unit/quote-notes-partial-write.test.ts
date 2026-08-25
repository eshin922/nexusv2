import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * A single-field caller must not erase the field it did not send.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * `updateQuoteNotes` wrote BOTH `internal_notes` and `customer_facing_notes`
 * from FormData, unconditionally. That was safe for exactly as long as its only
 * caller was a form that submitted both — which it was, until Card 2 gained a
 * customer-note control that sends one.
 *
 * Pointing that control here would have silently NULLED `internal_notes` on
 * every quote that had them. Two production drafts carry them today. No error,
 * no warning, no way for the operator to notice: they would have typed a
 * customer note and destroyed a colleague's sourcing notes in the same
 * keystroke.
 *
 * Found on the consolidated operator walk, before it reached a quote that had
 * any — which is the entire argument for walking a real surface rather than
 * reasoning about one.
 *
 * The rule: a key ABSENT from the payload means "not being edited". An empty
 * string still means "cleared", so clearing keeps working for the caller that
 * sends both.
 */

test("a key absent from the payload is preserved, not nulled", async () => {
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  const fn = src.slice(src.indexOf("export async function updateQuoteNotes"));
  const body = fn.slice(0, fn.indexOf("export async function", 10));

  assert.match(
    body,
    /formData\.has\("internalNotes"\)[\s\S]{0,120}quote\.internalNotes/,
    "an absent internalNotes must keep the stored value",
  );
  assert.match(
    body,
    /formData\.has\("customerFacingNotes"\)[\s\S]{0,140}quote\.customerFacingNotes/,
    "an absent customerFacingNotes must keep the stored value",
  );

  // The unconditional read is what caused it. It must be gone, not merely
  // shadowed by the guard above.
  assert.ok(
    !/const internal = trimOrNull\(formData\.get\("internalNotes"\)\);/.test(body),
    "the unconditional overwrite must not survive",
  );
});

test("empty still means cleared, so the two-field caller is unaffected", async () => {
  // `trimOrNull("")` is null. Distinguishing absent from empty had to preserve
  // that, or the Setup notes editor would have lost the ability to clear a
  // note — trading one silent data loss for a control that stops working.
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  const fn = src.slice(src.indexOf("export async function updateQuoteNotes"));
  assert.match(fn.slice(0, 2000), /trimOrNull\(formData\.get\("internalNotes"\)\)/);

  const editor = codeOnly(
    await read("src/app/projects/[id]/quotes/[quoteId]/notes-editor.tsx"),
  );
  // And that caller does still send both keys, which is why it is unaffected.
  assert.match(editor, /fd\.set\("internalNotes"/);
  assert.match(editor, /fd\.set\("customerFacingNotes"/);
});

test("Card 2 sends only the customer note, and that is now safe", async () => {
  const card = codeOnly(
    await read("src/components/quote/card-customer-presentation.tsx"),
  );
  assert.match(card, /fd\.set\("customerFacingNotes", note\)/);
  assert.ok(
    !card.includes('fd.set("internalNotes"'),
    "Card 2 has no business sending internal notes — it cannot see them",
  );
});

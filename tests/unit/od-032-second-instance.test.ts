/**
 * OD-032 — a component may cause two charges of one type, and now can.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `AssemblyTreeBody.existingComponentCharges` was declared OPTIONAL and passed
 * by NOBODY. Optional, so it compiled; unread, so nothing failed. The sheet
 * therefore believed every component owned nothing:
 *
 *   - the "already has N" warning never rendered
 *   - the distinct-label input never appeared
 *   - a second charge of a type submitted with `label: null`
 *
 * `ensureChargeInstance` is idempotent on (quote, type, owner, label) — rightly,
 * since re-submitting one commercial fact must not mint a rival identity — so
 * that second submission RESOLVED TO THE FIRST and reported success.
 *
 * Measured on production 2026-08-28: three submissions, two charges, no error.
 * Nothing was corrupted and nothing was created, which is the worst pair to
 * hand an operator, because the surface said it worked.
 *
 * The capability was not broken. It was unreachable, and the model supported
 * it the whole time — which is why the Recovery grain could prove two rows for
 * two instances while no operator could produce two instances.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const SHEET = "src/components/assembly-tree/add-component-charges-sheet.tsx";
const BODY = "src/components/assembly-tree/assembly-tree-body.tsx";
const VIEW = "src/components/assembly-tree/assembly-tree-view.tsx";
const PAGE = "src/app/projects/[id]/quotes/[quoteId]/page.tsx";
const READ = "src/lib/component-charges/read.ts";
const CREATE = "src/lib/component-charges/create.ts";

const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// The prop is actually passed, at every link
// ══════════════════════════════════════════════════════════════════════

test("the chain is WIRED, end to end", () => {
  // ── WHY EACH LINK IS ASSERTED SEPARATELY ───────────────────────────────
  //
  // The defect was one unpassed optional prop. Asserting only that the sheet
  // consumes it, or only that the reader exists, would have passed before this
  // repair — the sheet consumed it and the data was there to read. What was
  // missing was the passing, at one link in a chain of three.
  const page = codeOnly(read(PAGE));
  assert.match(page, /existingComponentCharges=\{await readExistingComponentCharges\(quoteId\)\}/);

  const view = codeOnly(read(VIEW));
  assert.match(view, /existingComponentCharges,/);
  assert.match(view, /existingComponentCharges=\{existingComponentCharges\}/);

  const body = codeOnly(read(BODY));
  assert.match(body, /existingKeys=\{/);
  assert.match(body, /existingComponentCharges\?\.filter\(/);
});

test("it carries IDENTITY, never a count by type", () => {
  // ── WHY A COUNT WOULD NOT DO ───────────────────────────────────────────
  //
  // The sheet has two questions and a count answers one. "Does this component
  // already have Tooling?" needs the TYPE. "What tells a second one apart?"
  // needs the LABELS THAT EXIST — which is the thing the operator has to
  // decide, and the thing a count discards.
  //
  // The instance id rides along because the identity is the fact. A caller
  // holding it cannot later be tempted to reconstruct one from a type and a
  // position, which is the shape OD-028 exists to warn about.
  const reader = codeOnly(read(READ));
  assert.match(reader, /export type ExistingComponentCharge = \{/);
  for (const field of ["chargeInstanceId", "quoteLeafId", "chargeKey", "label"]) {
    assert.match(reader, new RegExp(`${field}:`), `identity must carry ${field}`);
  }
  // Legacy '@quote' charges are owned by the engagement and belong in no
  // component's picker.
  assert.match(reader, /isNotNull\(quoteChargeInstances\.ownerQuoteLeafId\)/);

  const sheet = codeOnly(read(SHEET));
  assert.match(sheet, /chargeInstanceId: string;/);
  assert.ok(
    !/existingCount|countByType/.test(sheet),
    "a count would answer one of the sheet's two questions and discard the other",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The surface tells the operator what to be distinct FROM
// ══════════════════════════════════════════════════════════════════════

test("the warning names the labels already in use", () => {
  const sheet = read(SHEET);
  assert.match(sheet, /already has \{owned\}/);
  assert.match(sheet, /ownedLabels\(k\)\.join\(", "\)/);
  assert.match(sheet, /a second needs a distinct label/);
});

test("SUBMIT is gated, and says why on the surface", () => {
  const sheet = codeOnly(read(SHEET));
  // Gated on the reason, not merely on emptiness.
  assert.match(sheet, /disabled=\{picked\.size === 0 \|\| saving \|\| blocked\(\) !== null\}/);
  // Pattern 47(f): a disabled control communicates why — and in VISIBLE TEXT,
  // because hover-to-discover is a navigation pattern, not a presentation one.
  assert.match(sheet, /data-testid="sheet-blocked"/);
  assert.match(read(SHEET), /Give the new one a label that tells it apart/);
  // A duplicate label is refused too — two charges labelled the same are not
  // told apart by their labels.
  assert.match(sheet, /ownedLabels\(k\)\.includes\(label\)/);
});

test("the PICK is never disabled — the warning is not a refusal", () => {
  // Two dies on one carton is a real thing. What is gated is submitting a
  // second one that cannot be told from the first, not selecting the type.
  const sheet = codeOnly(read(SHEET));
  const pick = sheet.slice(sheet.indexOf('className="od032-pick"'));
  assert.ok(!/disabled/.test(pick.slice(0, 500)));
});

// ══════════════════════════════════════════════════════════════════════
// The writer refuses the collision instead of absorbing it
// ══════════════════════════════════════════════════════════════════════

test("a colliding charge is REFUSED, not silently resolved to the first", () => {
  // ── THE WORST PAIR: NOTHING CREATED, NOTHING REPORTED ──────────────────
  //
  // The idempotency is correct and stays where it belongs, on
  // `ensureChargeInstance`, which the copy path relies on. What was wrong was
  // this path reporting SUCCESS for a write it did not perform.
  const create = codeOnly(read(CREATE));
  assert.match(create, /const taken = new Set\(owned\.map/);
  assert.match(create, /if \(taken\.has\(ownedKey\(key, label\)\)\)/);
  assert.match(read(CREATE), /This component already has a \$\{COMPONENT_CHARGE_LABELS\[key\]\} charge/);
  // Scoped to this component on this quote — another component's Tooling is
  // not a collision.
  assert.match(create, /eq\(quoteChargeInstances\.ownerQuoteLeafId, quoteLeafId\)/);
  assert.match(create, /eq\(quoteChargeInstances\.quoteId, quoteId\)/);
});

test("an UNLABELLED second is refused — the wider rule, and the narrow one cannot stand in", () => {
  // ── THE GAP THE RUNTIME PROOF FOUND ────────────────────────────────────
  //
  // The first version of the guard checked only for an EXACT (type, label)
  // duplicate. `(print_plates, null)` does not collide with
  // `(print_plates, "Front panel")`, so an unlabelled second charge — exactly
  // what the sheet used to send — slipped past and minted a third identity
  // nothing could tell from the first two.
  //
  // The source assertions could not see it: they proved a collision was
  // refused, and this was not a collision. Only writing the row found it.
  const create = codeOnly(read(CREATE));
  assert.match(create, /if \(label === null && labelsFor\(key\)\.length > 0\)/);
  // And it is checked BEFORE the exact-duplicate test, because it is wider.
  const wider = create.indexOf("label === null && labelsFor(key).length > 0");
  const narrow = create.indexOf("taken.has(ownedKey(key, label))");
  assert.ok(wider > 0 && wider < narrow, "the wider rule must be reached first");
});

test("the refusal NAMES the labels already used", () => {
  const create = read(CREATE);
  assert.match(create, /already used: \$\{existing\.join\(", "\)\}/);
  assert.match(create, /labelled "\$\{label\}"\. Give the new one a different label/);
});

test("two drafts colliding WITH EACH OTHER in one submission are refused", () => {
  // The stored set cannot see them, because neither is stored yet.
  const create = codeOnly(read(CREATE));
  assert.match(create, /taken\.add\(ownedKey\(key, label\)\)/);
  // And it happens inside the pre-write validation, so nothing lands first.
  const validate = create.indexOf("const validated = input.charges.map");
  const write = create.indexOf("await db.transaction");
  const guard = create.indexOf("taken.has(ownedKey(key, label))");
  assert.ok(guard > validate && guard < write, "the refusal must precede every write");
});

test("idempotency is PRESERVED where it belongs", () => {
  // `ensureChargeInstance` still resolves rather than duplicating — the copy
  // path depends on it, and re-submitting one commercial fact must not mint a
  // rival identity for it. The refusal above is in the authoring path only.
  const create = codeOnly(read(CREATE));
  assert.match(create, /ensureChargeInstance\(tx, \{/);
  const instance = codeOnly(read("src/lib/commercial-recovery/charge-instance.ts"));
  assert.ok(
    !/already has a/.test(instance),
    "the collision refusal belongs to authoring, not to the shared resolver",
  );
});

test("the separator cannot collide, and is an escape rather than a raw byte", () => {
  // A label is free text. ` ` is the one character it cannot contain, so
  // (type, label) pairs cannot alias — and it is written as an ESCAPE, because
  // a literal NUL in source makes the file binary to every text tool that
  // reads it.
  const raw = readFileSync(CREATE);
  assert.equal(raw.indexOf(0), -1, "no literal NUL byte in source");
  assert.match(read(CREATE), /\$\{k\}\\u0000\$\{l \?\? ""\}/);
});

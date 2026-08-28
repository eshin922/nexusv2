/**
 * OD-032 phase 4 — the Setup authoring sheet.
 *
 * The sheet is where a component charge becomes real, so what has to hold is
 * that it records what the operator said and nothing more: the causal owner
 * they pointed at, the amounts they typed, no placement, and no charge they did
 * not select.
 *
 * Design Authority: `Nexus OD-032 Round Trip` §03. Copy and geometry are taken
 * from it rather than interpreted, and the ONE divergence is asserted below so
 * it cannot be mistaken for drift.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  labelRequiredFor,
} from "../../src/lib/commercial-recovery/registry.ts";

const SHEET = "src/components/assembly-tree/add-component-charges-sheet.tsx";
/**
 * The IMPLEMENTATION, which is not the server action.
 *
 * The action is a thin wrapper that resolves the operator and hands off. The
 * split exists so a governed gate script can exercise the real write path —
 * the script resolver refuses to stub authentication for write paths, because
 * "a stubbed guard is a guard that passes".
 */
const ACTION = "src/lib/component-charges/create.ts";
const WRAPPER = "src/app/actions/component-charges.ts";
const MENU = "src/components/assembly-tree/leaf-context-menu.tsx";
const CSS = "src/styles/od032-charge-sheet.css";
const PROTOTYPE =
  "docs/design-prototypes/od-032/design/Nexus OD-032 Round Trip.dc.html";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments are prose, not behaviour. Matching one as a use has misled before. */
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// Suggested, never pre-checked
// ══════════════════════════════════════════════════════════════════════

test("no type is ever pre-selected", () => {
  // A pre-checked box is how a phantom charge reaches a customer document with
  // nobody having decided it. Suggestion is a prompt; selection is an act.
  const sheet = codeOnly(read(SHEET));

  // The selection starts EMPTY, and suggestions do not seed it.
  assert.match(sheet, /useState<Set<ComponentChargeKey>>\(new Set\(\)\)/);
  assert.ok(
    !/new Set\(suggestions\)/.test(sheet),
    "suggestions must not seed the selection",
  );
  // Suggestions render as chips — read-only text, with no toggle attached.
  const chipBlock = sheet.slice(sheet.indexOf("od032-chips"));
  assert.ok(
    !/onClick/.test(chipBlock.slice(0, 400)),
    "a suggestion chip must not be clickable — that is a pre-check by gesture",
  );
  // And the surface says so, in the Design Authority's own words.
  assert.match(read(SHEET), /suggested · never pre-checked/);
});

test("submitting sends only what was selected", () => {
  const sheet = codeOnly(read(SHEET));
  // `drafts` is built FROM the picked set, and the payload is built from
  // `drafts` — so a type nobody ticked has no path into the request.
  assert.match(sheet, /const chosen = \[\.\.\.picked\]/);
  assert.match(sheet, /charges: drafts\.map/);
});

// ══════════════════════════════════════════════════════════════════════
// Same type twice is legal — a warning, not a block
// ══════════════════════════════════════════════════════════════════════

test("picking an owned type warns and still allows it", () => {
  const sheet = codeOnly(read(SHEET));
  // The warning renders...
  assert.match(sheet, /already has \{owned\} — adding another needs a distinct label/);
  // ...and NOTHING disables the control on account of it. Two dies on one
  // carton is a real thing; the model must not out-argue the shop floor.
  const pickBtn = sheet.slice(sheet.indexOf('className="od032-pick"'));
  assert.ok(
    !/disabled/.test(pickBtn.slice(0, 500)),
    "an owned type must remain selectable — the warning is not a refusal",
  );
});

test("a second charge of one type requires a distinct label", () => {
  const sheet = codeOnly(read(SHEET));
  // The label input appears when the type is `other` OR the component already
  // owns one, which is exactly when a label is what tells two charges apart.
  assert.match(
    sheet,
    /labelRequiredFor\(d\.key\) \|\| ownedCount\(d\.key\) > 0/,
  );
});

// ══════════════════════════════════════════════════════════════════════
// Placement is never asked
// ══════════════════════════════════════════════════════════════════════

test("the sheet asks for no recovery placement", () => {
  const sheet = read(SHEET);
  const code = codeOnly(sheet);
  // No mode reaches the request. Asking here would fuse the two decisions the
  // model keeps apart.
  for (const mode of ["included", "separate", "absorbed"]) {
    assert.ok(
      !new RegExp(`["']${mode}["']`).test(code),
      `the sheet must not offer or send "${mode}"`,
    );
  }
  // And it SAYS so, verbatim from the Design Authority.
  assert.match(
    sheet,
    /Recovery placement is not asked here[\s\S]*?arrive in\s*\n?\s*Commercial Recovery as/,
  );
});

test("the action elects nothing", () => {
  const action = codeOnly(read(ACTION));
  // It writes instances and their economics; it never touches the election
  // table, so a charge cannot arrive already placed.
  assert.ok(
    !/quoteChargeRecovery/.test(action),
    "authoring must not write an election — charges arrive unplaced",
  );
  // Recorded in the audit as the state it is, rather than left to inference.
  assert.match(action, /recovery: "unplaced"/);
});

// ══════════════════════════════════════════════════════════════════════
// Basis is stated, never chosen
// ══════════════════════════════════════════════════════════════════════

test("basis is one-time everywhere, and is not a control", () => {
  const sheet = read(SHEET);
  const code = codeOnly(sheet);
  // Displayed in both phases...
  assert.equal((sheet.match(/one-time/g) ?? []).length >= 2, true);
  // ...and never sent, because there is nothing to send: every component-owned
  // charge is one-time, no exceptions, and the sheet never asks.
  assert.ok(!/basis:/.test(code), "the sheet must not submit a basis");
  const action = codeOnly(read(ACTION));
  assert.ok(!/basis/.test(action), "the action must not accept a basis");
});

// ══════════════════════════════════════════════════════════════════════
// The amounts are the operator's, and are refused rather than coerced
// ══════════════════════════════════════════════════════════════════════

test("an unreadable amount is refused, never coerced to a number", () => {
  const action = codeOnly(read(ACTION));
  // `Number("")` is 0 and `Number("abc")` is NaN — both would enter the quote
  // as a cost fact nobody stated.
  assert.match(action, /must be a positive amount with at most two decimals/);

  // RAW OPERATOR INPUT is never handed to `Number`. It goes through `money`,
  // which refuses anything it cannot read.
  //
  // The earlier form of this banned `Number(` outright and was too broad: the
  // zero check compares an ALREADY-VALIDATED string, which is not coercion of
  // input but a question about a value whose shape is settled. A ban that
  // cannot tell those apart forbids the right code along with the wrong.
  for (const raw of ["a.cost", "a?.cost", "a.recoveryAsk", "a?.recoveryAsk", "raw"]) {
    assert.ok(
      !new RegExp(`Number\\(\\s*${raw.replace(/[.?]/g, "\\$&")}\\s*\\)`).test(
        action.replace(/Number\(raw\)/g, "«validated»"),
      ),
      `${raw} must reach money(), never Number()`,
    );
  }
  assert.match(action, /const raw = money\(a\?\.cost, /);
});

test("a blank recovery ask stays NULL — it is optional, and different", () => {
  const action = codeOnly(read(ACTION));
  // Zero says the charge recovers nothing. NULL says nothing governs what it
  // recovers yet. Different commercial claims, so the blank survives as blank.
  assert.match(action, /if \(t === ""\) return null;/);
  assert.match(action, /recoveryAsk: money\(a\?\.recoveryAsk, /);
  // And no refusal fires on its absence — the whole point of it being optional.
  assert.ok(
    !/Recovery ask[^"]*required/i.test(action),
    "a missing recovery ask must not be refused",
  );
});

test("EVERY quoted tier needs an explicit POSITIVE cost", () => {
  const action = codeOnly(read(ACTION));

  // Iterated over the QUOTE's tiers, not over what was submitted — a payload
  // that simply omits a tier must be refused, not silently accepted as
  // complete.
  assert.match(action, /const amounts = tiers\.map\(\(t\) => \{/);

  // The coercion is gone. A blank no longer becomes "0".
  assert.ok(
    !/money\(a\.cost, "Cost"\) \?\? "0"/.test(action),
    "a blank cost must not default to zero",
  );

  // Blank refused, and the tiers are NAMED so the operator can fix them.
  assert.match(action, /missing\.push\(t\.label\)/);
  assert.match(action, /has no cost for /);
  assert.match(action, /\$\{missing\.join\(", "\)\}/);

  // Explicit 0.00 refused too — otherwise it is simply the way round the blank
  // check, and encodes "not applicable at this tier" as an amount.
  assert.match(action, /if \(Number\(raw\) === 0\)/);
  assert.match(action, /has a cost of 0\.00 for /);
  assert.match(action, /\$\{zeroed\.join\(", "\)\}/);

  // Both refusals sit inside the pre-write validation, so neither can fire
  // after a row has landed.
  const validate = action.indexOf("const validated = input.charges.map");
  const write = action.indexOf("await db.transaction");
  assert.ok(action.indexOf("has no cost for ") > validate);
  assert.ok(action.indexOf("has no cost for ") < write);
  assert.ok(action.indexOf("has a cost of 0.00 for ") < write);
});

test("the sheet collects a cost for EVERY tier", () => {
  const sheet = codeOnly(read(SHEET));
  // The Design Authority draws one cost column because its mock has one tier.
  // With every tier required, a single column would make a multi-tier quote
  // unauthorable — the operator could not supply what the save demands.
  assert.match(sheet, /\{tiers\.map\(\(t\) => \(/);
  assert.match(sheet, /data-testid=\{`cost-\$\{d\.key\}-\$\{t\.id\}`\}/);
  assert.match(sheet, /value=\{d\.cost\[t\.id\] \?\? ""\}/);
  // Required is SAID, not merely enforced on submit.
  assert.match(sheet, /aria-required="true"/);
  assert.match(sheet, /placeholder="required"/);
  // And the blank is sent as a blank: filling it in here would defeat the
  // refusal by supplying the fact it exists to demand.
  assert.match(sheet, /cost: d\.cost\[t\.id\] \?\? ""/);
  // The recovery ask stays optional, and says so.
  assert.match(sheet, /placeholder="optional"/);
});

// ══════════════════════════════════════════════════════════════════════
// The owner is the one the operator pointed at
// ══════════════════════════════════════════════════════════════════════

test("the component must be on THIS quote", () => {
  const action = codeOnly(read(ACTION));
  // A foreign key alone accepts another quote's component and attributes the
  // charge to something this quote does not contain.
  assert.match(action, /eq\(quoteLeaves\.id, quoteLeafId\), eq\(quoteLeaves\.quoteId, quoteId\)/);
  assert.match(action, /That component is not on this quote/);
});

test("the causal owner goes straight to the instance, underived", () => {
  const action = codeOnly(read(ACTION));
  assert.match(action, /ownerRef: quoteLeafId/);
  // No anchor, no junction, no lookup: the operator opened the sheet on that
  // component, so the owner is a fact rather than a resolution.
  assert.ok(!/assembly_leaves|assemblyLeaves/.test(action));
});

// ══════════════════════════════════════════════════════════════════════
// One sheet, one gesture — all or nothing
// ══════════════════════════════════════════════════════════════════════

test("the whole sheet is validated before anything is written", () => {
  const action = codeOnly(read(ACTION));
  const validate = action.indexOf("const validated = input.charges.map");
  const write = action.indexOf("await db.transaction");
  assert.ok(validate > 0 && write > 0);
  assert.ok(
    validate < write,
    "refusing mid-write leaves a partial sheet the operator cannot see",
  );
});

test("the writes and their audit rows share one transaction", () => {
  const action = codeOnly(read(ACTION));
  const tx = action.slice(action.indexOf("await db.transaction"));
  assert.match(tx, /ensureChargeInstance\(tx,/);
  assert.match(tx, /await tx\s*\n?\s*\.insert\(quoteChargeInstanceTiers\)/);
  // Matched on the ARGUMENT rather than on how the call wraps.
  assert.match(tx, /\btx,\s*\n\s*\)/);
  assert.ok(
    !/await db\.(insert|delete|update)\(/.test(tx),
    "a bare db write inside the transaction would not roll back with it",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Design Authority fidelity
// ══════════════════════════════════════════════════════════════════════

test("the sheet's copy is the Design Authority's, verbatim", () => {
  const sheet = read(SHEET);
  const proto = read(PROTOTYPE);

  // Phrases lifted rather than paraphrased. Each appears in the prototype, so
  // this fails if either side is reworded.
  for (const phrase of [
    "Add one-time charges",
    "suggested · never pre-checked",
    "Enter economics →",
    "← Back to types",
    "Recovery placement is not asked here",
  ]) {
    assert.ok(proto.includes(phrase), `prototype no longer contains "${phrase}"`);
    assert.ok(sheet.includes(phrase), `the sheet must carry "${phrase}" verbatim`);
  }
});

test("the staging table keeps the Design Authority's geometry", () => {
  const css = read(CSS);
  // The four-column grid, at the prototype's exact widths.
  assert.match(css, /grid-template-columns: 1fr 108px 108px 132px/);
  // And the picker's own measures.
  assert.match(css, /font-size: 13px/);
  assert.match(css, /font-size: 9\.5px/);

  const proto = read(PROTOTYPE);
  assert.ok(
    proto.includes("grid-template-columns: 1fr 108px 108px 132px"),
    "the prototype's grid changed — re-take the geometry rather than keeping this",
  );
});

test("DIVERGENCE · Run setup is not offered, and the disposition is why", () => {
  // ── THE ONE PLACE THIS DEPARTS FROM THE PROTOTYPE ──────────────────────
  //
  // The prototype's picker lists SIX types including "Run setup". The V1
  // disposition removed it: no governed NetSuite destination exists for it yet,
  // and it reaches V1 through Other · labelled instead.
  //
  // The disposition is later than the prototype and governs. Asserted rather
  // than silently omitted, so a future reader comparing the two finds the
  // reason here instead of a discrepancy.
  const proto = read(PROTOTYPE);
  assert.ok(
    proto.includes('name: "Run setup"'),
    "the prototype no longer lists Run setup — this divergence may be resolved",
  );

  const keys = [...COMPONENT_CHARGE_KEYS];
  assert.equal(keys.length, 5, "V1 offers five component types");
  assert.ok(
    !keys.some((k) => String(k).includes("run_setup")),
    "Run setup is out of V1 pending an Accounting destination",
  );

  // Every offered type has a label and a hint, so the picker cannot render a
  // type it has no words for.
  //
  // Checked at the REGISTRY, not as literals in the component: the sheet reads
  // `COMPONENT_CHARGE_LABELS[k]`, and demanding the strings appear in the JSX
  // would demand the vocabulary be duplicated — the opposite of what one source
  // of truth means.
  for (const k of keys) {
    assert.ok(
      (COMPONENT_CHARGE_LABELS[k] ?? "").length > 0,
      `${k} has no label to render`,
    );
  }
  const sheet = codeOnly(read(SHEET));
  assert.match(sheet, /COMPONENT_CHARGE_LABELS\[k\]/);
  assert.match(sheet, /COMPONENT_CHARGE_KEYS\.map/);
  // And a hint for each, so no row renders with a blank second line.
  assert.match(sheet, /const HINT: Record<ComponentChargeKey, string>/);
});

test("only `other` demands a label of its own", () => {
  // The registry's rule, restated at the surface it governs.
  assert.equal(labelRequiredFor("other_service"), true);
  for (const k of COMPONENT_CHARGE_KEYS) {
    if (k !== "other_service") assert.equal(labelRequiredFor(k), false);
  }
});

// ══════════════════════════════════════════════════════════════════════
// The entry point
// ══════════════════════════════════════════════════════════════════════

test("the entry point is the component row's own menu", () => {
  const menu = codeOnly(read(MENU));
  assert.match(menu, /Add one-time charges/);
  // Disabled on a non-draft, and it says why — Pattern 47(f).
  assert.match(menu, /This quote is no longer a draft; charges are frozen\./);
  // Offered only when a handler exists, so a tree without the sheet does not
  // render a control that does nothing.
  assert.match(menu, /\{onAddCharges && \(/);
});

test("the sheet outlives the menu that opened it", () => {
  // The menu closes on click. A sheet owned by it would close with it, so the
  // open component is held at tree level.
  const body = codeOnly(
    read("src/components/assembly-tree/assembly-tree-body.tsx"),
  );
  assert.match(body, /const \[chargeSheetLeaf, setChargeSheetLeaf\]/);
  assert.match(body, /<AddComponentChargesSheet/);
});

test("the portal carries its own scope", () => {
  const sheet = codeOnly(read(SHEET));
  // `createPortal` mounts outside the React tree's DOM ancestry, so a parent
  // CSS scope does not follow — the escape that left a dialog's canonical
  // classes unresolved before. This sheet's classes are prefix-clean and
  // globally loaded, and the backdrop carries the root class itself.
  assert.match(sheet, /createPortal\(sheet, document\.body\)/);
  assert.match(sheet, /className="od032-sheet-backdrop"/);
  const css = read(CSS);
  const selectors = css.match(/^\.[a-z0-9-]+/gm) ?? [];
  assert.ok(selectors.length > 0);
  assert.ok(
    selectors.every((sel) => sel.startsWith(".od032-")),
    `every selector must be prefix-clean; found ${selectors.filter((s) => !s.startsWith(".od032-")).join(", ")}`,
  );
});

// ══════════════════════════════════════════════════════════════════════
// The split did not weaken the guard
// ══════════════════════════════════════════════════════════════════════

test("the auth guard sits on the only door the UI can reach", () => {
  // Moving the implementation out of the `"use server"` file is only safe if
  // the guard moved WITH the door rather than being left behind — otherwise
  // the split is a refactor that quietly removed an authorization check.
  const wrapper = codeOnly(read(WRAPPER));
  assert.match(wrapper, /"use server"/);
  assert.match(wrapper, /const user = await ensureUser\(\);/);
  // EVERY exported action, derived rather than counted. A literal `2` passes
  // the day a third action ships without a guard — the count was the assertion
  // and the count would still be right about the two that had one.
  const exported = (wrapper.match(/export async function \w+/g) ?? []).length;
  const guarded = (wrapper.match(/await ensureUser\(\)/g) ?? []).length;
  assert.equal(
    guarded,
    exported,
    `${exported} exported action(s) but ${guarded} guard(s) — every door must resolve the operator`,
  );
  assert.ok(exported >= 2, "the file must still export the authoring doors");
  assert.match(wrapper, /return createComponentChargesAs\(user\.id, input\)/);
  assert.match(wrapper, /return deleteComponentChargeAs\(user\.id, input\)/);
});

test("the core is NOT a server action", () => {
  // A `"use server"` file exports every function as an endpoint. If the core
  // carried the pragma, the split would have published an unauthenticated
  // write path — the exact opposite of what it is for.
  // codeOnly, because the core's own header EXPLAINS why it is not a server
  // action — and a check that reads the explanation as the thing it explains
  // reports a pragma that is not there. Four false results in this workstream
  // have come from matching prose as code.
  const core = codeOnly(read(ACTION));
  assert.ok(
    !core.includes('"use server"'),
    "the core must not be a server action — it takes a userId on trust",
  );
  // And it takes the actor as an argument rather than resolving one, so it
  // cannot be called without a caller that has already established who acts.
  assert.match(codeOnly(core), /createComponentChargesAs\(\s*\n?\s*userId: string/);
});

test("the UI calls the ACTION, never the core", () => {
  const sheet = codeOnly(read(SHEET));
  assert.match(sheet, /from "@\/app\/actions\/component-charges"/);
  assert.ok(
    !/component-charges\/create/.test(sheet),
    "a client importing the core would bypass the guard",
  );
});


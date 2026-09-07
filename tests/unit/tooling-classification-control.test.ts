/**
 * The operator control that states a Tooling charge's accounting type.
 *
 * ── WHAT IT HAS TO GUARANTEE ────────────────────────────────────────────
 *
 * The destination authority already refuses an unclassified Tooling charge and
 * never falls back (`component-charge-destination.test.ts`). This is the other
 * half: the only way that fact can be recorded is an operator stating it, so
 * the control and its writer must not acquire a way to state it for them.
 *
 * The guarantee that cannot be re-derived later is the ABSENCE of inference. A
 * default selection, a fallback in the writer, or a read of the owner / SKU /
 * label / amount anywhere on this path would each supply a classification
 * nobody authored, and each would look reasonable in isolation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  TOOLING_CLASSIFICATIONS,
  TOOLING_CLASSIFICATION_LABELS,
} from "../../src/lib/netsuite/component-charge-destination.ts";

/** Comments stripped, so an assertion cannot match prose about the code. */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .split(String.fromCharCode(13))
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const WRITER = "src/lib/component-charges/classify.ts";
const CONTROL = "src/components/costs/packaging-drilldown.tsx";

const writer = code(WRITER);
const control = code(CONTROL);
/** Just the control component, so assertions cannot match the rest of the file. */
const field = control.slice(control.indexOf("function ToolingClassificationField"));

// ══════════════════════════════════════════════════════════════════════
// Nothing infers the classification
// ══════════════════════════════════════════════════════════════════════

test("the control offers no pre-selected classification", () => {
  // A pre-checked box is how a phantom fact reaches an accounting system with
  // nobody having decided it — the same reason OD-032 forbids pre-checked
  // suggestion chips on the charge sheet. The empty option must come first and
  // must be the one that carries no classification.
  const options = field.slice(field.indexOf("<select"), field.indexOf("</select>"));
  assert.match(options, /<option value="">Not set<\/option>/);
  for (const c of TOOLING_CLASSIFICATIONS) {
    assert.doesNotMatch(
      options,
      new RegExp(`<option value="">[^<]*${c}`),
      `${c} is offered as the empty selection`,
    );
  }
  // And the initial state is the stored value, never a classification literal.
  assert.match(field, /useState<ToolingClassification \| "">\(value \?\? ""\)/);
});

test("the writer has no fallback — an absent classification stays absent", () => {
  // `null` in, `null` stored. A `?? "mould_collar"` anywhere on this path would
  // post every unclassified charge to the mould account silently, which is the
  // exact error the classification exists to prevent.
  for (const c of TOOLING_CLASSIFICATIONS) {
    assert.doesNotMatch(writer, new RegExp(`\\?\\?\\s*"${c}"`), `${c} is a fallback`);
    assert.doesNotMatch(field, new RegExp(`\\?\\?\\s*"${c}"`), `${c} is a fallback in the UI`);
  }
  assert.match(writer, /\.set\(\{ toolingClassification: input\.classification \}\)/);
});

test("nothing on this path reads a fact it could infer from", () => {
  // Not the owner, the SKU, the component type, the label or the amount. The
  // writer reads `label` and `ownerQuoteLeafId` only to WRITE them into the
  // audit row, so the check is that neither reaches the stored value.
  const setBlock = writer.slice(writer.indexOf(".set({"), writer.indexOf(".set({") + 200);
  for (const shape of [/label/, /owner/i, /sku/i, /amount/i, /cost/i]) {
    assert.doesNotMatch(setBlock, shape, "an inference input reached the stored value");
  }
  // In the UI, the component's props are the proof: there is nothing to infer
  // FROM. It receives the quote, the instance, the current value and nothing
  // describing the component.
  const props = field.slice(field.indexOf("}: {"), field.indexOf("}) {"));
  for (const shape of [/sku/i, /ownerRef/, /productName/, /amount/i, /charge\.label/]) {
    assert.doesNotMatch(props, shape, "an inference input reached the control");
  }
});

// ══════════════════════════════════════════════════════════════════════
// The closed set
// ══════════════════════════════════════════════════════════════════════

test("the writer accepts only the two governed values, or null", () => {
  assert.match(writer, /input\.classification !== null &&/);
  assert.match(writer, /TOOLING_CLASSIFICATIONS as readonly string\[\]\)\.includes/);
  assert.match(writer, /That is not a tooling classification\./);
});

test("the control offers exactly the governed set, derived not retyped", () => {
  // Mapped from TOOLING_CLASSIFICATIONS, so a third value cannot appear in the
  // UI without appearing in the authority and the DB enum first.
  assert.match(field, /TOOLING_CLASSIFICATIONS\.map\(\(c\) => \(/);
  assert.match(field, /TOOLING_CLASSIFICATION_LABELS\[c\]/);
  // And the labels are the operator vocabulary, not the storage keys.
  assert.equal(TOOLING_CLASSIFICATION_LABELS.mould_collar, "Mould / collar");
  assert.equal(TOOLING_CLASSIFICATION_LABELS.cutting_die, "Cutting die");
  for (const c of TOOLING_CLASSIFICATIONS) {
    assert.doesNotMatch(
      field,
      new RegExp(`<option value="${c}">`),
      "an option is hand-written rather than derived",
    );
  }
});

// ══════════════════════════════════════════════════════════════════════
// Scope — the instance, and only a tooling instance
// ══════════════════════════════════════════════════════════════════════

test("the control renders for tooling only", () => {
  // The other four component charge types each name exactly one destination, so
  // a control on them would ask a question with a single answer — and would
  // record a fact about nothing.
  assert.match(control, /charge\.chargeKey === "tooling" && \(\s*<ToolingClassificationField/);
});

test("the writer refuses a non-tooling charge, in code as well as by CHECK", () => {
  // Defence in depth. The CHECK constraint is the structural guarantee; this is
  // the one that returns a sentence an operator can read.
  assert.match(writer, /charge\.chargeKey !== "tooling"/);
  assert.match(writer, /Only a Tooling & dies charge carries an accounting classification\./);
});

test("the writer is scoped to the quote, not merely to the instance id", () => {
  // An instance id from another quote satisfies the primary key. Without the
  // quote predicate this surface would classify a different quote's charge.
  assert.match(writer, /eq\(quoteChargeInstances\.quoteId, input\.quoteId\)/);
});

test("the control passes an explicit instance id, never a position", () => {
  // Two Tooling charges on one component render adjacent identical controls.
  assert.match(field, /chargeInstanceId,/);
  for (const shape of [/index/i, /\[i\]/, /\.at\(/]) {
    assert.doesNotMatch(field, shape, "the control identifies a charge by position");
  }
});

// ══════════════════════════════════════════════════════════════════════
// Pattern 47, and the save-handler staleness trap
// ══════════════════════════════════════════════════════════════════════

test("the control is never disabled by pending", () => {
  // Pattern 47(e). `pending` drives the caption; it must not reach the element.
  const select = field.slice(field.indexOf("<select"), field.indexOf("</select>"));
  assert.match(select, /disabled=\{disabled\}/);
  assert.doesNotMatch(select, /disabled=\{[^}]*pending/, "pending disables the control");
});

test("the chosen value is passed explicitly, not read back from state", () => {
  // Save handler pattern. `setChoice` has not committed when `commit` runs, so
  // reading `choice` there writes the PREVIOUS selection — one step behind, on
  // every change, silently.
  assert.match(field, /setChoice\(v\);\s*commit\(v\);/);
  const commitFn = field.slice(field.indexOf("function commit("), field.indexOf("return ("));
  assert.doesNotMatch(commitFn, /\bchoice\b/, "commit reads state that has not committed");
});

test("a refused write restores the control rather than leaving it showing", () => {
  // A control still displaying a rejected value reads as saved.
  assert.match(field, /if \(!res\.ok\) \{\s*setChoice\(value \?\? ""\);/);
});

test("server truth wins when it changes underneath", () => {
  assert.match(field, /useEffect\(\(\) => \{\s*setChoice\(value \?\? ""\);\s*\}, \[value, chargeInstanceId\]\)/);
});

// ══════════════════════════════════════════════════════════════════════
// Freeze-list state, and the boundary it does not cross
// ══════════════════════════════════════════════════════════════════════

test("the writer asserts the quote is not frozen, explicitly", () => {
  // Pattern 52. `requireDraft` inside the loader is already stricter, and the
  // explicit call is what a grep for a writer of freeze-list state finds.
  assert.match(writer, /assertNotFrozen\(quote\)/);
});

test("it is a separate module, so update.ts's stated boundary stays true", () => {
  // `update.ts` says it writes cost and recovery ask "and nothing else ...
  // cannot change its type". Folding a third fact into it would make that
  // sentence a convention rather than a statement.
  const update = code("src/lib/component-charges/update.ts");
  assert.doesNotMatch(update, /toolingClassification/);
  assert.doesNotMatch(writer, /costAmount|recoveryAsk/);
});

test("the classification decides nothing about recovery", () => {
  // Two authorities. Included / separate decides whether a line EXISTS; this
  // decides what identity it uses. A destination is never assigned to make an
  // Included charge emit, so this path must not read a placement at all.
  for (const shape of [/placement/i, /"included"/, /"separate"/, /recovery_mode/]) {
    assert.doesNotMatch(writer, shape, "the classification writer reads a recovery decision");
    assert.doesNotMatch(field, shape, "the classification control reads a recovery decision");
  }
});

// ══════════════════════════════════════════════════════════════════════
// The audit row
// ══════════════════════════════════════════════════════════════════════

test("the audit records the transition, with both ends", () => {
  // From/to, so a later reader can tell a first statement from a correction
  // without joining anything — the same from/to convention the sibling
  // component-charge actions use.
  assert.match(writer, /action: "component_charge_tooling_classification_updated"/);
  assert.match(writer, /tooling_classification: \{ from: charge\.before, to: input\.classification \}/);
  assert.match(writer, /charge_instance_id: input\.chargeInstanceId/);
});

test("an unchanged value writes nothing at all", () => {
  // Re-selecting the same option is not an event. Without this it would write
  // an audit row saying the classification changed from X to X.
  assert.match(writer, /if \(charge\.before === input\.classification\) return;/);
});

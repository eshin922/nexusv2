// The banner is gone; its status and actions live inside the modules.
//
// The walk (`npm run validation:module-completion-walk`) drives the real
// actions and proves the BEHAVIOUR is unchanged — same rows, same audit
// entries, same refusals. It cannot see WHERE an operator reads and presses
// them, which is the whole of what this change moved. That is what is
// asserted here.
//
// Asserted against the SOURCE rather than by mounting: the three drilldowns
// need a quote, a costing store, a workbook and a dozen server actions to
// render at all, and a test that stubs all of that would be asserting against
// its own scaffolding.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const CONTROLS = "src/components/costs/module-completion.tsx";
const PAGE = "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx";

/** The body of a top-level `export function <name>(` declaration. */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`export function ${name}(`);
  assert.ok(at > 0, `no exported function named ${name}`);
  const next = src.indexOf("\nexport function ", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

test("the standalone banner is removed", () => {
  assert.equal(
    existsSync("src/components/costs/freight-handoff-bar.tsx"),
    false,
    "the duplicate banner is still on disk",
  );
  assert.doesNotMatch(
    read(PAGE),
    /FreightHandoffBar/,
    "the Costs page still mounts the banner the modules replaced",
  );
});

test("but nothing underneath it went with it", () => {
  // The three actions the banner called are the three the modules call. A
  // completion control that wrote its own state instead would be a second
  // source of truth for a fact `freight_handoffs` already holds.
  const src = read(CONTROLS);
  for (const action of [
    "markReadyForFreight",
    "withdrawFreightRequest",
    "completeFreightHandoff",
  ]) {
    assert.match(
      src,
      new RegExp(`\\b${action}\\b`),
      `${action} is no longer reached from any module`,
    );
  }
  // And they are reached from the handoff module itself, not reimplemented.
  assert.match(src, /from "@\/app\/actions\/freight-handoff"/);
});

test("each module carries its own control", () => {
  const modules: Array<[string, string]> = [
    ["src/components/costs/packaging-drilldown.tsx", "PackagingCompletion"],
    ["src/components/costs/production-drilldown.tsx", "ProductionCompletion"],
    ["src/components/costs/freight-drilldown.tsx", "FreightCompletion"],
  ];
  for (const [file, control] of modules) {
    const src = read(file);
    assert.match(src, new RegExp(`import \\{ ${control} \\}`), `${file} does not import ${control}`);
    assert.match(src, new RegExp(`<${control}\\s*/>`), `${file} imports ${control} but never renders it`);
  }
});

test("Packaging holds completion and reopening; Freight holds neither", () => {
  const src = read(CONTROLS);
  const packaging = bodyOf(src, "PackagingCompletion");
  assert.match(packaging, /markReadyForFreight/, "Packaging's Mark complete is not the freight request");
  assert.match(packaging, /withdrawFreightRequest/, "Packaging cannot reopen");
  assert.doesNotMatch(
    packaging,
    /completeFreightHandoff/,
    "Packaging offers the completion that belongs to whoever holds the work",
  );
});

test("Freight holds the assignee, the notification outcome and Mark complete", () => {
  const freight = bodyOf(read(CONTROLS), "FreightCompletion");
  assert.match(freight, /completeFreightHandoff/, "Freight cannot close the handoff");
  assert.match(freight, /assignedToEmail/, "Freight does not say who is holding it");
  // A delivery that failed is said out loud. Reporting it as a success would
  // leave a PM believing logistics had been told.
  assert.match(freight, /notificationStatus/, "Freight does not report the delivery outcome");
  assert.match(freight, /"failed"/, "a failed Slack delivery is not distinguished");
  assert.match(freight, /"not_configured"/, "an unconfigured Slack is not distinguished");
});

test("Freight's control is not gated on the quote being editable", () => {
  // Freight work continues after a quote is sent. The action is deliberately
  // not draft-gated for that reason; gating the CONTROL on `editable` would
  // hide it in exactly the state the work is most often done in, and the
  // action's own permissiveness would never be reachable.
  const freight = bodyOf(read(CONTROLS), "FreightCompletion");
  assert.doesNotMatch(
    freight,
    /\beditable\b/,
    "Freight's Mark complete disappears once the quote is no longer a draft",
  );
  // The sibling controls DO carry it — otherwise the assertion above would
  // pass for the uninteresting reason that nothing on this surface reads it.
  for (const name of ["PackagingCompletion", "ProductionCompletion"]) {
    assert.match(
      bodyOf(read(CONTROLS), name),
      /\beditable\b/,
      `${name} no longer carries the quote's edit permission`,
    );
  }
});

test("the page reads the LATEST handoff, not the open one", () => {
  // Reading only the open row would make both modules report that the work had
  // never been handed over the moment logistics finished it — because it had
  // been handed over and finished. Covered behaviourally by §2c of the walk;
  // pinned here because the call site is what chooses between the two reads.
  const page = read(PAGE);
  assert.match(page, /getLatestFreightHandoff\(quote\.id\)/);
  assert.doesNotMatch(
    page,
    /getFreightHandoff\(quote\.id\)/,
    "the Costs page is back on the open-only read",
  );
});

test("Production is the only module given new state", () => {
  const src = read(CONTROLS);
  // Packaging and Freight render from the handoff. If either grew its own
  // completion record, the two would be able to disagree about one fact.
  for (const name of ["PackagingCompletion", "FreightCompletion"]) {
    assert.doesNotMatch(
      bodyOf(src, name),
      /production-completion|markProductionComplete|reopenProduction/,
      `${name} reaches for Production's state`,
    );
  }
  assert.match(bodyOf(src, "ProductionCompletion"), /markProductionComplete/);
});

test("the drawer toolbar can carry the control at narrow widths", () => {
  // The canonical R6 toolbar is a two-child space-between row with no wrap.
  // The completion control is a third thing competing for it: at 380px the
  // toolbar overflowed horizontally by 14px, with the control pushed past its
  // right edge — measured in the isolated harness, and measured again at 0
  // across 1100/720/480/380/340px once it wraps.
  //
  // Pinned because the rule lives in a separate file (the canonical stylesheet
  // stays verbatim per Pattern 30), and a file nothing imports is a file that
  // silently stops applying.
  assert.match(
    read("src/app/globals.css"),
    /@import "\.\.\/styles\/module-completion\.css";/,
    "the completion control's stylesheet is no longer loaded",
  );
  assert.match(read("src/styles/module-completion.css"), /flex-wrap:\s*wrap/);
  // And the canonical file is still the canonical file.
  assert.doesNotMatch(
    read("src/styles/r6-costs.css"),
    /mod-complete/,
    "a nexus extension was edited into the verbatim R6 stylesheet",
  );
});

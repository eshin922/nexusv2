// Product Setup wiring — THREE distinct operator intentions.
//
//   Add Product        browse the library, attach an EXISTING product to the
//                      quote as a standalone Direct Product (assembly_id NULL)
//   Create Item Group  create quote-local grouping structure. Not a product.
//                      Writes nothing to the Nexus/HubSpot product library.
//   Create New Product library master data — a new reusable library product.
//                      Never offers an Item Group as a kind of "product".
//
// Neither structural action implies the other; grouping is never inferred from
// product count.
//
// WHAT THE EARLIER VERSION OF THIS FILE ESTABLISHED, AND WHAT IT DID NOT.
// It asserted that two correctly-labelled triggers existed and that the two
// ATTACH writers never crossed over. Both were true, and both still pass. They
// did not establish GROUPED-CREATION REACHABILITY, and finding B-1 lived in
// exactly that gap: "+ Add Item Group" opened a Library that can only attach
// into a group that already exists, so on a quote with zero groups every row
// was disabled and the only route to `createAssembly` ran through a product-
// creation screen nested inside that same Library. A grep for `mode="group"`
// cannot fail when the capability behind the mode is missing — the instrument
// could not express the defect it was read as excluding.
//
// The reachability walk below can. It is falsified against a reconstruction of
// the pre-repair wiring, so its ability to FAIL is demonstrated rather than
// assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

/** Source with comments removed — comments may keep internal vocabulary. */
async function code(p: string): Promise<string> {
  return (await read(p))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");
}

// ----------------------------------------- B-1 · grouped-creation reachability

/**
 * Can an operator on a quote with ZERO Item Groups reach Item Group creation?
 *
 * Walks the module graph link by link from the setup surface to the writer and
 * names the failing link, so a break anywhere on the path is reported rather
 * than reduced to a boolean. Takes source TEXT rather than reading files, so
 * the same walk can be run against a reconstruction of the pre-repair wiring.
 */
function reachesItemGroupCreation(src: {
  view: string;
  trigger: string;
  modal: string;
}): { reachable: true } | { reachable: false; broken: string } {
  const view = src.view
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");

  if (!/<CreateItemGroupTrigger\b/.test(view))
    return { reachable: false, broken: "setup surface renders no create-item-group action" };

  // The action must not be conditional on an Item Group already existing.
  // That inversion IS the defect, not a milder form of it.
  if (/\{\s*assembl\w*\.length\s*>\s*0\s*\?\s*\([\s\S]{0,400}?<CreateItemGroupTrigger/.test(view))
    return { reachable: false, broken: "create action is gated on an existing Item Group" };

  if (!/CreateItemGroupModal/.test(src.trigger))
    return { reachable: false, broken: "trigger opens no item-group creation surface" };
  if (/LibraryBrowse/.test(src.trigger))
    return { reachable: false, broken: "trigger routes through the Library first" };

  if (!/createAssembly\(fd\)/.test(src.modal))
    return { reachable: false, broken: "creation surface never calls createAssembly" };

  return { reachable: true };
}

async function currentSources() {
  return {
    view: await read("src/components/assembly-tree/assembly-tree-view.tsx"),
    trigger: await read("src/components/assembly-tree/create-item-group-trigger.tsx"),
    modal: await read("src/components/item-group/create-item-group-modal.tsx"),
  };
}

test("B-1 · from a zero-group quote, Create Item Group reaches creation without the Library", async () => {
  assert.deepEqual(reachesItemGroupCreation(await currentSources()), {
    reachable: true,
  });
});

test("B-1 · the reachability walk can express the original failure", async () => {
  // Falsification. Without it, a walk that always returned `reachable` would
  // pass exactly as quietly as the label greps it replaces.
  const preRepair = {
    view: '<LibraryBrowseTrigger mode="direct" />\n<LibraryBrowseTrigger mode="group" />',
    trigger: "",
    modal: "",
  };
  const before = reachesItemGroupCreation(preRepair);
  assert.equal(before.reachable, false);
  assert.match(
    (before as { broken: string }).broken,
    /renders no create-item-group action/,
  );

  // And the narrower regression this repair could still slip into: the action
  // present, but gated on the very thing it exists to create.
  const gated = reachesItemGroupCreation({
    ...(await currentSources()),
    view: "{assemblyTargets.length > 0 ? (\n  <CreateItemGroupTrigger />\n) : null}",
  });
  assert.equal(gated.reachable, false);
  assert.match(
    (gated as { broken: string }).broken,
    /gated on an existing Item Group/,
  );
});

// ------------------------------------------------- three distinct intentions
test("Add Product remains the Direct Product path", async () => {
  const view = await code("src/components/assembly-tree/assembly-tree-view.tsx");
  assert.match(view, /mode="direct"/);
  assert.match(
    await read("src/components/library/library-browse-trigger.tsx"),
    /\+ Add Product/,
  );
  // The single consolidated CTA is gone — it could only produce grouped
  // structure, so leaving it would have left grouping as the default.
  assert.doesNotMatch(view, /\+ Add component/);
});

test("Create Item Group writes quote structure and nothing to the library", async () => {
  const modal = await read("src/components/item-group/create-item-group-modal.tsx");
  assert.match(modal, /createAssembly/);
  // An Item Group is not library master data. Calling a library writer here
  // would merge the two capabilities again.
  assert.doesNotMatch(modal, /createLeaf|createProduct/);
});

test("Create New Product is library master data only — no Item Group branch", async () => {
  const src = await read("src/components/add-product/add-product-modal.tsx");
  assert.match(src, /createLeaf/);
  // The ASY branch, its writer, and the toggle that presented an Item Group as
  // a second kind of product are all gone.
  assert.doesNotMatch(src, /createAssembly/);
  assert.doesNotMatch(src, /a1v2-mode-toggle/);
  assert.doesNotMatch(
    await code("src/components/add-product/add-product-modal.tsx"),
    /\bASY\b/,
  );
});

test("the two structural peers carry equal visual weight", async () => {
  // A ghost beside a filled button is not a peer — it reads as secondary
  // chrome, which is how the grouped choice stayed unnoticed even after B-1
  // made it reachable. Both are primary.
  assert.match(
    await read("src/components/assembly-tree/create-item-group-trigger.tsx"),
    /className="a1v2-btn primary sm"/,
  );
  assert.match(
    await read("src/components/library/library-browse-trigger.tsx"),
    /isDirect \? "primary" : "ghost"/,
  );
});

test("adding products into a group lives on that group's row, not the quote head", async () => {
  const view = await code("src/components/assembly-tree/assembly-tree-view.tsx");
  // No quote-level grouped entry. It had to ask which group in a menu, and on
  // a quote with no groups the question had no answer.
  assert.doesNotMatch(view, /mode="group"/);

  const row = await code("src/components/assembly-tree/asy-row.tsx");
  assert.match(row, /mode="group"/);
  // The destination is the row the operator acted on — already chosen, so the
  // picker has nothing left to ask.
  assert.match(row, /initialTargetAssemblyId=\{asy\.id\}/);
});

test("an explicit destination survives the modal's auto-select", async () => {
  const modal = await code("src/components/library/library-browse-modal.tsx");
  // Re-applied on every open: one modal instance serves a different group each
  // launch, so a carried-over target would attach to the wrong one.
  assert.match(
    modal,
    /if \(initialTargetAssemblyId\) \{\s*setTargetAssemblyId\(initialTargetAssemblyId\);\s*return;/,
  );
  // And it is checked BEFORE the fall-back to assemblies[0].
  const explicit = modal.indexOf("setTargetAssemblyId(initialTargetAssemblyId)");
  const fallback = modal.indexOf("setTargetAssemblyId(assemblies[0].id)");
  assert.ok(explicit > 0 && fallback > 0 && explicit < fallback);
});

// --------------------------------------------------------------- routing
test("the two actions route to two different writers", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // Chosen by the operator's explicit mode, never by product count and never
  // by falling back from one writer to the other.
  assert.match(src, /direct\s*\?\s*await attachQuoteProduct\(fd\)/);
  assert.match(src, /:\s*await attachAssemblyLeaf\(fd\)/);
  assert.doesNotMatch(src, /assemblies\.length\s*===\s*0\s*\?\s*await attachQuoteProduct/);
});

test("direct mode needs no item group to be attachable", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // Gating Add Product on an existing group would make it impossible on the
  // very quote it exists to serve — one with no groups at all.
  assert.match(src, /attachReady = mode === "direct" \|\| Boolean\(targetAssemblyId\)/);
});

// ------------------------------------------------------------- rendering
test("Direct Products render as first-class rows beside Item Groups", async () => {
  const src = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  assert.match(src, /tree\.directProducts\.map/);
  assert.match(src, /<DirectProductRow/);
  // Peer, not nested: the direct map must not be inside the assembly map.
  const directAt = src.indexOf("tree.directProducts.map");
  const asyAt = src.indexOf("orderedAssemblies.map");
  assert.ok(directAt > 0 && asyAt > 0);
  assert.ok(directAt < asyAt, "Direct Products render before Item Groups");
});

test("a Direct-only quote is not treated as empty", async () => {
  const src = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  // The empty state must consider BOTH collections. Gating on assemblies alone
  // would render a Direct-only quote as if nothing had been added.
  assert.match(
    src,
    /orderedAssemblies\.length === 0 &&\s*tree\.directProducts\.length === 0/,
  );
  assert.doesNotMatch(src, /No assemblies\./);
});

test("the loader reads Direct attachments from the database", async () => {
  const src = await read("src/lib/assembly-tree.ts");
  // Persistence is what makes a Direct Product survive reload and navigation:
  // the row is read from quote_leaves on every render, never held in client
  // state.
  assert.match(src, /isNull\(quoteLeaves\.assemblyId\)/);
  // And the zero-assembly early return must not short-circuit past it.
  assert.match(
    src,
    /asmRows\.length === 0 && directRows\.length === 0/,
  );
});

test("the row shows operator identity and no internal ids", async () => {
  const src = await read("src/components/assembly-tree/direct-product-row.tsx");
  assert.match(src, /product\.name/);
  assert.match(src, /product\.sku/);
  // quoteLeafId is used as a React key and as the detach argument — never
  // rendered as text for the operator to read.
  assert.doesNotMatch(src, />\{product\.quoteLeafId\}</);
  assert.doesNotMatch(src, /junctionId/);
  assert.doesNotMatch(src, /compositionHash/);
});

// ------------------------------------------------------ no silent grouping
test("Add Product creates no assembly anywhere in its path", async () => {
  for (const file of [
    "src/app/actions/quote-products.ts",
    "src/lib/product-structure/direct-attachment.ts",
  ]) {
    const src = await code(file);
    assert.doesNotMatch(src, /insert\(assemblies\)/);
    assert.doesNotMatch(src, /createAssembly/);
  }
});

test("the grouped path still creates the grouped structure", async () => {
  const src = await read("src/app/actions/assemblies.ts");
  assert.match(src, /attachGroupedMembership/);
  assert.match(src, /insert\(assemblies\)/);
});

// -------------------------------------------------------------- ASY copy
test("ASY has left the operator vocabulary of this workflow", async () => {
  const operatorFiles = [
    "src/components/assembly-tree/assembly-tree-view.tsx",
    "src/components/assembly-tree/asy-row.tsx",
    "src/components/assembly-tree/asy-context-menu.tsx",
    "src/components/assembly-tree/asy-notes-drawer.tsx",
    "src/components/assembly-tree/leaf-context-menu.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
    "src/components/library/library-browse-trigger.tsx",
  ];
  for (const file of operatorFiles) {
    // ASY may remain as an internal implementation term in comments — the
    // requirement is that it never reaches the operator.
    assert.doesNotMatch(
      await code(file),
      /\bASY\b/,
      `${file} still shows ASY to operators`,
    );
  }
});

// ------------------------------------------------------- eligibility gate
test("the SKU-less gate guards the new attach path too", async () => {
  const src = await read("src/app/actions/quote-products.ts");
  assert.match(src, /evaluateAttachmentEligibility/);
  // Refuses before writing anything, so no partial attachment can exist.
  const gateAt = src.indexOf("evaluateAttachmentEligibility");
  const writeAt = src.indexOf("attachDirectProductRow");
  assert.ok(gateAt > 0 && writeAt > 0 && gateAt < writeAt);
});

test("the gate blocks NEW attachment only — history stays readable", async () => {
  // Nothing in the read path may filter on SKU presence. A quote that already
  // contains a SKU-less product must still render exactly as it did.
  const loader = await read("src/lib/assembly-tree.ts");
  assert.doesNotMatch(loader, /evaluateAttachmentEligibility/);
  assert.doesNotMatch(loader, /hasUsableSku/);
  // The row renders a placeholder rather than refusing to draw.
  const row = await read("src/components/assembly-tree/direct-product-row.tsx");
  assert.match(row, /product\.sku \?\? "—"/);
});

// ------------------------------------------------------- mixed structure
test("mixed structure projects both, and drops neither", async () => {
  const src = await read("src/lib/netsuite/mark-complete.ts");
  // Certified by P1 (SO2713): a group beside a flat line for an item in no
  // group produces no duplication. The blanket refusal is gone.
  assert.doesNotMatch(src, /Projecting both structures into one Sales Order is not yet/);
  // What replaced it matters more than its removal: Direct lines are now
  // EMITTED alongside groups. The previous `lines: []` would have dropped them
  // silently the moment the refusal lifted.
  assert.match(src, /lines: directLines/);
  assert.match(src, /groupMemberItemIds: expandedMemberItemIds/);
});

test("the surviving guard is membership-based and sits in the builder", async () => {
  const src = await read("src/lib/netsuite/sales-orders.ts");
  // Probe 7a established that a group's OWN members duplicate. That remains
  // permanently true and is now enforced precisely, one layer below Complete.
  assert.match(src, /already expands/);
  assert.match(src, /groupMemberItemIds/);
  // Undeclared membership is refused rather than assumed safe.
  assert.match(src, /membership cannot be checked/);
});

test("editing a mixed quote is never blocked", async () => {
  // The uncertified condition matters at the irreversible downstream boundary
  // and nowhere else. An operator may freely build a mixed quote.
  for (const file of [
    "src/app/actions/quote-products.ts",
    "src/app/actions/assemblies.ts",
    "src/lib/assembly-tree.ts",
  ]) {
    const src = await read(file);
    assert.doesNotMatch(src, /not yet certified/);
    assert.doesNotMatch(src, /mixes .* Item Group/);
  }
});

// ───────────── §9.4 · eligibility-state surfacing (scoped) ─────────────
//
// Makes the ALREADY-ENFORCED refusal visible before the operator spends an
// action on it. Deliberately ONE state — "no SKU" — because
// it is the only one of §8's five that is authoritative, locally knowable, and
// has real instances (47). The other four remain vocabulary.
//
// The property that matters most is single-classifier: surfacing and refusal
// must be the same verdict, or the badge becomes a second opinion that can
// disagree with the gate.

test("the loader returns the SERVER's eligibility verdict, not a flag", async () => {
  const src = await read("src/lib/library-browse-loader.ts");
  assert.match(src, /evaluateAttachmentEligibility\(\{ sku: r\.sku, archived: r\.archived \}\)/);
  assert.match(src, /eligibility: AttachmentEligibility/);
});

test("the client never re-derives eligibility", async () => {
  // Comments stripped — the rationale comment names the function it must not
  // call, which is exactly the distinction being asserted.
  const src = await code("src/components/library/library-browse-modal.tsx");
  // No second classifier: the modal must not inspect SKUs to decide
  // attachability. A local rule could disagree with the gate, and the
  // disagreement would surface as a product that looks attachable and is
  // refused — or looks refused and is not.
  assert.doesNotMatch(src, /hasUsableSku/);
  assert.doesNotMatch(src, /evaluateAttachmentEligibility/);
  assert.doesNotMatch(src, /row\.sku\s*(===|!==|\?\?)\s*(null|"")/);
  // It consumes the verdict instead.
  assert.match(src, /row\.eligibility\.attachable/);
  assert.match(src, /row\.eligibility\.reason === "missing_sku"/);
});

test("an ineligible product is marked AND cannot be attempted", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  assert.match(src, /no SKU/);
  // Preventative, not a replacement: the button is disabled by the same verdict.
  assert.match(src, /!row\.eligibility\.attachable \|\|\s*\n\s*!attachReady/);
});

test("the disabled control states the reason, in the server's words", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // Pattern 47(f): a disabled control must communicate why. Reusing the gate's
  // message means the operator reads the same sentence whether they hover the
  // button or trigger the refusal.
  assert.match(src, /!row\.eligibility\.attachable\s*\n\s*\?\s*row\.eligibility\.message/);
});

test("server enforcement remains authoritative and unchanged", async () => {
  // The gate is untouched by the surfacing work — both attach paths still call
  // it, and it still refuses independently of anything the client believes.
  for (const file of [
    "src/app/actions/assemblies.ts",
    "src/app/actions/quote-products.ts",
  ]) {
    assert.match(await read(file), /evaluateAttachmentEligibility/);
  }
});

test("no new state semantics were introduced", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // §8's other four states stay vocabulary: no HubSpot-health, historical-only,
  // downstream-ambiguity, snapshot/current or NetSuite-resolution surface.
  for (const forbidden of [
    /hubspot.?health/i,
    /historical.only/i,
    /ambiguous/i,
    /netsuite.?resolution/i,
    /degraded/i,
  ]) {
    assert.doesNotMatch(src, forbidden);
  }
});

test("healthy and archived rows keep their existing presentation", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // The readiness pill still renders for everything the gate permits, and
  // archived keeps its own pill — that state has a Restore path, so replacing
  // it would remove an affordance rather than add information.
  assert.match(src, /status-pill \$\{readiness\}/);
  assert.match(src, /readiness === "archived"/);
  assert.match(src, /lib-restore-btn/);
});

// ------------------------------------------------ B-3 · library spec authority
test("the spec action names the authority it edits", async () => {
  // Specs are library master data. "Edit specs", read from inside a quote,
  // invites the operator to believe it is quote-local. It is not.
  for (const f of [
    "src/components/assembly-tree/leaf-context-menu.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
  ]) {
    assert.match(await read(f), /Edit product specs/);
  }
});

test("usage is counted in QUOTES, not attachment rows", async () => {
  const src = await code("src/lib/assembly-tree.ts");
  // A raw count(*) counts attachments, and a leaf attached to two Item Groups
  // in one quote would report its own sibling as another use.
  assert.match(src, /count\(distinct \$\{quoteLeaves\.quoteId\}\)/);
  assert.doesNotMatch(src, /n: sql<number>`count\(\*\)::int`/);
});

test("the usage caption is gone from the quote tree entirely", async () => {
  // B-3 item 4 demoted this to neutral wording; B-8 removed it. Superseded
  // rather than deleted, so the file still records that this surface must make
  // no cross-quote claim — the strongest form of which is saying nothing.
  for (const f of [
    "src/components/assembly-tree/asy-row.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
  ]) {
    const src = await read(f);
    assert.doesNotMatch(src, /other use/);
    assert.doesNotMatch(src, /this scenario only/);
  }
});

// -------------------------------------------- B-4B · no dead operator commands
test("the member menu renders no disabled command", async () => {
  const src = await read("src/components/assembly-tree/leaf-context-menu.tsx");
  // Move up, Move down, Move to another item group, View library record. None
  // was a capability; a rendered command that cannot run teaches the operator
  // that the menu is unreliable, and the doubt transfers to the items that work.
  for (const gone of [
    "Move up",
    "Move down",
    "Move to another item group",
    "View library record",
  ]) {
    assert.doesNotMatch(src, new RegExp(`>\s*${gone}\s*<`), `${gone} still rendered`);
  }
  assert.doesNotMatch(src, /aria-disabled="true"/);
});

test("both surviving member actions are wired", async () => {
  const src = await read("src/components/assembly-tree/leaf-context-menu.tsx");
  assert.match(src, /href=\{editSpecsHref\}/);
  assert.match(src, /detachAssemblyLeaf\(fd\)/);
});

// ------------------------------------------------ B-4A · restoration to the DA
test("the Item Group row declares one column per rendered cell", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  // Eight cells rendered: the canonical six plus notes trigger and
  // + Add products. Implicit-row wrapping is what broke the seal between the
  // group header and .a1v2-leaves.
  assert.match(
    css,
    /\.a1v2-asy-row:not\(\.a1v2-direct-row\)\s*\{[^}]*grid-template-columns:\s*24px 90px 1fr auto auto auto auto auto/,
  );
});

test("Item Group identity does not depend on being populated", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  assert.match(
    css,
    /\.a1v2-asy-row:not\(\.a1v2-direct-row\)\s*\{[^}]*border-left-color:\s*var\(--accent\)/,
  );
  // The Direct Product carries the rule TRANSPARENT after the shell
  // reconciliation: the 3px box reserves shared geometry, the marking itself
  // belongs to the Item Group alone.
  assert.match(css, /\.a1v2-asy-row\.a1v2-direct-row\s*\{[^}]*border-left-color: transparent/);
  // Expanded keeps a SEPARATE signal, so "what this is" and "whether it is
  // open" stay legible as different things.
  assert.match(
    await read("src/styles/r-a1v2-setup.css"),
    /\.a1v2-asy-row\.expanded \{[^}]*background:/,
  );
});

test("the generated ASY placeholder never reaches the operator", async () => {
  const helper = await read("src/lib/product-structure/assembly-display-sku.ts");
  // Reconstructs the exact generated string rather than matching /^ASY-/, so an
  // operator who genuinely types "ASY-7" keeps their own value.
  assert.match(helper, /const prefix = `ASY-\$\{quoteId\.slice\(0, 8\)\}-`/);
  const row = await read("src/components/assembly-tree/asy-row.tsx");
  assert.match(row, /assemblyDisplaySku\(asy\.sku, quoteId\)/);
  assert.doesNotMatch(row, /sku-pill">\{asy\.sku\}/);
});

test("suppression is display-only — no writer touches the stored SKU", async () => {
  const helper = await read("src/lib/product-structure/assembly-display-sku.ts");
  assert.doesNotMatch(helper, /db\.|update\(|insert\(/);
  // The generator is untouched: the stored value still carries certified
  // NetSuite projection and audit identity.
  assert.match(
    await read("src/app/actions/assemblies.ts"),
    /`ASY-\$\{quoteId\.slice\(0, 8\)\}-\$\{nextPosition \+ 1\}`/,
  );
});

// ------------------------------------------ B-3 · quote-owned spec authority
test("B-3 · no quote-context reader resolves Library is_current", async () => {
  // Falsification 11. Every one of these serves a QUOTE. If any resolves the
  // Library default, that quote is reading master data it does not own — the
  // defect B-3 removed, and one that is silent in both directions.
  for (const f of [
    "src/lib/addendum-loader.ts",
    "src/lib/assembly-tree.ts",
  ]) {
    const src = await code(f);
    assert.doesNotMatch(src, /isCurrent/, `${f} still resolves Library is_current`);
    assert.match(src, /eq\(leafSpecs\.quoteId, quoteId\)/, `${f} is not quote-scoped`);
  }
});

test("B-3 · the spec surface must be told which authority it edits", async () => {
  const loader = await code("src/lib/leaf-spec-loader.ts");
  // No default. The two candidates are "this quote" and "every future quote",
  // and guessing wrong is silent either way.
  assert.match(loader, /scope: \{ quoteId: string \} \| \{ library: true \}/);
  assert.match(
    await code("src/app/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs/page.tsx"),
    /loadLeafForSpecEntry\(leafId, \{ quoteId \}\)/,
  );
});

test("B-3 · quote-side writers never touch Library master data", async () => {
  const src = await code("src/app/actions/leaf-specs.ts");
  // leaves.product_type_id is the Library default for FUTURE attachments.
  // Retyping from inside a quote must not retype every other quote.
  assert.doesNotMatch(src, /update\(leaves\)/);
  // Scope is READ, never defaulted. The two candidates are "this quote" and
  // "the template every future quote starts from", and a wrong guess is silent
  // in both directions — so the caller states it and the action refuses
  // anything it does not recognise.
  assert.match(src, /function readScope\(/);
  assert.match(src, /quoteId required/);
  assert.match(src, /unknown scope/);
  // The library branch resolves the default row; the quote branch never can.
  assert.match(src, /isNull\(leafSpecs\.quoteId\)/);
  assert.match(src, /eq\(leafSpecs\.quoteId, scope\.quoteId\)/);
});

test("B-3 · attachment instantiates the authority, and reuses it", async () => {
  for (const f of [
    "src/lib/product-structure/direct-attachment.ts",
    "src/lib/product-structure/grouped-membership-compatibility.ts",
  ]) {
    const src = await code(f);
    assert.match(src, /ensureQuoteSpecAuthority/, `${f} does not instantiate`);
    assert.match(src, /leafSpecVersionId: authority\.id/, `${f} does not pin`);
  }
  const authority = await code("src/lib/product-structure/quote-spec-authority.ts");
  // Idempotent: the second and third attachment of one product to one quote
  // resolve to the SAME row, or two appearances could silently diverge.
  assert.match(authority, /if \(existing\.length > 0\) return toAuthority\(existing\[0\]\)/);
  // Quote rows opt out of the Library-scope flag.
  assert.match(authority, /isCurrent: false/);
});

// --------------------------------------- B-5/B-6/B-7 · the surfaces say the rule
test("B-5 · the cascade panel is gone from the operator surface entirely", async () => {
  // First it lost its false lifecycle model (WILL UPDATE / STAYS PINNED /
  // auto-update); then it lost its remaining line too. Under B-3 isolation a
  // cross-quote usage count changes no decision on either surface, so what
  // survived the rewrite was a fact with nothing to inform.
  const { access } = await import("node:fs/promises");
  let exists = true;
  try {
    await access(path.join(root, "src/components/spec-entry/cascade-warning.tsx"));
  } catch {
    exists = false;
  }
  assert.equal(exists, false, "cascade-warning.tsx should be deleted");

  const src = await code("src/components/spec-entry/spec-entry-surface.tsx");
  assert.doesNotMatch(src, /CascadeWarning/);
  for (const dead of ["WILL UPDATE", "STAYS PINNED", "auto-update"]) {
    assert.ok(!src.includes(dead), dead);
  }
  // Not a blanket "other quote" ban — the scope copy legitimately says
  // "Library defaults and other quotes are not changed". What must be gone is
  // the COUNT, which is what carried no decision.
  assert.doesNotMatch(src, /Used in \{/);
  // And the sibling that stated the same fact in different units.
  assert.doesNotMatch(src, /item group\{refCount/);
});

test("B-6 · each surface states which authority it edits", async () => {
  const src = await read("src/components/spec-entry/spec-entry-surface.tsx");
  assert.match(src, /Default specifications/);
  assert.match(src, /Used as the starting point for future quotes\. Existing quotes are not changed\./);
  assert.match(src, /Quote specifications/);
  assert.match(src, /Changes apply only to this quote\. Library defaults and other quotes are not changed\./);
  // Driven by the same scope the writes use, so the sentence cannot disagree
  // with what the page actually does.
  assert.match(src, /const isLibrary = "library" in scope/);
});

test("B-7 · no operator-facing ASY on the spec surfaces", async () => {
  for (const f of [
    "src/components/spec-entry/spec-entry-surface.tsx",
    "src/app/library/leaves/[leafId]/defaults/page.tsx",
  ]) {
    assert.doesNotMatch(await code(f), /\bASY\b/, `${f} still shows ASY`);
  }
  // The generated ASY-* identifiers went with the reference list they were in.
  // "Used in N item groups" replaced "Referenced by N ASYs" here, and has since
  // gone too: it stated the same cross-quote fact in different units as the
  // usage line beside it, so removing one and keeping the other would have left
  // the density unchanged and the page inconsistent.
  assert.doesNotMatch(
    await read("src/components/spec-entry/spec-entry-surface.tsx"),
    /item group|refCount/,
  );
});

test("B-5/B-6 repair changed no authority behaviour", async () => {
  // The scope discriminator, the writers and the resolver are untouched by
  // this repair — it is copy and presentation only.
  const authority = await code("src/lib/product-structure/quote-spec-authority.ts");
  assert.match(authority, /ensureQuoteSpecAuthority/);
  assert.match(authority, /isCurrent: false/);
  assert.match(await code("src/app/actions/leaf-specs.ts"), /function readScope\(/);
});

// -------------------------------------------------- B-8 · row density
test("B-8 · cross-quote usage is gone from the quote tree", async () => {
  // Under B-3 isolation it changes no quote-side decision — this quote owns its
  // specification, so where else the product is used cannot affect what the
  // operator does here. Reuse belongs to the Library context.
  for (const f of [
    "src/components/assembly-tree/asy-row.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
  ]) {
    const src = await code(f);
    assert.doesNotMatch(src, /leaf-refs/, `${f} still renders the usage cell`);
    assert.doesNotMatch(src, /other quote/, `${f} still renders usage copy`);
  }
});

test("B-8 · the member row reclaims the freed column for identity", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  // Five cells now, and the 1fr identity column takes the width back.
  assert.match(
    css,
    /\.a1v2-leaf-row \{\s*grid-template-columns: 60px 110px 1fr auto auto;/,
  );
});

test("B-8 · the type tag uses the DA's quiet register, untyped stays actionable", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  // Demoted to the register the DA already uses on Item Group rows.
  assert.match(
    css,
    /\.a1v2-leaf-row \.type-tag\.leaf-type \{[^}]*color: var\(--ink-4\)[^}]*background: var\(--paper-3\)[^}]*border-color: transparent/,
  );
  // But "no type set" needs doing, so it keeps the warning register — restated
  // after the demotion so the cascade cannot flatten it.
  assert.match(
    css,
    /\.a1v2-leaf-row \.type-tag\.leaf-type\.untyped \{[^}]*color: var\(--bad\)/,
  );
  // The readiness chip is untouched: primary by subtraction, not amplification.
  assert.doesNotMatch(css, /\.a1v2-chip\.(complete|partial|empty|no_type)/);
});

// ------------------------------------- B-4/B-10 · one visual system
test("B-10 · a Direct Product renders in the PRODUCT register", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  // Register represents structural ROLE. A Direct Product is a product, and it
  // was wearing the Item Group's container typography — so a container and a
  // product were typographically identical.
  assert.match(css, /\.a1v2-direct-row \.name-cell \.name \{[^}]*font-style: normal[^}]*font-size: 12\.5px/);
  assert.match(css, /\.a1v2-direct-row \.sku-pill \{[^}]*background: none/);
  // Independence stays in POSITION — root placement, no connector, no child
  // inset — not in container styling. The 3px rule is transparent rather than
  // removed so the border box still reserves shared geometry.
  assert.match(css, /\.a1v2-direct-row \{[^}]*grid-template-columns: 110px 1fr auto auto auto/);
  assert.match(css, /\.a1v2-direct-row \{[^}]*padding: 10px 16px/);
  assert.match(css, /\.a1v2-direct-row \{[^}]*border-left-color: transparent/);
  // The inert diamond is gone, and its column with it — a meaningless glyph is
  // not improved by replacing it with meaningless whitespace.
  assert.doesNotMatch(await code("src/components/assembly-tree/direct-product-row.tsx"), /twirl/);
});

test("B-10 · row-level secondary actions converge on the overflow grammar", async () => {
  const src = await code("src/components/assembly-tree/direct-product-row.tsx");
  assert.match(src, /className="context-trigger"/);
  assert.match(src, /a1v2-context-menu/);
  // Same handlers, different place. Semantics unchanged.
  assert.match(src, /href=\{editSpecsHref\}/);
  assert.match(src, /onClick=\{handleRemove\}/);
  // The inline pair is gone.
  assert.doesNotMatch(src, /className="a1v2-btn ghost sm"/);
});

test("B-10 · an absent Item Group SKU renders no pill, and the duplicate type signal is gone", async () => {
  const asy = await code("src/components/assembly-tree/asy-row.tsx");
  // A filled accent pill around an em dash reads as broken, not as absent.
  assert.match(asy, /displaySku \? \(\s*<span className="sku-pill">\{displaySku\}<\/span>/);
  assert.doesNotMatch(asy, /sku-pill">\{displaySku \?\? /);
  // NO TYPE SET already carries the actionable condition; valid metadata stays.
  // Superseded by the type-cell move: the meta line no longer carries type at
  // all, so the duplicate is gone by relocation rather than by a conditional.
  const direct = await code("src/components/assembly-tree/direct-product-row.tsx");
  assert.doesNotMatch(direct, /className="sep"[\s\S]{0,80}type-tag/);
});

test("B-10 · displayed type and readiness resolve from named authorities", async () => {
  // SUPERSEDED BY STEP 4, deliberately, and rewritten rather than deleted.
  //
  // B-10 originally required ONE authority behind both, because the defect was
  // a product typed in the Library reading `untyped` in Setup. The cutover
  // fixes that at the source instead: display is HubSpot's classification read
  // LIVE, so the two surfaces cannot disagree about what a product is.
  //
  // Readiness is now a SECOND, different authority on purpose — the pinned
  // Spec Schema — because it answers a different question: which fields these
  // values were authored against. Freezing one and not the other is the point.
  // What must never return is a THIRD authority nobody maintains, so the
  // assertion is that neither reads the retired Nexus taxonomy.
  const src = await code("src/lib/assembly-tree.ts");
  assert.match(src, /productType: typeValue/);
  assert.match(src, /specCompleteness: computeSpecCompleteness\(schema/);
  assert.doesNotMatch(src, /leaf\.productTypeId/);
});

test("B-10 · the generic Product label is replaced by the quote-owned type", async () => {
  const src = await code("src/components/assembly-tree/direct-product-row.tsx");
  assert.doesNotMatch(src, /leaf-count">Product</);
  // Same register as member rows — one product grammar, not two.
  assert.match(src, /type-tag leaf-type\$\{product\.productType \? "" : " untyped"\}/);
  // Absent stays absent: the Library's HubSpot classification is a different
  // taxonomy and is never substituted to silence the warning.
  assert.doesNotMatch(src, /hubspotProductType/);
});

// ------------------------------------- Step 4 · Product Type authority cutover
test("Step 4 · no display or validation reader consults the retired Nexus taxonomy", async () => {
  // Falsifications 9 and 10, as a property of the CODE rather than of a run.
  //
  // The runtime script proves the pinned and live resolutions disagree and
  // that the pinned one is selected. It cannot prove that no OTHER branch in
  // these files quietly reaches for `leaves.product_type_id` instead — a
  // second reader would be silent, and would only surface as one surface
  // disagreeing with another for products nobody had hand-typed.
  //
  // `leaf-specs.ts` is excluded: it still WRITES the retired column through
  // assignLeafProductType / changeLeafProductType, which step 8 retires. This
  // asserts the READ paths, which is what step 4 cut over.
  for (const f of [
    "src/lib/assembly-tree.ts",
    "src/lib/addendum-loader.ts",
  ]) {
    const src = await code(f);
    assert.doesNotMatch(
      src,
      /leaf\.productTypeId|leaves\.productTypeId/,
      `${f} still reads the retired Nexus Product Type`,
    );
    assert.match(
      src,
      /decodePinnedSchema/,
      `${f} does not resolve the pinned Spec Schema`,
    );
  }
});

test("Step 4 · the Setup tree displays LIVE authoritative classification", async () => {
  // Falsification 9. The B-4/B-10 finding was a product typed in the Library
  // reading `untyped` in Setup, because Setup consulted a second taxonomy
  // nobody populated. The type tag must therefore trace to the same column the
  // Library reads.
  const src = await code("src/lib/assembly-tree.ts");
  assert.match(src, /leaf\.hubspotProductType/);
  // Fail-soft: a HubSpot outage must degrade the LABEL, never the page.
  assert.match(src, /typeLabels\.get\(typeValue\) \?\? typeValue/);
});

test("Step 4 · spec validation selects its schema from the pin, in quote scope", async () => {
  // Falsification 10. Reading live classification here would let a HubSpot
  // change mid-edit start rejecting a field key that was valid when the
  // surface rendered.
  const src = await code("src/app/actions/leaf-specs.ts");
  assert.match(src, /"quoteId" in scope\s*\?\s*decodePinnedSchema/);
  // The unmapped state must not be absorbed into "no schema applies".
  assert.match(src, /resolution\.kind === "unmapped"/);
});

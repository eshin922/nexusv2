/**
 * Stage 2 — Setup · Add Direct Service.
 *
 * The operator states what the customer is buying. BV-012 §5.b makes Direct
 * Product, Item Group and Direct Service three PEER sellable units, so Setup
 * offers three peer acts and infers none of them.
 *
 * ── WHY A THIRD MODE AND NOT A THIRD MODAL ────────────────────────────────
 *
 * `LibraryBrowseTrigger` already carried `mode: "direct" | "group"`, where
 * `direct` means "top-level, no destination picker". A service is top-level
 * too, so it reuses that behaviour rather than forking it — but for a stronger
 * reason than convenience: for `direct` the picker is merely unhelpful, while
 * for `service` an item group is not a legal destination at all (§5.c). Both
 * take the same branch; only one of them could ever be talked out of it.
 *
 * ── WHAT THIS SLICE DOES NOT DO ───────────────────────────────────────────
 *
 * No Costs ownership migration, no Production authoring, no BV-013. A service
 * attaches and appears; what it costs is Stage 3 and 4.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

test("Setup offers three peer sellable-unit acts", async () => {
  const view = await code("components/assembly-tree/assembly-tree-view.tsx");
  assert.match(view, /mode="direct"/);
  assert.match(view, /mode="service"/);
  assert.match(view, /<CreateItemGroupTrigger/);
});

test("Add Direct Service carries primary weight, like its peers", async () => {
  // A ghost beside two filled buttons reads as secondary chrome — the exact
  // treatment that made the grouped choice go unnoticed after it became
  // reachable (B-1, OW-4). A peer sellable unit is not chrome.
  const trigger = await code("components/library/library-browse-trigger.tsx");
  assert.match(trigger, /const isPrimary = isDirect \|\| isService;/);
  assert.match(trigger, /isPrimary \? "primary" : "ghost"/);
  assert.match(trigger, /\+ Add Direct Service/);
});

test("service browse shows services, and product browse cannot show them", async () => {
  const modal = await code("components/library/library-browse-modal.tsx");
  assert.match(
    modal,
    /commercialKindFilter: mode === "service" \? "service" : "product"/,
  );
});

test("the kind filter is applied in SQL, not after the page is fetched", async () => {
  // Post-filtering a paginated result silently shortens pages and makes the
  // count disagree with the rows — the B-11 defect, re-created.
  const loader = await code("lib/library-browse-loader.ts");
  assert.match(
    loader,
    /if \(filters\.commercialKindFilter\) \{[\s\S]{0,160}?conds\.push\(eq\(leaves\.commercialKind/,
  );
});

test("a service needs no destination, for a stronger reason than direct does", async () => {
  const modal = await code("components/library/library-browse-modal.tsx");
  assert.match(modal, /const isTopLevel = mode === "direct" \|\| mode === "service";/);
  assert.match(modal, /const attachReady = isTopLevel \|\| Boolean\(targetAssemblyId\)/);
  // No item-group picker is offered in either top-level mode.
  assert.match(modal, /\{isTopLevel \? \(/);
});

test("the service copy says it cannot join an item group", async () => {
  // The prohibition is enforced at the write boundary (Stage 1), but an
  // operator should learn it before being refused, not by being refused.
  const modal = await readFile(SRC + "components/library/library-browse-modal.tsx", "utf8");
  assert.match(modal, /cannot be added inside an item group/);
  assert.match(modal, /This quote — as a service line/);
});

test("attachment still routes through the one governed gate", async () => {
  // Stage 2 adds a surface, not a second attachment path. The refusal a
  // service would meet as a group member is unchanged and still lives in the
  // action, not in this modal.
  const modal = await code("components/library/library-browse-modal.tsx");
  assert.doesNotMatch(modal, /evaluateAttachmentEligibility/);
  const action = await code("app/actions/quote-products.ts");
  assert.match(action, /evaluateAttachmentEligibility\(leafRows\[0\], "direct"\)/);
});

/**
 * OD-032 Shape A — component charges in their causal Packaging context.
 *
 * The acceptance question is narrow, and so is this file: can an operator see
 * the charges a component caused, read their per-tier costs, and use the Costs
 * page unchanged?
 *
 * ── WHAT SHAPE A IS NOT ─────────────────────────────────────────────────
 *
 * It is not the Costs redesign that was deliberately deferred. So the sharpest
 * assertions here are the NEGATIVE ones: no region is created, no row moves
 * between regions, no tier column changes, and Production and Freight
 * semantics are untouched. A placement that quietly became a restructure would
 * pass every positive test in this file.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const PKG = "src/components/costs/packaging-drilldown.tsx";
const PROD = "src/components/costs/production-drilldown.tsx";
const FRT = "src/components/costs/freight-drilldown.tsx";
const PAGE = "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx";
const READER = "src/lib/component-charges/read.ts";
const CSS = "src/styles/od032-costs-charges.css";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments are prose, not behaviour. Matching one as a use has misled before. */
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// The charge appears with its causal owner
// ══════════════════════════════════════════════════════════════════════

test("charges are read by the CAUSAL owner, never by owner_ref", () => {
  const reader = codeOnly(read(READER));
  // The typed FK, which is the correct question AND the one that cannot
  // accidentally include a coerced anchor: `owner_ref` is text and is
  // '@quote' for a legacy charge.
  assert.match(reader, /isNotNull\(quoteChargeInstances\.ownerQuoteLeafId\)/);
  assert.ok(
    !/ownerRef/.test(reader),
    "reading owner_ref would risk surfacing a legacy charge under a component",
  );
  assert.ok(!/assembly_leaves|assemblyLeaves/.test(reader));
});

test("the row matches on the id the page actually supplies", () => {
  // ── THE CONTRACT, PINNED AT BOTH ENDS ──────────────────────────────────
  //
  // The Costs page sets a packaging line's `quoteSkuId` from
  // `assembly_leaf_inputs.quoteLeafId` — the CANONICAL `quote_leaves` id. So a
  // charge, which is owned by that same id, is matched directly.
  //
  // The first version "translated" it through the sku map, believing a stale
  // comment that called the field an assembly_leaf id. For a MEMBER of an Item
  // Group `sku.id` IS the junction id, so the lookup missed every member and
  // matched only Direct Products — where the two ids happen to coincide.
  //
  // It rendered nothing on a quote whose reader returned both charges, and it
  // was silent: a missing charge looks exactly like a component that caused
  // none. So the contract is asserted at BOTH ends rather than in one file's
  // prose.
  const pkg = codeOnly(read(PKG));
  assert.match(pkg, /charges=\{chargesByLeaf\.get\(line\.quoteSkuId\)\}/);
  assert.ok(
    !/skuByCostId/.test(pkg),
    "the sku-map indirection was the bug — a dead lookup invites it back",
  );

  // The page's half of the contract.
  const page = codeOnly(read(PAGE));
  assert.match(page, /quoteSkuId: r\.assembly_leaf_inputs\.quoteLeafId/);

  // And the reader's: charges are keyed by the same canonical id.
  const reader = codeOnly(read(READER));
  assert.match(reader, /quoteLeafId: quoteChargeInstances\.ownerQuoteLeafId/);
});

test("a MEMBER of an Item Group is not a Direct Product", () => {
  // The distinction the bug turned on, asserted so it cannot quietly go away:
  // a member's synthetic sku carries the JUNCTION id, a direct product's
  // carries the canonical leaf id. Any future join that routes through
  // `sku.id` will therefore work for one and silently fail for the other.
  const page = codeOnly(read(PAGE));
  assert.match(page, /for \(const \{ al, leaf \} of newAssemblyLeafRows\)[\s\S]{0,200}?id: al\.id/);
  assert.match(
    page,
    // No escaped newline in the pattern — writing one puts a literal newline
    // inside the regex literal, which does not parse.
    /newDirectProductRows[\s\S]{0,900}?id: ql\.id,[\s\S]{0,80}?quoteLeafId: ql\.id/,
  );
});

test("an instance with no economics yet still appears", () => {
  const reader = codeOnly(read(READER));
  // LEFT JOIN. Authoring refuses to create one, but a reader that silently
  // dropped a charge would hide the state rather than showing it.
  assert.match(reader, /\.leftJoin\(\s*\n?\s*quoteChargeInstanceTiers/);
  assert.match(reader, /if \(r\.tierId !== null\)/);
});

test("the block names the charge, its label, and where recovery is decided", () => {
  const pkg = read(PKG);
  assert.match(pkg, /One-time charges caused by this component/);
  assert.match(pkg, /one-time · set in Commercial recovery/);
  // The operator's own label, when there is one — that is what tells two
  // charges of a type apart.
  assert.match(pkg, /od032-costs-charge-label/);
});

// ══════════════════════════════════════════════════════════════════════
// The tier grid is untouched
// ══════════════════════════════════════════════════════════════════════

test("a one-time total never sits in a tier column", () => {
  const css = read(CSS);
  // Full width, BELOW the grid. A one-time charge is a TOTAL and the grid is
  // per-unit rates — laying it across the tier columns would invite reading it
  // as a rate that scales, which is the arithmetic the engine's falsifications
  // exist to prevent.
  assert.match(css, /\.od032-costs-charges\s*\{[\s\S]*?grid-column: 1 \/ -1;/);
});

test("the packaging row's own columns are unchanged", () => {
  const pkg = codeOnly(read(PKG));
  // The block is appended AFTER the tier cells, inside the same row container,
  // so nothing above it moves.
  const rowEnd = pkg.indexOf("od032-costs-charges");
  const tierCells = pkg.lastIndexOf("isActive={activeTierId === t.id}", rowEnd);
  assert.ok(tierCells > 0 && tierCells < rowEnd, "the block must follow the tier cells");
  // And no grid-template was redefined for the row.
  assert.ok(
    !/gridTemplateColumns/.test(pkg),
    "Shape A must not restate the packaging grid",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Production: one line added, nothing else
// ══════════════════════════════════════════════════════════════════════

test("Production gains an attribution line and nothing more", () => {
  const prod = read(PROD);
  assert.match(prod, /One-time charges · caused by this Item Group/);
  assert.match(prod, /BV-012 · finished-good economics/);

  // The fees were ALREADY grouped this way — #282 re-keyed the display to
  // assembly because production belongs to the finished good. What was missing
  // was the reason, so the change is a caption and not a regrouping.
  const code = codeOnly(prod);
  assert.match(code, /skus\.filter\(\(s\) => s\.skuRole === "assembly"\)/);
});

test("Production's own line vocabulary is untouched", () => {
  const prod = codeOnly(read(PROD));
  // The six virtual lines are the legacy family and must stay exactly as they
  // are: Shape A moves no production row anywhere.
  for (const field of [
    "setupFeeTotal",
    "toolingArtworkTotal",
    "toolingTotal",
    "artworkTotal",
    "rdTotal",
    "otherServiceTotal",
  ]) {
    assert.ok(prod.includes(field), `${field} must still be a production line`);
  }
  // And no component charge is rendered here — they belong with their cause.
  assert.ok(
    !/componentCharge|ComponentChargeForCosts/.test(prod),
    "a component charge in Production would be attribution to the wrong owner",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Freight: not touched at all
// ══════════════════════════════════════════════════════════════════════

test("Freight is untouched by Shape A", () => {
  const frt = codeOnly(read(FRT));
  assert.ok(
    !/componentCharge|ComponentChargeForCosts|od032/.test(frt),
    "Shape A must not reach Freight — duty and customs stay where they are",
  );
});

test("no new Costs region is created", () => {
  const page = codeOnly(read(PAGE));
  // Still exactly three. A standalone one-time section is the deferred
  // redesign, not this.
  const sections = (page.match(/<SectionWithDrilldown/g) ?? []).length;
  assert.equal(sections, 3, "Shape A must not add a Costs section");
  for (const name of ['name="Packaging"', 'name="Production"', 'name="Freight"']) {
    assert.ok(page.includes(name), `${name} must still be a section`);
  }
});

test("no row moves between regions", () => {
  const page = codeOnly(read(PAGE));
  // The page's only addition is the reader and the prop that carries its
  // result into the region the component already lives in.
  assert.match(page, /const componentCharges = await readComponentChargesForCosts/);
  assert.match(page, /componentCharges=\{componentCharges\}/);
  // Passed to Packaging ONLY.
  assert.equal((page.match(/componentCharges=\{componentCharges\}/g) ?? []).length, 1);
  const pkgCall = page.slice(page.indexOf("<PackagingDrilldown"));
  assert.ok(
    pkgCall.indexOf("componentCharges") < pkgCall.indexOf("</SectionWithDrilldown>"),
    "the charges must reach Packaging, and only Packaging",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Scoping
// ══════════════════════════════════════════════════════════════════════

test("the stylesheet is prefix-clean", () => {
  const css = read(CSS);
  const selectors = css.match(/^\.[a-z0-9-]+/gm) ?? [];
  assert.ok(selectors.length > 0);
  assert.ok(
    selectors.every((sel) => sel.startsWith(".od032-")),
    `every selector must be prefix-clean; found ${selectors
      .filter((sel) => !sel.startsWith(".od032-"))
      .join(", ")}`,
  );
});

test("a component with no charges renders nothing extra", () => {
  const pkg = codeOnly(read(PKG));
  // Not an empty block, and not a zero. A component that caused no charge has
  // nothing to say, and saying it would put a row on every product on the page.
  assert.match(pkg, /charges && charges\.length > 0 &&/);
});

test("DIVERGENCE · the destination is Commercial recovery, not Pricing", () => {
  // ── A DELIBERATE DEPARTURE FROM THE DESIGN AUTHORITY ───────────────────
  //
  // The prototype's charge row reads "recovery set in pricing". That was
  // written before Commercial Recovery became its own governed surface.
  //
  // This row exists to tell the operator where to go next, so the destination
  // has to be one that exists — and shipping the prototype's wording would
  // teach the superseded mental model at exactly the moment the architecture
  // stopped matching it. Recovery is not a pricing decision; separating the
  // two is the work the previous phases did.
  //
  // Named as the surface names itself, so the caption and the card agree.
  const proto = read(
    "docs/design-prototypes/od-032/design/Nexus OD-032 Round Trip.dc.html",
  );
  assert.ok(
    proto.includes("recovery set in pricing"),
    "the prototype no longer says this — the divergence may be resolved",
  );

  const pkg = read(PKG);
  assert.ok(
    !codeOnly(pkg).includes("set in pricing"),
    "Shape A must not send the operator to Pricing for a recovery decision",
  );

  // And it points at the surface's OWN name, so a rename cannot leave the two
  // saying different things without this failing.
  const card = read("src/components/quote/card-commercial-recovery.tsx");
  assert.match(card, /<div className="cv-card-title">Commercial recovery<\/div>/);
  assert.match(pkg, /set in Commercial recovery/);
});


/**
 * MOUNTED tests for the M2 read-only Costs preview.
 *
 * What is under test is what the surface PRESENTS, and reading the source
 * cannot settle any of it:
 *
 *   * READ-ONLY has to be true of the rendered tree. A surface that renders a
 *     disabled `<input>` is worse than one that renders text: an operator types
 *     into it, loses the keystrokes, and learns not to trust the surface that
 *     does save. So the assertion is that there are no form controls at all.
 *   * EVERY TIER appears in every row of the side-by-side views. Tiers are
 *     alternatives for the whole quote; dropping one hides an alternative.
 *   * UNPRICED must not read as zero, in the DOM, per cell.
 *   * ROW NAMING follows the bundle — "Product cost", never the raw category
 *     key. `primary_packaging` is a classification, not an identity.
 *   * STRUCTURE follows the bundle: By module is one accordion per product, By
 *     product is field cards. Both were rebuilt after a visual review found the
 *     first cut had invented its own organisation.
 *
 * Driven through `CostsM2PreviewBody`, which takes resolved data rather than
 * reaching for the store — the same split the Cost Stack header uses, so there
 * is one place a commercial value can enter this surface.
 */
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { mount } from "../support/mount.tsx";
import { CostsM2PreviewBody } from "../../src/components/costs/preview/costs-m2-preview-body.tsx";
import { FreightSummary } from "../../src/components/costs/preview/freight-summary.tsx";
import { costCategoryLabel, tierHead } from "../../src/components/costs/preview/shared.tsx";
import {
  buildCostsOverview,
  type CostsOverviewFacts,
} from "../../src/lib/costs/costs-overview-model.ts";
import {
  packagingReadKey,
  type PackagingLineTierRead,
} from "../../src/lib/costs/packaging-line-graph-read.ts";

const T1 = "tier-1";
test("tier ordinals and partial numeric matches do not suppress quantity", () => {
  assert.equal(tierHead({ label: "Tier 1", qty: 1 }).qty, "1 units");
  assert.equal(tierHead({ label: "MOQ 10,000 units", qty: 1_000 }).qty, "1,000 units");
  assert.equal(tierHead({ label: "MOQ 1000 units", qty: 1_000 }).qty, null);
});
const T2 = "tier-2";
const T3 = "tier-3";

const FACTS: CostsOverviewFacts = {
  tiers: [
    { id: T1, label: "Tier 1", qty: 10_000 },
    { id: T2, label: "Tier 2", qty: 25_000 },
    { id: T3, label: "Tier 3", qty: 50_000 },
  ],
  assemblies: [{ id: "asy-1", sku: "ASY-1", name: "Multi gummies", position: 0 }],
  members: [
    {
      assemblyLeafId: "al-1",
      assemblyId: "asy-1",
      quoteLeafId: "ql-member",
      name: "Gummy jar",
      sku: "DPS-MISTR-1007",
      quantity: "2",
      position: 0,
      productType: "Turnkey",
    },
  ],
  directProducts: [
    {
      quoteLeafId: "ql-direct",
      name: "Silicone lubricant 2oz",
      sku: "DPS-MISTR-1003",
      quantity: "1",
      position: 0,
      productType: "Raw ingredients",
    },
  ],
  // An UNPRICED governed service: it owns one input row whether or not anyone
  // has costed it, and must still appear.
  directServices: [
    {
      quoteLeafId: "ql-service",
      name: "Micro testing",
      serviceIdentity: "testing_micros",
      position: 0,
      amountsByTier: { [T1]: null, [T2]: null, [T3]: null },
    },
  ],
  packagingRows: [
    // Tier 1 priced, tier 2 a STATED ZERO, tier 3 never touched.
    row("ql-member", T1, "lg-1", "1.1100"),
    row("ql-member", T2, "lg-1", "0"),
    row("ql-member", T3, "lg-1", null),
  ],
  groupProductionRows: [
    {
      id: "p1",
      assemblyId: "asy-1",
      tierId: T1,
      allocateServiceFeesToCost: true,
      fillingBlendingCost: "3000.00",
      cmAssemblyTotal: null,
      bulkRawCost: null,
      setupFeeTotal: null,
      toolingArtworkTotal: null,
      toolingTotal: null,
      artworkTotal: null,
      rdTotal: null,
      testingMicrosTotal: null,
      otherServiceTotal: null,
      actualUnitsProduced: null,
    },
  ],
  componentCharges: [
    {
      chargeInstanceId: "ci-1",
      quoteLeafId: "ql-direct",
      chargeKey: "print_plates",
      label: null,
      toolingClassification: null,
      // UNEQUAL amounts, and nothing at tier 3.
      amounts: [
        { tierId: T1, cost: "1000.00", recoveryAsk: null },
        { tierId: T2, cost: "1400.00", recoveryAsk: null },
      ],
    },
  ],
  chargeReadiness: [
    {
      chargeInstanceId: "ci-1",
      chargeKey: "print_plates",
      label: "Print plates",
      ownLabel: null,
      quoteLeafId: "ql-direct",
      state: "partial",
      missingTierIds: [T3],
      missingTierLabels: ["Tier 3"],
    },
  ],
};

function row(
  quoteLeafId: string,
  tierId: string,
  lineGroupId: string,
  unitCost: string | null,
) {
  return {
    id: `${lineGroupId}:${tierId}`,
    quoteLeafId,
    tierId,
    lineGroupId,
    sortOrder: 0,
    pricingVendorNameSnapshot: "Acme Packaging",
    supplier: null,
    qtyPerSellableUnit: "1",
    category: "Primary",
    markupPct: null,
    markupPctSource: null,
    inventoryEligible: false,
    notes: null,
    unitCost,
  };
}

const OVERVIEW = buildCostsOverview(FACTS);

/** The engine's answer for the one line, as the graph read would return it. */
const READS: ReadonlyMap<string, PackagingLineTierRead> = new Map([
  [
    packagingReadKey("lg-1", T1),
    {
      value: 1.443,
      cost: 1.11,
      markup: 0.3,
      markupSource: "Other default",
      inheritedMarkup: 0.3,
      inheritedSource: "Other default",
    },
  ],
]);

/** Records every tier the surface asks to navigate to. */
const selected: string[] = [];

function body(activeTierId: string | null = T1) {
  return (
    <CostsM2PreviewBody
      overview={OVERVIEW}
      reads={READS}
      quoteEditable
      pathname="/projects/p/quotes/q/costs"
      baseParams="section=freight"
      activeTierId={activeTierId}
      onSelectTier={(id) => selected.push(id)}
    />
  );
}

const labels = (m: Awaited<ReturnType<typeof mount>>, sel = ".cm2-label") =>
  m.findAll(sel).map((n) => n.textContent ?? "");

/** Switch view by its visible name. */
async function switchTo(m: Awaited<ReturnType<typeof mount>>, name: string) {
  const idx = m
    .findAll(".cm2-views .cm2-ctl")
    .findIndex((b) => b.textContent === name);
  assert.ok(idx >= 0, `no view button named ${name}`);
  await m.click(`.cm2-views .cm2-ctl:nth-of-type(${idx + 1})`);
}

test("nothing in the preview is a form control", async () => {
  const m = await mount(body());
  // `select` is in this list deliberately. Even a control that only changes
  // which alternative a panel shows reads as an editor on a surface where
  // everything else is inert, and the design's read-only rule is that a
  // read-only state is never "a disabled-looking input pretending to be
  // editable". Navigation is expressed with pressed buttons instead.
  for (const view of ["Spreadsheet", "By product", "By module"]) {
    await switchTo(m, view);
    for (const selector of ["input", "textarea", "select", "[contenteditable]"]) {
      assert.equal(
        m.findAll(selector).length,
        0,
        `${selector} found in ${view} — a read-only preview must not render one`,
      );
    }
    for (const b of m.findAll("button")) {
      assert.ok(
        /cm2-ctl|cm2-pick|cm2-owner-head|cm2-tierpick/.test(b.className),
        `unexpected action control in ${view}: ${b.textContent}`,
      );
    }
  }
  await m.unmount();
});

test("the costs workspace does not render the retired preview banner", async () => {
  const m = await mount(body());
  assert.equal(m.findAll(".cm2-notice").length, 0);
  await m.unmount();
});
test("internal markup category keys render as operator labels", () => {
  assert.equal(costCategoryLabel("primary_packaging"), "Primary Packaging");
  assert.equal(costCategoryLabel("Primary"), "Primary Packaging");
  assert.equal(costCategoryLabel("Secondary"), "Secondary Packaging");
  assert.equal(costCategoryLabel("Soft Goods"), "Soft Goods");
  assert.equal(costCategoryLabel(null), "inherit");
});

test("Freight stays in the summary and opens its existing editor in a side panel", async () => {
  const freight = {
    workbook: {
      subcategories: [], memberships: [], destinations: [], breaks: [],
      customsEntries: [], customsBreaks: [], tracking: [], costingContext: {},
    },
    handoff: null,
    statusAvailable: true,
  } as any;
  const m = await mount(
    <FreightSummary
      input={freight}
      editor={<input aria-label="Freight editor sentinel" />}
      tiers={OVERVIEW.tiers}
      activeTierId={T1}
      onSelectTier={() => {}}
      href="/projects/p/quotes/q/costs?section=freight"
    />,
  );

  assert.equal(m.findAll(".cm2-freight-panel-shell").length, 0, "the full editor must not occupy the page");
  await m.click(".cm2-freight-action");
  const panel = m.find(".cm2-freight-panel-shell");
  assert.ok(panel && !panel.hasAttribute("hidden"), "Record shipment should open the side panel");
  assert.ok(m.find('[role="dialog"]'), "the panel must be exposed as a dialog");
  assert.ok(m.find('[aria-label="Freight editor sentinel"]'), "the existing editor is reused inside the panel");

  await m.click(".cm2-freight-panel-close");
  assert.ok(m.find(".cm2-freight-panel-shell")?.hasAttribute("hidden"), "closing must return to the compact summary");
  await m.unmount();
});

test("Spreadsheet shows every tier plus the markup track, and unpriced is not zero", async () => {
  const m = await mount(body());
  const head = m.findAll(".cm2-group:not(.cm2-quote-freight) .cm2-fieldhead .cm2-tierhead");
  assert.equal(head.length, 4, "three alternatives and the MARKUP % track");
  assert.equal(head[0].querySelector(".cm2-tierhead-label")?.textContent, "TIER 1");
  assert.equal(head[0].querySelector(".cm2-tierhead-qty")?.textContent, "10,000 units");
  assert.equal(head[3].textContent, "MARKUP %");

  const lineRow = m
    .findAll(".cm2-row")
    .find((r) => (r.querySelector(".cm2-label")?.textContent ?? "").startsWith("Product cost"));
  assert.ok(lineRow, "the recurring row is not rendered");
  const cells = [...lineRow!.querySelectorAll(".cm2-value")].map((c) => c.textContent);
  assert.deepEqual(
    cells,
    ["1.1100", "0", "unpriced"],
    "stored values as recorded; a stated zero and an absent cost stay different",
  );
  await m.unmount();
});

test("a recurring row is named Product cost and shows the Setup-derived markup category", async () => {
  const m = await mount(body());
  const all = labels(m).join(" | ");
  assert.match(all, /Product cost/);
  assert.ok(
    !/primary_packaging/i.test(m.text()),
    "a raw category key must not be used as a row identity",
  );
  // Product Setup's live HubSpot type is the markup-category authority. This
  // fixture is Turnkey even though its saved packaging row says Primary.
  const lineRow = m
    .findAll(".cm2-row")
    .find((r) => (r.querySelector(".cm2-label")?.textContent ?? "").startsWith("Product cost"));
  assert.match(lineRow!.querySelector(".cm2-tailfield")?.textContent ?? "", /Turnkey/);
  await m.unmount();
});

test("one row carries no disambiguating qualifier", async () => {
  // The bundle appends ` · <vendor|category>` only when an owner has MORE THAN
  // ONE row. This fixture has one, so the label is bare — the descriptive
  // clutter the review asked to remove.
  const m = await mount(body());
  const label = labels(m).find((l) => l.startsWith("Product cost"));
  assert.equal(label, "Product cost");
  await m.unmount();
});

test("the resolved markup shown is the engine's, in the markup track", async () => {
  const m = await mount(body());
  const lineRow = m
    .findAll(".cm2-row")
    .find((r) => (r.querySelector(".cm2-label")?.textContent ?? "").startsWith("Product cost"));
  // 30% from the engine's ladder, NOT the line's own markup — which is null.
  assert.match(lineRow!.textContent ?? "", /30\.0%/);
  assert.equal(
    lineRow!.querySelector(".cm2-tailfield")?.textContent?.trim(),
    "Turnkey",
    "the final column names only the Setup-derived category; markup provenance belongs with the markup value",
  );
  await m.unmount();
});

test("a charge keeps its per-tier amounts and never becomes one shared amount", async () => {
  const m = await mount(body());
  const chargeRow = m
    .findAll(".cm2-row")
    .find((r) => (r.querySelector(".cm2-label")?.textContent ?? "").includes("Print plates"));
  assert.ok(chargeRow, "the charge row is not rendered");
  const cells = [...chargeRow!.querySelectorAll(".cm2-value")].map((c) => c.textContent);
  assert.deepEqual(cells, ["1000.00", "1400.00", "unpriced"]);
  assert.match(chargeRow!.textContent ?? "", /partly priced/);
  assert.match(chargeRow!.textContent ?? "", /One-time cost/);
  await m.unmount();
});

test("an unpriced governed service is still a row", async () => {
  const m = await mount(body());
  const svc = labels(m).find((l) => l.includes("Testing / Micros"));
  assert.ok(svc, "an unpriced service must not vanish — it owns an input row");
  await m.unmount();
});

test("no totals row at all — not even an empty one", async () => {
  const m = await mount(body());
  // A row of dashes under "Quote total per tier" is not neutral: it reads as a
  // total that failed to compute.
  assert.equal(m.findAll(".cm2-foot").length, 0, "no grid totals row");
  assert.ok(!/Quote total per tier/.test(m.text()));
  const foot = m.find(".cm2-group-foot");
  assert.ok(foot, "the alternatives rule is still stated");
  assert.match(foot!.textContent ?? "", /never added together/);
  assert.match(foot!.textContent ?? "", /Cost Stack/);

  await switchTo(m, "By module");
  assert.equal(m.findAll(".cm2-foot").length, 0, "no per-group totals row either");
  assert.ok(!/Charges per tier/.test(m.text()));
  await m.unmount();
});

test("By module is one accordion per product, not one card per platform module", async () => {
  const m = await mount(body());
  await switchTo(m, "By module");

  const owners = m.findAll(".cm2-owner");
  assert.equal(owners.length, 4, "group, member, direct product, service");
  const titles = m.findAll(".cm2-owner-title").map((n) => n.textContent);
  assert.deepEqual(titles, [
    "Multi gummies",
    "Gummy jar",
    "Silicone lubricant 2oz",
    "Micro testing",
  ]);
  // One open, the rest collapsed — canonical screenshot 10.
  const expanded = m.findAll('.cm2-owner-head[aria-expanded="true"]');
  assert.equal(expanded.length, 1);

  // The open card holds its OWN sections, with the tier grid inside.
  const open = m.find(".cm2-owner.cm2-open")!;
  const sections = [...open.querySelectorAll(".cm2-group-title")].map((n) => n.textContent);
  assert.ok(sections.includes("Recurring costs"), sections.join(", "));
  assert.ok(sections.includes("One-time charges"));
  assert.ok(sections.includes("Production costs · tier totals"), "the group's production module");
  assert.ok(sections.includes("Members"));
  await m.unmount();
});

test("By module preserves the same resolved recurring markup as Spreadsheet", async () => {
  const m = await mount(body());
  await switchTo(m, "By module");
  await m.click(".cm2-owner:nth-of-type(2) .cm2-owner-head");
  const row = m.findAll(".cm2-owner.cm2-open .cm2-row").find((node) =>
    node.querySelector(".cm2-label")?.textContent?.includes("Product cost"),
  );
  assert.ok(row, "the member's recurring cost is visible");
  assert.equal(row.querySelector(".cm2-figure")?.textContent, "30.0%");
  await m.unmount();
});

test("By module points at the real modules rather than reproducing them", async () => {
  const m = await mount(body());
  await switchTo(m, "By module");

  const hrefs = (m.findAll(".cm2-entry") as HTMLAnchorElement[]).map((a) =>
    a.getAttribute("href"),
  );
  assert.ok(hrefs.length > 0, "no module entry point");
  for (const href of hrefs) {
    // Each entry point LEAVES the preview — the switch is gone from the href.
    assert.ok(!href!.includes("preview="), `entry point stays inside the preview: ${href}`);
  }
  assert.ok(hrefs.some((h) => h!.includes("section=freight")));
  assert.ok(hrefs.some((h) => h!.includes("section=production")));

  // Missing workbook is unknown, never fabricated zero or completion.
  assert.equal(m.findAll(".cm2-freight").length, 1);
  assert.equal(m.findAll(".cm2-owner .cm2-freight").length, 0);
  assert.ok(m.find(".cm2-freight")!.textContent!.includes("Shipment details are unavailable"));
  await m.unmount();
});

test("By product is field cards, with the four canonical recurring fields", async () => {
  const m = await mount(body());
  await switchTo(m, "By product");

  // Focus the member, which is the owner carrying the recurring row.
  const picks = m.findAll(".cm2-pick");
  const idx = picks.findIndex((p) => (p.textContent ?? "").includes("DPS-MISTR-1007"));
  assert.ok(idx >= 0);
  await m.click(`.cm2-pick:nth-of-type(${idx + 1})`);

  const card = m.findAll(".cm2-edcard").find((c) =>
    (c.querySelector(".cm2-edtitle-text")?.textContent ?? "").startsWith("Product cost"),
  );
  assert.ok(card, "no recurring cost card");
  assert.match(
    card!.querySelector(".cm2-edtitle-text")?.textContent ?? "",
    /^Product cost · Gummy jar/,
  );
  const fieldLabels = [...card!.querySelectorAll(".cm2-edlabel")].map((n) => n.textContent);
  assert.deepEqual(fieldLabels.slice(0, 4), [
    "Pricing vendor",
    "Markup category",
    "Unit cost · Tier 1",
    "Quantity per sellable unit",
  ]);
  // Price source is not a supplier award, and the hint says so.
  assert.match(card!.textContent ?? "", /not the awarded supplier/);
  // Override and notes are behind the disclosure, collapsed.
  const disclosure = card!.querySelector("details.cm2-disclosure");
  assert.ok(disclosure, "no override/notes disclosure");
  assert.equal((disclosure as HTMLDetailsElement).open, false);
  await m.unmount();
});

test("By product names the focused tier and still shows every tier's charge amount", async () => {
  const m = await mount(body());
  await switchTo(m, "By product");

  const scope = m.byTestId("cm2-tier-scope");
  assert.ok(scope, "the focused tier is not named");
  const pressed = [...scope!.querySelectorAll('[aria-pressed="true"]')];
  assert.equal(pressed.length, 1);
  assert.match(pressed[0].textContent ?? "", /Tier 1/);
  assert.equal(
    scope!.querySelectorAll("button").length,
    3,
    "every alternative stays reachable; focusing one hides none",
  );

  // Focus the product that carries the charge.
  const picks = m.findAll(".cm2-pick");
  const idx = picks.findIndex((p) => (p.textContent ?? "").includes("Silicone lubricant 2oz"));
  await m.click(`.cm2-pick:nth-of-type(${idx + 1})`);

  // EVERY tier's amount, even in the per-tier view: there is no stored
  // shared-mode intent to read, so the card shows what is recorded per
  // alternative rather than inferring a mode from amounts that happen to match.
  const text = m.text();
  assert.match(text, /One-time amount · Tier 1/);
  assert.match(text, /One-time amount · Tier 3/);
  assert.match(text, /1000\.00/);
  assert.match(text, /1400\.00/);
  await m.unmount();
});

test("every owner survives a change of view", async () => {
  const m = await mount(body());
  const expected = [
    "Multi gummies",
    "Gummy jar",
    "Silicone lubricant 2oz",
    "Micro testing",
  ];

  const sheet = m.findAll(".cm2-parent .cm2-label").map((n) => n.textContent);
  assert.deepEqual(sheet, expected);

  await switchTo(m, "By module");
  assert.deepEqual(m.findAll(".cm2-owner-title").map((n) => n.textContent), expected);

  await switchTo(m, "By product");
  assert.deepEqual(m.findAll(".cm2-pick-name").map((n) => n.textContent), expected);
  await m.unmount();
});

test("a record the model cannot place is reported on the surface", async () => {
  const orphaned = buildCostsOverview({
    ...FACTS,
    componentCharges: [
      ...FACTS.componentCharges,
      {
        chargeInstanceId: "ci-orphan",
        quoteLeafId: "ql-nowhere",
        chargeKey: "tooling",
        label: null,
        toolingClassification: null,
        amounts: [{ tierId: T1, cost: "77.00", recoveryAsk: null }],
      },
    ],
  });
  const m = await mount(
    <CostsM2PreviewBody
      overview={orphaned}
      reads={READS}
      quoteEditable
      pathname="/costs"
      baseParams=""
      activeTierId={T1}
      onSelectTier={() => {}}
    />,
  );
  const text = m.text();
  assert.match(text, /cannot place/i);
  assert.match(text, /ql-nowhere/);
  assert.match(text, /Charges with no owner in this quote/);
  assert.match(text, /77\.00/);
  await m.unmount();
});

// ── Tier navigation ────────────────────────────────────────────────────────
//
// The preview does not own a tier. It reads the quote's active tier from the
// store the Cost Stack reads, and selecting one here makes the same navigation
// gesture the stack makes. Opening a view must not silently move an operator to
// tier 1, and the three views must not disagree with each other or the stack.

test("the active tier comes from the quote, not from a view's own default", async () => {
  // The store says Tier 3. Nothing may reset that to the first tier.
  const m = await mount(body(T3));

  const headPressed = () =>
    m
      .findAll('.cm2-group:not(.cm2-quote-freight) .cm2-tierpick[aria-pressed="true"] .cm2-tierhead-label')
      .map((n) => n.textContent);
  assert.deepEqual(headPressed(), ["TIER 3"], "Spreadsheet highlights the quote's tier");

  await switchTo(m, "By product");
  const scope = m.byTestId("cm2-tier-scope")!;
  const pressed = [...scope.querySelectorAll('[aria-pressed="true"]')].map(
    (b) => b.textContent,
  );
  assert.equal(pressed.length, 1);
  assert.match(pressed[0] ?? "", /Tier 3/, "By product does not reset to the first tier");
  assert.match(m.text(), /shown at Tier 3/);

  await switchTo(m, "By module");
  // The open card renders one tier-head row per section, so every one of them
  // must agree — a section that disagreed would be the defect this asserts away.
  const byModule = headPressed();
  assert.ok(byModule.length > 0, "By module renders no tier heads");
  assert.deepEqual([...new Set(byModule)], ["TIER 3"], "every section agrees");
  await m.unmount();
});

test("choosing a tier reports the same navigation the Cost Stack makes", async () => {
  selected.length = 0;
  const m = await mount(body(T1));

  // Spreadsheet: the column heading is the control.
  const heads = m.findAll(".cm2-group:not(.cm2-quote-freight) .cm2-fieldhead .cm2-tierpick");
  assert.equal(heads.length, 3);
  await m.click(".cm2-group:not(.cm2-quote-freight) .cm2-fieldhead .cm2-tierpick:nth-of-type(3)");
  assert.deepEqual(selected, [T3]);

  // By product: the named scope.
  await switchTo(m, "By product");
  const scope = m.byTestId("cm2-tier-scope")!;
  const idx = [...scope.querySelectorAll("button")].findIndex((b) =>
    (b.textContent ?? "").includes("Tier 2"),
  );
  await m.click(`[data-testid="cm2-tier-scope"] button:nth-of-type(${idx + 1})`);
  assert.deepEqual(selected, [T3, T2]);

  // Nothing is written to the quote: the surface only reports the request.
  assert.equal(m.findAll("input, select, textarea").length, 0);
  await m.unmount();
});

test("the active tier's cells are highlighted, and no tier is hidden", async () => {
  const m = await mount(body(T2));
  const lineRow = m
    .findAll(".cm2-row")
    .find((r) => (r.querySelector(".cm2-label")?.textContent ?? "").startsWith("Product cost"))!;
  const cells = [...lineRow.querySelectorAll(".cm2-cell")];
  // Three tier cells plus the markup track; all present, one marked.
  assert.equal(cells.filter((c) => c.className.includes("cm2-hl")).length, 1);
  assert.equal(
    cells[1].className.includes("cm2-hl"),
    true,
    "the second alternative is the highlighted one",
  );
  assert.equal(
    [...lineRow.querySelectorAll(".cm2-value")].length,
    3,
    "every alternative still renders",
  );
  await m.unmount();
});

test("a tier the store cannot name falls back without hiding anything", async () => {
  // Before hydration the store has no active tier. The surface still renders
  // every alternative and picks one to show, rather than rendering nothing.
  const m = await mount(body(null));
  assert.equal(m.findAll(".cm2-group:not(.cm2-quote-freight) .cm2-fieldhead .cm2-tierpick").length, 3);
  await switchTo(m, "By product");
  assert.match(m.text(), /shown at Tier 1/);
  await m.unmount();
});

test("a tier label that already states its quantity is not given it twice", async () => {
  const facts: CostsOverviewFacts = {
    ...FACTS,
    // The shape operators actually use.
    tiers: [{ id: T1, label: "MOQ · 1,000 units", qty: 1_000 }],
    packagingRows: [row("ql-member", T1, "lg-1", "1.1100")],
  };
  const m = await mount(
    <CostsM2PreviewBody
      overview={buildCostsOverview(facts)}
      reads={READS}
      quoteEditable
      pathname="/costs"
      baseParams=""
      activeTierId={T1}
      onSelectTier={() => {}}
    />,
  );
  const head = m.find(".cm2-group:not(.cm2-quote-freight) .cm2-fieldhead .cm2-tierhead")!;
  assert.equal(head.querySelector(".cm2-tierhead-label")?.textContent, "MOQ · 1,000 UNITS");
  assert.equal(
    head.querySelector(".cm2-tierhead-qty"),
    null,
    "the label already carries the quantity; repeating it overflowed the track",
  );
  await m.unmount();
});

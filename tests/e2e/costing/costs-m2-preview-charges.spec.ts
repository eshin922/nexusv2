// CC visual-validation fixture for M2 one-time charge coverage.
//
// WHY A SEPARATE SPEC. `costs-m2-preview-preservation.spec.ts` is Codex's and
// is not edited here. It runs against `sixSku` and `r12Visual`, and NEITHER
// fixture carries a one-time charge instance — they seed group members,
// packaging inputs, freight and pricing state only. So no existing browser
// evidence can establish charge UI fidelity: the charge rows the preview
// renders have never appeared in a rendered page.
//
// This spec adds representative charges of EXISTING SUPPORTED TYPES, over BOTH
// supported ownership shapes, renders all three preview views, and removes
// exactly the rows it created. It changes no production behaviour and asserts
// no new financial rule.
//
// BOTH OWNERSHIP SHAPES, because both are existing requirements:
//   * GROUPED   a component inside the item group — two charges of one type on
//               one owner, plus a third owner elsewhere in the group
//   * STANDALONE a Direct Product: a `quote_leaves` row with `assembly_id`
//               NULL, attached to an EXISTING catalogue product. No fixture
//               helper seeds one, which is a gap in the fixtures rather than a
//               reason to leave standalone ownership untested — so the row is
//               created here, minimally and exactly as
//               `product-structure/direct-attachment.ts` writes it, and removed
//               in `finally`.
//
// WHAT THE CHARGES COVER, and why each is here:
//   * unequal tier costs        equal amounts must not be collapsed into a
//                               single shared amount; unequal ones make the
//                               per-tier rendering visible
//   * unpriced alternatives     a charge tier row exists IF AND ONLY IF an
//                               operator stated a positive cost, so absence
//                               must render `unpriced`, never `0`
//   * no tier rows at all       an uncosted charge produces no economics, so a
//                               view built from engine output drops it entirely
//   * two of one type, one owner  identity is the INSTANCE, not the type
//   * classified and unclassified tooling
//   * three owners across two shapes, so charge-to-parent attribution is
//     testable and a standalone owner is shown not to need a group
//
// OUT OF SCOPE: the shared-amount control is DEFERRED IMPLEMENTATION for a
// later milestone, not an unresolved business question — M2 has no stored
// shared-mode intent to read, so every charge shows its per-tier amounts.
// `testing_micros` enablement is likewise not exercised here.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";
import { assertRuntimeSafety } from "../../../src/lib/config/runtime-config";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function manifest(): Promise<FixtureManifest> {
  return JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
}

/**
 * The ONE database this spec may write to.
 *
 * Named exactly, not matched on a substring. This spec creates a quote leaf and
 * charge instances, so "a name containing `nexus_validation`" is a wider
 * permission than it needs: a second validation database, or a differently
 * suffixed one, would satisfy a substring and is not the database the harness
 * seeded and will inspect.
 */
const ALLOWED_DATABASE = "nexus_validation_financial_parity_full_20260918";

/**
 * Refuse to touch anything that is not that database.
 *
 * `assertRuntimeSafety()` proves isolated mode and a loopback host — it is the
 * gate the harness itself runs. The host and name are restated here against the
 * URL THIS SPEC connects through, because the failure being guarded against is
 * a spec writing rows somewhere the harness never inspected.
 */
function validationDatabaseUrl(): string {
  const safety = assertRuntimeSafety();
  if (safety.mode !== "isolated") {
    throw new Error("[m2-charges] isolated runtime required");
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("[m2-charges] DATABASE_URL is not set");
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const name = url.pathname.replace(/^\/+/, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "nexus-validation-db"].includes(host)) {
    throw new Error(`[m2-charges] refusing a non-local database host: ${host}`);
  }
  if (name !== ALLOWED_DATABASE) {
    throw new Error(
      `[m2-charges] refusing a database other than ${ALLOWED_DATABASE}: ${name}`,
    );
  }
  return raw;
}

/** Unique per run, so nothing this spec writes can collide with a fixture row. */
const TAG = `m2chg-${randomUUID().slice(0, 8)}`;

type SeededCharge = {
  id: string;
  chargeKey: "print_plates" | "tooling" | "artwork_plate";
  label: string;
  ownerQuoteLeafId: string;
  toolingClassification: "cutting_die" | null;
  /** tier index -> cost. An absent index means NO ROW, which renders unpriced. */
  costs: Record<number, string>;
};

test("M2 preview renders one-time charges under grouped AND standalone owners, across every tier", async (
  { page },
  testInfo,
) => {
  test.setTimeout(120_000);
  const fixture = (await manifest()).operatorQuotes.r12Visual;
  const sql = postgres(validationDatabaseUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  const createdChargeIds: string[] = [];
  // The one structural row this spec adds. Removed in `finally`; nothing
  // existing is mutated, and no fixture owner changes hands.
  let createdQuoteLeafId: string | null = null;

  try {
    const tiers = await sql<{ id: string; label: string }[]>`
      select id, label from quote_tiers
      where quote_id = ${fixture.quoteId}
      order by sort_order
    `;
    expect(tiers.length, "r12Visual carries four alternatives").toBe(4);

    // Two EXISTING member owners. Charges hang off components already on the
    // quote; nothing about the quote's structure changes.
    const owners = await sql<{ id: string; name: string }[]>`
      select ql.id, l.name
      from quote_leaves ql
      join leaves l on l.id = ql.leaf_id
      where ql.quote_id = ${fixture.quoteId}
      order by ql.position
      limit 2
    `;
    expect(owners.length, "the fixture must have two grouped component owners").toBe(2);
    const [ownerA, ownerB] = owners;

    // ── the standalone owner ─────────────────────────────────────────────
    //
    // A Direct Product is a `quote_leaves` row with `assembly_id` NULL,
    // attached to a catalogue product. Written exactly as `attachDirectProduct`
    // writes it, minus the spec-authority pin: `leaf_spec_version_id` is
    // nullable, and minting a `leaf_specs` row here would be inventing
    // specification structure this spec has no mandate for.
    //
    // `commercial_kind` is DELIBERATELY NOT SET. It is maintained by the
    // database trigger `quote_leaves_commercial_kind_sync` and held to
    // `leaves.commercial_kind` by a composite foreign key; no writer in the
    // codebase sets it, and neither does this one.
    const [catalogueProduct] = await sql<{ id: string; name: string; sku: string }[]>`
      select l.id, l.name, l.sku
      from leaves l
      where l.commercial_kind = 'product'
        and l.sku is not null
        and l.id not in (
          select ql.leaf_id from quote_leaves ql where ql.quote_id = ${fixture.quoteId}
        )
      order by l.sku
      limit 1
    `;
    expect(
      catalogueProduct,
      "the catalogue must carry a product this quote has not already attached",
    ).toBeTruthy();

    createdQuoteLeafId = randomUUID();
    await sql`
      insert into quote_leaves (id, quote_id, assembly_id, leaf_id, quantity, position)
      values (
        ${createdQuoteLeafId}, ${fixture.quoteId}, null,
        ${catalogueProduct.id}, 1, 900
      )
    `;
    const standalone = { id: createdQuoteLeafId, name: catalogueProduct.name };

    const charges: SeededCharge[] = [
      {
        id: randomUUID(),
        chargeKey: "print_plates",
        label: `${TAG} four colour`,
        ownerQuoteLeafId: ownerA.id,
        toolingClassification: null,
        // UNEQUAL across every alternative.
        costs: { 0: "1200.00", 1: "900.00", 2: "750.00", 3: "600.00" },
      },
      {
        id: randomUUID(),
        chargeKey: "tooling",
        label: `${TAG} cavity A`,
        ownerQuoteLeafId: ownerA.id,
        toolingClassification: "cutting_die",
        // PARTIAL: two alternatives priced, two not.
        costs: { 0: "4800.00", 2: "4800.00" },
      },
      {
        id: randomUUID(),
        chargeKey: "tooling",
        label: `${TAG} cavity B`,
        ownerQuoteLeafId: ownerA.id,
        // Unclassified, which the surface marks rather than resolving.
        toolingClassification: null,
        // NO tier rows at all.
        costs: {},
      },
      {
        id: randomUUID(),
        chargeKey: "artwork_plate",
        label: `${TAG} carton artwork`,
        ownerQuoteLeafId: ownerB.id,
        toolingClassification: null,
        costs: { 1: "310.00" },
      },
      {
        id: randomUUID(),
        chargeKey: "print_plates",
        label: `${TAG} standalone plates`,
        // The STANDALONE owner. A Direct Product carries charges on its own
        // authority; nothing about a charge requires a group to hang from.
        ownerQuoteLeafId: standalone.id,
        toolingClassification: null,
        costs: { 0: "540.00", 2: "420.00" },
      },
    ];

    const labelsOf = (ownerId: string) =>
      charges.filter((c) => c.ownerQuoteLeafId === ownerId).map((c) => c.label);

    for (const charge of charges) {
      // `owner_ref` and `owner_quote_leaf_id` must agree — a CHECK ties them —
      // so the leaf id is written to both.
      await sql`
        insert into quote_charge_instances (
          id, quote_id, charge_key, tooling_classification, owner_ref,
          owner_quote_leaf_id, label
        ) values (
          ${charge.id}, ${fixture.quoteId}, ${charge.chargeKey},
          ${charge.toolingClassification}, ${charge.ownerQuoteLeafId},
          ${charge.ownerQuoteLeafId}, ${charge.label}
        )
      `;
      createdChargeIds.push(charge.id);
      for (const [tierIndex, cost] of Object.entries(charge.costs)) {
        await sql`
          insert into quote_charge_instance_tiers (charge_instance_id, tier_id, cost_amount)
          values (${charge.id}, ${tiers[Number(tierIndex)].id}, ${cost})
        `;
      }
    }

    // ── render ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1728, height: 1080 });
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) writes += 1;
    });

    const url = new URL(fixture.deepLinks.costs, "http://127.0.0.1:3100");
    url.searchParams.set("preview", "costs-m2");
    // Use Playwright's configured local server, not the URL parsing base.
    const response = await page.goto(`${url.pathname}${url.search}`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const preview = page.locator(".cm2");
    await expect(preview).toBeVisible();

    const rowFor = (label: string) =>
      preview.locator(".cm2-row", { has: page.locator(".cm2-label", { hasText: label }) });

    // ── Spreadsheet ──────────────────────────────────────────────────────
    await preview.getByRole("button", { name: "Spreadsheet", exact: true }).click();

    for (const charge of charges) {
      const row = rowFor(charge.label).first();
      await expect(row, `${charge.label} must render`).toBeVisible();
      await expect(row.locator(".cm2-tag", { hasText: "One-time cost" })).toHaveCount(1);

      // EVERY alternative has a cell, in the quote's tier order, holding what
      // was stored — or `unpriced` where nothing was. Never `0` for an absent
      // cost.
      const cells = row.locator(".cm2-value");
      await expect(cells).toHaveCount(tiers.length);
      for (let index = 0; index < tiers.length; index += 1) {
        const expected = charge.costs[index] ?? "unpriced";
        await expect(
          cells.nth(index),
          `${charge.label} at ${tiers[index].label}`,
        ).toHaveText(expected);
      }
    }

    // Charge-to-parent hierarchy. A charge is indented BELOW its owner, and the
    // nearest parent row above it is that owner. Misattribution is invisible in
    // any total, so it is asserted directly.
    const ownerAbove = (label: string) =>
      rowFor(label)
        .first()
        .evaluate((row) => {
          let node: Element | null = row;
          while ((node = node.previousElementSibling)) {
            if (node.classList.contains("cm2-parent")) {
              return node.querySelector(".cm2-label")?.textContent ?? "";
            }
          }
          return "";
        });

    // Owner name by leaf id, so an assertion names the component it expects
    // rather than inferring one.
    const ownerNameById = new Map<string, string>([
      [ownerA.id, ownerA.name],
      [ownerB.id, ownerB.name],
      [standalone.id, standalone.name],
    ]);

    for (const charge of charges) {
      const expectedOwner = ownerNameById.get(charge.ownerQuoteLeafId)!;
      expect(
        await ownerAbove(charge.label),
        `${charge.label} sits under its own owner`,
      ).toBe(expectedOwner);
      const indent = await rowFor(charge.label)
        .first()
        .locator(".cm2-ident")
        .getAttribute("data-indent");
      expect(
        Number(indent),
        `${charge.label} is indented below its owner`,
      ).toBeGreaterThan(0);
    }

// A STANDALONE owner needs no group. Its own row is a top-level parent —
    // `data-indent` is absent at depth 0 and `"1"` on a group member — so this
    // distinguishes "rendered as a Direct Product" from "rendered as a member",
    // which no charge-level assertion could tell apart.
    const standaloneParent = preview
      .locator(".cm2-row.cm2-parent", {
        has: page.locator(".cm2-label", { hasText: standalone.name }),
      })
      .first();
    await expect(standaloneParent, "the Direct Product has its own owner row").toBeVisible();
    expect(
      await standaloneParent.locator(".cm2-ident").getAttribute("data-indent"),
      "a Direct Product is not nested under an item group",
    ).toBeNull();
    await expect(
      standaloneParent.locator(".cm2-tag", { hasText: "product" }),
      "and is labelled a product, not a member",
    ).toHaveCount(1);
    // Its charge renders with every alternative, exactly as a grouped one does.
    await expect(
      rowFor(`${TAG} standalone plates`).first().locator(".cm2-value"),
    ).toHaveCount(tiers.length);


    // Two charges of one type on one component stay two, told apart by the
    // operator labels rather than merged.
    await expect(rowFor(`${TAG} cavity A`)).toHaveCount(1);
    await expect(rowFor(`${TAG} cavity B`)).toHaveCount(1);
    await expect(
      rowFor(`${TAG} cavity B`).locator(".cm2-tag", { hasText: "needs classification" }),
    ).toHaveCount(1);
    await expect(
      rowFor(`${TAG} cavity B`).locator(".cm2-tag", { hasText: "unpriced" }),
    ).toHaveCount(1);
    await expect(
      rowFor(`${TAG} cavity A`).locator(".cm2-tag", { hasText: "partly priced" }),
    ).toHaveCount(1);
    await expect(
      rowFor(`${TAG} four colour`).locator(".cm2-tag", { hasText: "priced" }),
    ).toHaveCount(1);

    await page.screenshot({
      path: testInfo.outputPath("charges-Spreadsheet.png"),
      fullPage: true,
    });

    // ── By module ────────────────────────────────────────────────────────
    await preview.getByRole("button", { name: "By module", exact: true }).click();
    for (const owner of [ownerA, ownerB, standalone]) {
      const mine = labelsOf(owner.id);
      const theirs = charges.map((c) => c.label).filter((l) => !mine.includes(l));
      const card = preview
        .locator(".cm2-owner", {
          has: page.locator(".cm2-owner-title", { hasText: owner.name }),
        })
        .first();
      const head = card.locator(".cm2-owner-head");
      if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      await expect(
        card.locator(".cm2-group-title", { hasText: "One-time charges" }),
      ).toHaveCount(1);
      for (const label of mine) {
        const row = card.locator(".cm2-row", {
          has: page.locator(".cm2-label", { hasText: label }),
        });
        await expect(row, `${label} under ${owner.name}`).toHaveCount(1);
        await expect(row.locator(".cm2-value")).toHaveCount(tiers.length);
      }
      for (const label of theirs) {
        await expect(
          card.locator(".cm2-row", { has: page.locator(".cm2-label", { hasText: label }) }),
          `${label} must not appear under ${owner.name}`,
        ).toHaveCount(0);
      }
      if (owner === ownerA) {
        await page.screenshot({ path: testInfo.outputPath("charges-By-module-grouped.png"), fullPage: true });
      }
    }
    await page.screenshot({
      path: testInfo.outputPath("charges-By-module.png"),
      fullPage: true,
    });

    // ── By product ───────────────────────────────────────────────────────
    await preview.getByRole("button", { name: "By product", exact: true }).click();
    // BOTH ownership shapes are focusable here, and a standalone owner is
    // reachable in the picker without a group above it.
    for (const owner of [ownerA, standalone]) {
      await preview
        .locator(".cm2-pick", {
          has: page.locator(".cm2-pick-name", { hasText: owner.name }),
        })
        .first()
        .click();
      for (const label of labelsOf(owner.id)) {
        const card = preview.locator(".cm2-edcard", {
          has: page.locator(".cm2-edtitle-text", { hasText: label }),
        });
        await expect(card, `${label} card under ${owner.name}`).toHaveCount(1);
        // Every alternative is stated even in the per-tier view: there is no
        // stored shared-mode intent, so the amounts show as recorded.
        await expect(
          card.locator(".cm2-edlabel", { hasText: "One-time amount" }),
        ).toHaveCount(tiers.length);
      }
      if (owner === ownerA) {
        await page.screenshot({
          path: testInfo.outputPath("charges-By-product.png"),
          fullPage: true,
        });
      }
    }
    await page.screenshot({
      path: testInfo.outputPath("charges-By-product-standalone.png"),
      fullPage: true,
    });

    // ── narrow ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 909, height: 900 });
    for (const name of ["Spreadsheet", "By product", "By module"]) {
      await preview.getByRole("button", { name, exact: true }).click();
      if (name === "By module") {
        const head = preview.locator(".cm2-owner", {
          has: page.locator(".cm2-owner-title", { hasText: ownerA.name }),
        }).first().locator(".cm2-owner-head");
        if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      }
      await page.screenshot({
        path: testInfo.outputPath(`charges-${name.replaceAll(" ", "-")}-909.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1728, height: 1080 });

    expect(writes, "navigating the preview must not write").toBe(0);
  } finally {
    // ONLY the rows this test created, by their own ids. Nothing existing is
    // touched and no reset is run.
    //
    // Order matters: the charge instances reference the standalone quote leaf,
    // and its catalogue product is protected by ON DELETE RESTRICT — so the
    // leaf goes last and the product is never at risk.
    if (createdChargeIds.length > 0) {
      await sql`
        delete from quote_charge_instance_tiers
        where charge_instance_id in ${sql(createdChargeIds)}
      `;
      await sql`delete from quote_charge_instances where id in ${sql(createdChargeIds)}`;
    }
    if (createdQuoteLeafId) {
      await sql`delete from quote_leaves where id = ${createdQuoteLeafId}`;
    }
    await sql.end();
  }
});

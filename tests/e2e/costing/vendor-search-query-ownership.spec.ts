/**
 * VAL-104 — a stale asynchronous completion must not overwrite a newer
 * operator search query.
 *
 * WHY THIS EXISTS
 *
 * Clearing a Pricing Vendor fires a save. The save's completion used to set
 * the search box back to the persisted vendor name — empty, after a clear —
 * and it arrived whenever the network returned it. An operator who started
 * typing a replacement in that window watched the box empty under them. The
 * surface then reported `No eligible HubSpot Vendors match “”`, which is a
 * true statement about a query they had not made.
 *
 * Nothing failed. No error, no rejected write, no console output. And there
 * was no moment after which typing was safe: the clear's operator-visible
 * effects — empty vendor, restored historical supplier — had all landed
 * before the reset arrived. The only observable that predicted it was the
 * network receipt, which is why VAL-104 had come to wait on one.
 *
 * WHAT IT ASSERTS
 *
 *   1. the race, deliberately: clear, reach the cleared state, type, and let
 *      the clear's completion land underneath the typing
 *   2. the query survives it
 *   3. results correspond to the query that is actually in the box
 *   4. clear still clears, when nothing follows it
 *
 * 4 is the half that a naive fix breaks — refusing every reset keeps the old
 * vendor name in the box after a clear.
 *
 * This is transient search-as-you-type state, so it takes no Pattern 47
 * blur/Enter contract. The repair is an ownership boundary: vendor DATA is
 * server-owned, search state is operator-owned, and a generation counter
 * covers the two-requests-in-flight case the boundary cannot.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test.describe.configure({ mode: "serial" });

test("VAL-104 a clear's completion cannot overwrite a newer vendor query", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const draft = manifest.quotes.draft;

  const pageFailures: string[] = [];
  page.on("pageerror", (error) => pageFailures.push(error.message));

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [fixtureLine] = await sql<{
    line_group_id: string;
    vendor_id: string | null;
    vendor_name: string | null;
  }[]>`
    select ali.line_group_id,
           ali.pricing_vendor_hubspot_company_id as vendor_id,
           ali.pricing_vendor_name_snapshot as vendor_name
    from assembly_leaf_inputs ali
    join assembly_leaves al on al.id = ali.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
    where a.quote_id = ${draft.quoteId}
    order by ali.sort_order, ali.line_group_id
    limit 1
  `;
  const lineGroupId = fixtureLine.line_group_id;

  // Captured, not assumed: VAL-104 leaves this line on a different vendor than
  // the seed does, and both run in this project. Restored in teardown so the
  // order these run in stays irrelevant (Pattern 53).
  const entryVendorId = fixtureLine.vendor_id;
  const entryVendorName = fixtureLine.vendor_name;

  const persistedVendor = async () => {
    const [row] = await sql<{ vendor_name: string | null }[]>`
      select pricing_vendor_name_snapshot as vendor_name
      from assembly_leaf_inputs
      where line_group_id = ${lineGroupId}
      order by tier_id limit 1
    `;
    return row?.vendor_name ?? null;
  };

  try {
    const response = await page.goto(draft.deepLinks.costs, {
      waitUntil: "networkidle",
    });
    expect(response?.status()).toBe(200);

    const row = page.locator(".r6-dt.pkg .r6-dt-row").first();
    const vendorInput = row.getByRole("searchbox", { name: "Pricing Vendor" });
    // Scoped to the vendor listbox by name. An unscoped getByRole("option")
    // resolves to the CATEGORY select's options -- fourteen of them, all
    // hidden -- and reports as the vendor result never appearing.
    const vendorResults = row
      .getByRole("listbox", { name: "Pricing Vendor results" })
      .getByRole("option");

    // A vendor has to be set for there to be a clear to race against. Chosen
    // through the UI rather than written to the row, so the value comes from
    // the same place production reads it from.
    async function selectAVendor() {
      if ((await row.getByRole("button", { name: "Clear Pricing Vendor" }).count()) > 0) return;
      await vendorInput.fill("Contract");
      const option = vendorResults.first();
      await expect(option).toBeVisible();
      const chosen = (await option.innerText()).trim();
      await option.click();
      await expect.poll(persistedVendor).toBe(chosen);
    }

    await selectAVendor();
    await expect(row.getByText("Selected vendor")).toBeVisible();

    // ── 1 · the race, on purpose ───────────────────────────────────────────
    //
    // Clear, then type WITHOUT waiting for the save. `pressSequentially`
    // rather than `fill` so the keystrokes land the way an operator's do —
    // `fill` sets the value in one shot and can complete before the save is
    // even dispatched, which is the one interleaving that cannot reproduce
    // this.
    await row.getByRole("button", { name: "Clear Pricing Vendor" }).click();
    await expect(vendorInput).toBeVisible();
    await expect(vendorInput).toHaveValue("");
    // The cleared state is operator-visible here: this is the moment after
    // which typing was supposed to be safe, and was not.
    await expect(row.getByText("Historical supplier")).toBeVisible();

    const query = "No Matching Vendor";
    await vendorInput.pressSequentially(query, { delay: 15 });

    // Let the clear's own completion land underneath the typing.
    await expect.poll(persistedVendor).toBeNull();

    // ── 2 · the query survives ─────────────────────────────────────────────
    await expect(vendorInput).toHaveValue(query);

    // ── 3 · results correspond to the query in the box ─────────────────────
    await expect(
      row.getByText(`No eligible HubSpot Vendors match “${query}”.`),
    ).toBeVisible();

    // And a query that does match resolves to ITS results, not the previous
    // one's -- the other half of correspondence.
    await vendorInput.fill("Contract");
    const option = vendorResults.first();
    await expect(option).toBeVisible();
    await expect(option).toContainText("Contract");
    await expect(
      row.getByText(`No eligible HubSpot Vendors match “${query}”.`),
    ).toHaveCount(0);

    // ── 4 · clear still clears, with nothing following it ──────────────────
    //
    // The failure mode a too-broad fix introduces: refuse every reset and the
    // cleared vendor's name stays in the box.
    const chosen = (await option.innerText()).trim();
    await option.click();
    await expect.poll(persistedVendor).toBe(chosen);

    // Reloaded first, deliberately. This half is about a clear with nothing
    // following it, so it starts from a current server snapshot rather than
    // from the end of the race above.
    //
    // It also sidesteps something this scenario is not about: after the
    // sequence above, the rendered vendor can fall back to the value the page
    // was loaded with -- neither the selection nor the cleared state, and
    // disagreeing with the row. That is store-snapshot staleness (Pattern 41),
    // it reproduces with the ownership repair reverted, and it is recorded
    // separately rather than folded in here.
    await page.reload({ waitUntil: "networkidle" });
    const settledRow = page.locator(".r6-dt.pkg .r6-dt-row").first();
    const settledInput = settledRow.getByRole("searchbox", {
      name: "Pricing Vendor",
    });
    await expect(settledRow.getByText("Selected vendor")).toBeVisible();

    await settledRow.getByRole("button", { name: "Clear Pricing Vendor" }).click();
    await expect(settledInput).toHaveValue("");
    await expect.poll(persistedVendor).toBeNull();
    // Still empty after the save has landed -- empty at first paint and
    // refilled by a late arrival would pass the assertion above and fail this
    // one, which is the whole point of checking twice.
    await expect(settledInput).toHaveValue("");

    expect(pageFailures, "no uncaught page errors").toEqual([]);
  } finally {
    await sql`
      update assembly_leaf_inputs
      set pricing_vendor_hubspot_company_id = ${entryVendorId},
          pricing_vendor_name_snapshot = ${entryVendorName}
      where line_group_id = ${lineGroupId}
    `;
    await sql.end();
  }
});

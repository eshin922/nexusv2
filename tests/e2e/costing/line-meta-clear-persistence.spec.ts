/**
 * P2-014 — a persisted clear must survive an unrelated edit on the same line.
 *
 * WHY THIS EXISTS
 *
 * Clearing a Pricing Vendor persisted correctly and was then silently undone
 * by editing a different field on the same row:
 *
 *   select a vendor → Clear → row is null → edit markup → the vendor the PAGE
 *   WAS LOADED WITH is back in the row
 *
 * No error. And the rendered chip agreed with the resurrected value, so nothing
 * gave the operator a reason to look again.
 *
 * The cause was one expression shape, used four times:
 *
 *   storeLineRow?.vendorId ?? line.vendorId
 *
 * `??` cannot distinguish "the store has no row for this line" from "the row
 * exists and its value is null". For a clearable field those are different
 * states, and only the first justifies falling back to the RSC prop. So a
 * cleared field resolved to the page-load value, that value reached local
 * state, and `fireMetaSave` sends `stateRef.current` — so the next save of any
 * field wrote it back.
 *
 * WHAT IT ASSERTS
 *
 *   1. the pre-store-row fallback still works — a fresh load renders the row's
 *      real values, which is the case the prop exists to serve
 *   2. vendor: the full destructive sequence, end to end
 *   3. markup: the same sequence, with an edit that does NOT auto-fill it
 *   4. category: the same sequence
 *
 * 3 needs care. Choosing a category deliberately writes that category's default
 * markup, so using a category change as markup's "unrelated edit" would prove
 * nothing — the write is intended. Vendor is the clean lever.
 *
 * A note on what a green run means. The defect only bites while the prop is
 * still stale, so it is a race with prop revalidation: category reproduced on
 * one probe run and not the next. These scenarios therefore assert the
 * INVARIANT (a persisted clear stays cleared), which holds regardless of who
 * wins that race, rather than trying to time the window.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

test.describe.configure({ mode: "serial" });

test("P2-014 a persisted clear survives an unrelated edit on the same line", async ({
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
  const [entry] = await sql<{
    line_group_id: string;
    vendor_id: string | null;
    vendor_name: string | null;
    markup: string | null;
    category: string | null;
  }[]>`
    select ali.line_group_id,
           ali.pricing_vendor_hubspot_company_id as vendor_id,
           ali.pricing_vendor_name_snapshot as vendor_name,
           ali.markup_pct::text as markup,
           ali.category
    from assembly_leaf_inputs ali
    join assembly_leaves al on al.id = ali.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
    where a.quote_id = ${draft.quoteId}
    order by ali.sort_order, ali.line_group_id
    limit 1
  `;
  const lineGroupId = entry.line_group_id;

  const persisted = async () => {
    const [row] = await sql<{
      v: string | null;
      m: string | null;
      c: string | null;
    }[]>`
      select pricing_vendor_name_snapshot v, markup_pct::text m, category c
      from assembly_leaf_inputs
      where line_group_id = ${lineGroupId}
      order by tier_id limit 1
    `;
    return row;
  };

  try {
    // ── 1 · the pre-store-row fallback ─────────────────────────────────────
    //
    // Before any interaction there is no store row to read, so the prop is the
    // only source — this is the case the fallback exists for, and narrowing it
    // to row-absence must not break it. Seed a known vendor and category first
    // so the assertion is against a value, not against whatever was left.
    await sql`
      update assembly_leaf_inputs
      set pricing_vendor_hubspot_company_id = '900000000000002',
          pricing_vendor_name_snapshot = 'Validation Contract Manufacturer',
          category = 'primary_packaging',
          markup_pct = 0.4000
      where line_group_id = ${lineGroupId}
    `;

    const response = await page.goto(draft.deepLinks.costs, {
      waitUntil: "networkidle",
    });
    expect(response?.status()).toBe(200);

    const row = page.locator(".r6-dt.pkg .r6-dt-row").first();
    const markup = row.locator(".markup input").first();
    const category = row.locator("select").first();

    await expect(row.getByText("Validation Contract Manufacturer")).toBeVisible();
    await expect(category).toHaveValue("primary_packaging");
    await expect(markup).toHaveValue("40");

    // ── 2 · vendor: the destructive sequence ───────────────────────────────
    //
    // The select is required. A bare clear does not reproduce the defect,
    // because the extra round-trip is what widens the window.
    await row.getByRole("button", { name: "Change" }).click();
    await row.getByRole("searchbox", { name: "Pricing Vendor" }).fill("Contract");
    const option = row
      .getByRole("listbox", { name: "Pricing Vendor results" })
      .getByRole("option")
      .first();
    await expect(option).toBeVisible();
    await option.click();
    await expect.poll(async () => (await persisted()).v).not.toBeNull();

    await row.getByRole("button", { name: "Clear Pricing Vendor" }).click();
    await expect.poll(async () => (await persisted()).v).toBeNull();

    // An unrelated field on the same line, and time for it to settle.
    await markup.fill("41");
    await markup.blur();
    await expect.poll(async () => (await persisted()).m).toBe("0.4100");

    expect(
      (await persisted()).v,
      "a persisted vendor clear was reversed by editing markup",
    ).toBeNull();
    await expect(row.getByText("Selected vendor")).toHaveCount(0);

    // ── 3 · markup ─────────────────────────────────────────────────────────
    //
    // Cleared markup means "inherit", which is a real state and not an absent
    // one. The unrelated edit is a vendor change: selecting a CATEGORY would
    // write that category's default markup by design, and prove nothing.
    await markup.fill("");
    await markup.blur();
    await expect.poll(async () => (await persisted()).m).toBeNull();

    await row.getByRole("searchbox", { name: "Pricing Vendor" }).fill("Contract");
    const option2 = row
      .getByRole("listbox", { name: "Pricing Vendor results" })
      .getByRole("option")
      .first();
    await expect(option2).toBeVisible();
    await option2.click();
    await expect.poll(async () => (await persisted()).v).not.toBeNull();

    expect(
      (await persisted()).m,
      "a persisted markup clear was reversed by setting a vendor",
    ).toBeNull();
    await expect(markup).toHaveValue("");

    // ── 4 · category ───────────────────────────────────────────────────────
    await category.selectOption({ index: 0 });
    await expect.poll(async () => (await persisted()).c).toBeNull();

    await row.getByRole("button", { name: "Clear Pricing Vendor" }).click();
    await expect.poll(async () => (await persisted()).v).toBeNull();

    expect(
      (await persisted()).c,
      "a persisted category clear was reversed by clearing the vendor",
    ).toBeNull();
    await expect(category).toHaveValue("");

    expect(pageFailures, "no uncaught page errors").toEqual([]);
  } finally {
    await sql`
      update assembly_leaf_inputs
      set pricing_vendor_hubspot_company_id = ${entry.vendor_id},
          pricing_vendor_name_snapshot = ${entry.vendor_name},
          markup_pct = ${entry.markup},
          category = ${entry.category}
      where line_group_id = ${lineGroupId}
    `;
    await sql.end();
  }
});

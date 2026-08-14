/**
 * Step 9 · post-drop runtime health.
 *
 * The specific failure this hunts is `42703 column does not exist`. Every
 * surface that ever read `leaves.product_type_id` or
 * `assemblies.product_type_id` is executed against the post-drop schema.
 *
 * READ-ONLY. No fixtures created, nothing mutated. The write paths are already
 * covered by the Step 8 harness, which creates products and attaches them.
 *
 * A loader that throws here is exactly the outage the deployment ordering was
 * built to avoid, so each is run individually and reported by name rather than
 * behind one aggregate pass.
 */

import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, leaves, quoteLeaves, quotes } from "@/db/schema";
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { loadLeafForSpecEntry } from "@/lib/leaf-spec-loader";
import { loadLibraryBrowse } from "@/lib/library-browse-loader";
import { loadQuoteAddendum } from "@/lib/addendum-loader";
import { loadProductTypeOptions } from "@/lib/product-type-options";

let checks = 0;
let failures = 0;
async function probe(name: string, fn: () => Promise<string>) {
  checks++;
  try {
    console.log(`  PASS  ${name}\n          ${await fn()}`);
  } catch (e) {
    failures++;
    const msg = e instanceof Error ? e.message : String(e);
    const is42703 = /column .* does not exist/i.test(msg);
    console.log(`  FAIL  ${name}`);
    console.log(`          ${is42703 ? "42703 LEGACY-COLUMN FAILURE — " : ""}${msg}`);
  }
}

async function main() {
  console.log("\nStep 9 post-drop runtime health\n");

  // A quote with real structure, so the loaders traverse rather than short-circuit.
  const [target] = await db
    .select({ quoteId: assemblies.quoteId })
    .from(assemblies)
    .where(isNotNull(assemblies.itemGroupCategoryId))
    .limit(1);
  const [directQuote] = await db
    .select({ quoteId: quoteLeaves.quoteId, leafId: quoteLeaves.leafId })
    .from(quoteLeaves)
    .limit(1);
  if (!target || !directQuote) throw new Error("no structure-bearing quote found");

  await probe("Setup · loadAssemblyTree", async () => {
    const t = await loadAssemblyTree(target.quoteId);
    const typed = [
      ...(t?.directProducts ?? []),
      ...(t?.assemblies ?? []).flatMap((a) => a.children),
    ].filter((n) => n.productType !== null).length;
    return `${t?.totalAssemblies} groups · ${t?.totalSkus} SKUs · ${typed} carrying a HubSpot Product Type`;
  });

  await probe("Setup · Item Group category options", async () => {
    const o = await loadProductTypeOptions();
    return `${o.itemGroupCategories.length} categories · ${o.leafTypes.length} spec schemas`;
  });

  await probe("Product Library · loadLibraryBrowse", async () => {
    const r = await loadLibraryBrowse({ targetQuoteId: target.quoteId, scopeFilter: "all" });
    return `${r.rows.length} rows returned`;
  });

  await probe("Product Library · HubSpot type filter", async () => {
    const r = await loadLibraryBrowse({
      targetQuoteId: target.quoteId,
      scopeFilter: "all",
      sourceTypeFilter: "Secondary",
    });
    return `${r.rows.length} rows classified Secondary`;
  });

  await probe("Spec entry · quote scope", async () => {
    const d = await loadLeafForSpecEntry(directQuote.leafId, { quoteId: directQuote.quoteId });
    return `type=${d?.productType?.name ?? "(none)"} state=${d?.specSchemaState}`;
  });

  await probe("Spec entry · Library scope", async () => {
    const d = await loadLeafForSpecEntry(directQuote.leafId, { library: true });
    return `type=${d?.productType?.name ?? "(none)"} state=${d?.specSchemaState}`;
  });

  await probe("Customer PDF · addendum read path", async () => {
    const a = await loadQuoteAddendum(target.quoteId);
    return a ? `assemblies=${a.assemblies?.length ?? 0}` : "null (no addendum content)";
  });

  // The whole population, not one sample: a residual reference would most
  // likely fire on a row shape the sample happens not to have.
  await probe("Setup · every structure-bearing quote loads", async () => {
    const all = await db
      .selectDistinct({ quoteId: quoteLeaves.quoteId })
      .from(quoteLeaves)
      .innerJoin(quotes, eq(quotes.id, quoteLeaves.quoteId));
    let ok = 0;
    for (const q of all) {
      await loadAssemblyTree(q.quoteId);
      ok++;
    }
    return `${ok}/${all.length} quotes loaded without error`;
  });

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

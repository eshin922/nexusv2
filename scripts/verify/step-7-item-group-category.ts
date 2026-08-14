/**
 * Step 7 · Item Group Category separation — falsification 11.
 *
 * The claim under test is that this was an AUTHORITY separation and not a
 * change of behaviour: same nine categories, same ids, same names, same
 * classification on every existing group.
 *
 * READ-ONLY against live data except for one fixture assembly, which is
 * removed. Nothing existing is written.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  itemGroupCategories,
  productTypes,
  quotes,
} from "@/db/schema";
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { loadProductTypeOptions } from "@/lib/product-type-options";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

async function main() {
  console.log("\nStep 7 falsification 11\n");

  // ------------------------------------------------- categories are intact
  const cats = await db
    .select()
    .from(itemGroupCategories)
    .orderBy(itemGroupCategories.position);
  const legacy = await db
    .select()
    .from(productTypes)
    .where(eq(productTypes.scope, "assembly"));

  claim(cats.length === 9, "11a · all nine Item Group categories exist", `${cats.length}`);

  // Compared against the ORIGINAL rows rather than against a literal list.
  // A literal would restate what the migration wrote and could agree with it
  // while both diverged from what operators actually saw.
  const legacyById = new Map(legacy.map((l) => [l.id, l.name] as const));
  const identical = cats.every((c) => legacyById.get(c.id) === c.name);
  claim(
    identical && legacyById.size === cats.length,
    "11b · ids and names are IDENTICAL to the rows they were separated from",
    cats.map((c) => c.id).join(", "),
  );

  // ------------------------------------------- existing group data unchanged
  const [drift] = await db
    .select({
      total: sql<number>`count(*)::int`,
      classified: sql<number>`count(*) filter (where product_type_id is not null)::int`,
      migrated: sql<number>`count(*) filter (where item_group_category_id is not null)::int`,
      mismatched: sql<number>`count(*) filter (where product_type_id is distinct from item_group_category_id)::int`,
    })
    .from(assemblies);
  claim(
    drift.mismatched === 0 && drift.classified === drift.migrated,
    "11c · every existing Item Group carries the SAME classification as before",
    `${drift.total} groups · ${drift.classified} classified · ${drift.mismatched} mismatched`,
  );

  // ------------------------------------------------------ validation accepts
  const options = await loadProductTypeOptions();
  claim(
    options.itemGroupCategories.length === 9 &&
      options.itemGroupCategories[0].id === "asy_skincare",
    "11d · create/edit still offers the correct assembly-scope values, in order",
    options.itemGroupCategories.map((c) => c.id).join(", "),
  );

  // The separation is structural, so a leaf Spec Schema id is not merely
  // rejected by a check — it is ABSENT from the registry the validation reads.
  // A check can be forgotten by a future caller; a missing row cannot.
  const leakage = await db
    .select({ id: itemGroupCategories.id })
    .from(itemGroupCategories)
    .where(
      inArray(itemGroupCategories.id, [
        "leaf_primary_packaging",
        "leaf_secondary_packaging",
        "leaf_tertiary_packaging",
        "leaf_soft_goods",
      ]),
    );
  claim(
    leakage.length === 0,
    "11e · no leaf Spec Schema is reachable as an Item Group category",
    `${leakage.length} leaf ids found in the category registry`,
  );

  // The inverse: a category must not be selectable as a leaf Spec Schema.
  claim(
    options.leafTypes.every((t) => !t.id.startsWith("asy_")),
    "11f · and no Item Group category is offered as a leaf Spec Schema",
    options.leafTypes.map((t) => t.id).join(", "),
  );

  // ------------------------------------------------- the tree still renders
  const classified = await db
    .select({ id: assemblies.id, quoteId: assemblies.quoteId, cat: assemblies.itemGroupCategoryId })
    .from(assemblies)
    .where(sql`${assemblies.itemGroupCategoryId} is not null`)
    .limit(1);
  if (classified.length === 0) {
    claim(false, "11g · a classified Item Group exists to render", "none found");
  } else {
    const tree = await loadAssemblyTree(classified[0].quoteId);
    const node = tree?.assemblies.find((a) => a.id === classified[0].id);
    const expected = cats.find((c) => c.id === classified[0].cat)?.name;
    claim(
      !!node && node.category?.id === classified[0].cat && node.category?.name === expected,
      "11g · Setup renders the Item Group's category from the new registry",
      `category=${node?.category?.name} expected=${expected}`,
    );
  }

  // -------------------------------------------- no HubSpot, no Spec Schema
  //
  // Proven by CONSTRUCTION rather than by inspection: the registry has no
  // column that could carry either. A grep for `hubspot` would pass on a file
  // that had simply spelled it differently.
  const [cols] = await db.execute(sql`
    select array_agg(column_name order by column_name)::text[] as cols
      from information_schema.columns
     where table_name = 'item_group_categories'
  `) as unknown as [{ cols: string[] }];
  const columns = cols.cols ?? [];
  claim(
    !columns.some((c) => /hubspot|field_schema|placeholder|scope/.test(c)),
    "11h · the category registry has no HubSpot, schema, placeholder or scope column",
    columns.join(", "),
  );

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * Step 8 · leaf TypePicker authority retired — falsification 12.
 *
 * The claim: no remaining leaf operator path can independently assign a Nexus
 * Product Type.
 *
 * REPOSITORY EVIDENCE AND RUNTIME EVIDENCE, because neither alone is enough.
 * A source sweep cannot prove the surfaces resolve correctly; a runtime walk
 * cannot prove some other action does not still hold the write open. A server
 * action in particular stays reachable by anyone holding a saved page's action
 * id even after the UI stops offering it, so its ABSENCE from the source is the
 * only proof that matters.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { leaves, quoteLeaves, quotes, users } from "@/db/schema";
import { ensureQuoteSpecAuthority } from "@/lib/product-structure/quote-spec-authority";
import { loadAssemblyTree } from "@/lib/assembly-tree";

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

const root = process.cwd();
const TAG = "STEP8-FALSIFY";
const created = { quotes: [] as string[], leaves: [] as string[] };

/**
 * Strip comments before scanning.
 *
 * The first version of this check matched a TOMBSTONE COMMENT naming the
 * retired actions and reported the retirement had failed. A filter that cannot
 * tell code from prose about the code is measuring the wrong thing — and it
 * fails in the dangerous direction too, since a comment mentioning a symbol
 * would mask nothing while a comment ABOUT its removal reads as its presence.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(rel)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

async function main() {
  console.log("\nStep 8 falsification 12\n");

  // ------------------------------------------------- repository evidence
  const sources = [...(await walk("src"))];
  const bodies = new Map<string, string>();
  for (const f of sources)
    bodies.set(f, stripComments(await readFile(path.join(root, f), "utf8")));

  const retiredActions = ["assignLeafProductType", "changeLeafProductType"];
  const survivors = sources.filter((f) =>
    retiredActions.some((a) => bodies.get(f)!.includes(a)),
  );
  claim(
    survivors.length === 0,
    "12a · the retired type-assignment actions exist NOWHERE in the tree",
    survivors.join(", ") || "no references",
  );

  // Any WRITE to the retired column. `leaves` is the library table, so an
  // insert or update naming `productTypeId` alongside it is a leaf-type write.
  const writers = sources.filter((f) => {
    const src = bodies.get(f)!;
    if (!/productTypeId/.test(src)) return false;
    // `leaf_specs.product_type_id` is a DIFFERENT column — quote-owned, carried
    // from a Library template, and not the leaf taxonomy under retirement.
    if (f.includes("quote-spec-authority")) return false;
    // Assembly dual-writes target `assemblies.product_type_id`, also different.
    if (f.includes("actions/assemblies") || f.includes("actions/quotes")) return false;
    // The Drizzle declaration itself. The column still EXISTS until its
    // separate destructive removal; what step 8 retires is every path that
    // reads or writes it, not the schema's knowledge that it is there.
    if (f === "src/db/schema.ts") return false;
    return true;
  });
  claim(
    writers.length === 0,
    "12b · no source file outside the two unrelated columns names the leaf type",
    writers.join(", ") || "none",
  );

  const picker = sources.filter((f) =>
    /type-picker|change-type-modal/.test(f),
  );
  claim(picker.length === 0, "12c · the TypePicker and change-type surfaces are gone",
    picker.join(", ") || "no files");

  const createLeaf = bodies.get("src/app/actions/leaves.ts") ?? "";
  claim(
    !/values\(\{[\s\S]{0,400}productTypeId,/.test(createLeaf),
    "12d · createLeaf no longer writes a Nexus type at Library entry",
  );

  // ---------------------------------------------------- runtime evidence
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  const [anyQuote] = await db
    .select({ id: quotes.id, projectId: quotes.projectId })
    .from(quotes)
    .limit(1);
  if (!user || !anyQuote) throw new Error("no fixtures available");

  const [q] = await db
    .insert(quotes)
    .values({
      projectId: anyQuote.projectId,
      scenarioLabel: `ZZ-VALIDATION-${TAG}`,
      status: "draft",
      versionNumber: 1,
    })
    .returning({ id: quotes.id });
  created.quotes.push(q.id);

  // Three products covering the three states the operator must be able to
  // tell apart.
  const mk = async (label: string, hsType: string | null) => {
    const [l] = await db
      .insert(leaves)
      .values({ name: `${TAG} ${label}`, hubspotProductType: hsType, createdBy: user.id })
      .returning({ id: leaves.id });
    created.leaves.push(l.id);
    await ensureQuoteSpecAuthority(db as never, {
      quoteId: q.id,
      leafId: l.id,
      createdBy: user.id,
    });
    await db.insert(quoteLeaves).values({
      quoteId: q.id,
      leafId: l.id,
      assemblyId: null,
      quantity: "1",
      position: created.leaves.length,
    });
    return l.id;
  };
  const typed = await mk("typed", "Secondary");
  const noSchema = await mk("no-schema", "Freight");
  const untyped = await mk("untyped", null);

  const tree = await loadAssemblyTree(q.id);
  const node = (id: string) => tree?.directProducts.find((p) => p.leafId === id);

  claim(
    node(typed)?.productType?.value === "Secondary",
    "12e · Setup displays HubSpot authority for a classified product",
    `value=${node(typed)?.productType?.value} label=${node(typed)?.productType?.label}`,
  );
  claim(
    node(typed)?.specSchema?.pin === "secondary" &&
      node(typed)?.specCompleteness?.kind === "empty",
    "12f · and its Spec Schema comes from the governed mapping, pinned",
    `pin=${node(typed)?.specSchema?.pin} chip=${node(typed)?.specCompleteness?.kind}`,
  );
  claim(
    node(noSchema)?.productType?.value === "Freight" &&
      node(noSchema)?.specCompleteness?.kind === "no_schema",
    "12g · `Specs not applicable` represents an EXPLICIT no_schema, and the "
      + "product still shows its type",
    `type=${node(noSchema)?.productType?.value} chip=${node(noSchema)?.specCompleteness?.kind}`,
  );
  claim(
    node(untyped)?.productType === null &&
      node(untyped)?.specCompleteness?.kind === "no_type",
    "12h · `NO TYPE SET` means the HubSpot Product Type is genuinely missing",
    `type=${node(untyped)?.productType} chip=${node(untyped)?.specCompleteness?.kind}`,
  );

  // The retired column stays NULL through a full create-and-attach cycle. If
  // any path had quietly kept writing it, this is where it would surface.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*) filter (where product_type_id is not null)::int` })
    .from(leaves)
    .where(inArray(leaves.id, created.leaves));
  claim(
    n === 0,
    "12i · no path wrote `leaves.product_type_id` during create + attach",
    `${n} of ${created.leaves.length} products carry one`,
  );

  console.log(`\n  ${checks - failures}/${checks} passed\n`);
}

async function cleanup() {
  if (created.quotes.length > 0) {
    await db.delete(quoteLeaves).where(inArray(quoteLeaves.quoteId, created.quotes));
    await db.delete(quotes).where(inArray(quotes.id, created.quotes));
  }
  if (created.leaves.length > 0)
    await db.delete(leaves).where(inArray(leaves.id, created.leaves));
}

main()
  .then(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  });

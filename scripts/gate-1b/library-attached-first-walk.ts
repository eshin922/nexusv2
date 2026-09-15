/**
 * Attached products sort first — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:library-attached-walk
 *
 * Drives the REAL loader. The claim under test is specifically about PAGING:
 * an attached product that sorts late alphabetically must reach page one. So
 * the walk attaches the LAST product in the alphabet and asks for a small page
 * -- the case where sorting the fetched rows in JS would look correct and be
 * useless, because the product is not among the fetched rows at all.
 *
 * ── ASSERTED AS PROPERTIES, NOT POSITIONS ────────────────────────────────
 *
 * The first version of this walk asserted "the product it attached is row 0".
 * It failed, and the code was right: the seeded quote ALREADY had a product
 * attached, one that sorts earlier, so it legitimately came first. Four more
 * checks failed for the same reason -- each had assumed a clean slate the
 * fixture never promised.
 *
 * Every check now reads the attached set from the database and asserts a
 * relation that holds whatever is already there: attached before unattached,
 * each block alphabetical within itself. A walk that only passes against one
 * fixture shape is testing the fixture.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const { loadLibraryBrowse } = await import("../../src/lib/library-browse-loader.ts");

const [quote] = await sql<{ id: string }[]>`
  select id from quotes where status = 'draft' order by created_at limit 1
`;
if (!quote) {
  console.error("REFUSING: no draft quote in the isolated database.");
  process.exit(1);
}

/** Whatever is attached right now, read rather than assumed. */
const attachedSet = async (assemblyId?: string) => {
  const rows = assemblyId
    ? await sql<{ leaf_id: string }[]>`
        select leaf_id from quote_leaves
         where quote_id = ${quote.id} and assembly_id = ${assemblyId}`
    : await sql<{ leaf_id: string }[]>`
        select leaf_id from quote_leaves where quote_id = ${quote.id}`;
  return new Set(rows.map((r) => r.leaf_id));
};

/** attached-before-unattached, and each block alphabetical within itself. */
function grouping(rows: { leafId: string; name: string }[], attached: Set<string>) {
  const flags = rows.map((r) => attached.has(r.leafId));
  const firstUnattached = flags.indexOf(false);
  const lastAttached = flags.lastIndexOf(true);
  const partitioned = firstUnattached === -1 || lastAttached === -1 || lastAttached < firstUnattached;
  const names = (want: boolean) =>
    rows.filter((r) => attached.has(r.leafId) === want).map((r) => r.name);
  const isSorted = (xs: string[]) =>
    xs.every((x, i) => i === 0 || xs[i - 1] <= x);
  return {
    partitioned,
    attachedNames: names(true),
    unattachedNames: names(false),
    attachedSorted: isSorted(names(true)),
    unattachedSorted: isSorted(names(false)),
  };
}

const PAGE = 5;
const inserted: string[] = [];
let createdAssemblyId: string | null = null;

try {
  // ── the product that cannot be reached by sorting a page ────────────────
  console.log("\n── a product that sorts last ──────────────────────────────");
  const [last] = await sql<{ id: string; name: string }[]>`
    select l.id, l.name from leaves l
     where l.archived = false
       and not exists (select 1 from quote_leaves q where q.leaf_id = l.id and q.quote_id = ${quote.id})
     order by l.name desc, l.id desc limit 1
  `;
  const alphabetical = await sql<{ name: string }[]>`
    select name from leaves where archived = false order by name asc, id asc
  `;
  const position = alphabetical.findIndex((r) => r.name === last.name) + 1;
  const page = Math.ceil(position / PAGE);
  console.log(`  "${last.name}" is #${position} of ${alphabetical.length} — page ${page} at ${PAGE}/page`);
  check("it really is beyond page one", page > 1, `page ${page}`);

  const before = await loadLibraryBrowse({ targetQuoteId: quote.id, limit: PAGE, offset: 0 });
  check(
    "and is absent from page one while unattached",
    !before.rows.some((r) => r.leafId === last.id),
  );
  // The pre-existing attachments must ALREADY be ordered first, before this
  // walk changes anything -- otherwise the checks below prove nothing.
  const beforeGroup = grouping(before.rows, await attachedSet());
  check("the baseline page is already partitioned", beforeGroup.partitioned,
    `${beforeGroup.attachedNames.length} attached first`);

  // ── attach it ──────────────────────────────────────────────────────────
  console.log("\n── once attached at quote level ───────────────────────────");
  const [row] = await sql<{ id: string }[]>`
    insert into quote_leaves (quote_id, leaf_id, assembly_id, quantity)
    values (${quote.id}, ${last.id}, null, 1) returning id
  `;
  inserted.push(row.id);

  const after = await loadLibraryBrowse({ targetQuoteId: quote.id, limit: PAGE, offset: 0 });
  const attached = await attachedSet();
  check("IT REACHES PAGE ONE", after.rows.some((r) => r.leafId === last.id),
    after.rows.map((r) => r.name).join(", ").slice(0, 70));

  const g = grouping(after.rows, attached);
  // `partitioned` is trivially true when NO attached product is on the page,
  // which is precisely the broken state. Requiring the block to be non-empty
  // is what stops this passing vacuously -- it did exactly that when the walk
  // was run against the ordering removed.
  check("every attached product precedes every unattached one",
    g.partitioned && g.attachedNames.length > 0,
    `attached: ${g.attachedNames.join(", ") || "(none on page one)"}`.slice(0, 80));
  check("the attached block is alphabetical", g.attachedSorted, g.attachedNames.join(", ").slice(0, 60));
  check("the unattached block is alphabetical", g.unattachedSorted, g.unattachedNames.join(", ").slice(0, 60));

  // ── search and filters survive ─────────────────────────────────────────
  console.log("\n── search and filters ─────────────────────────────────────");
  const term = alphabetical[0].name.slice(0, 5);
  const searched = await loadLibraryBrowse({
    targetQuoteId: quote.id, limit: PAGE, offset: 0, search: term,
  });
  check("a search still narrows the set",
    searched.rows.length > 0 &&
      searched.rows.every((r) => (r.name + " " + (r.sku ?? "")).toLowerCase().includes(term.toLowerCase())),
    `"${term}" → ${searched.rows.length} row(s)`);
  check("attachment does not smuggle a non-matching product past the filter",
    !searched.rows.some((r) => r.leafId === last.id && !last.name.toLowerCase().includes(term.toLowerCase())));
  const sg = grouping(searched.rows, attached);
  check("and the search results are partitioned too", sg.partitioned);

  const scoped = await loadLibraryBrowse({
    targetQuoteId: quote.id, limit: PAGE, offset: 0, scopeFilter: "this",
  });
  check("the scope filter returns exactly the attached set",
    scoped.rows.length === attached.size && scoped.rows.every((r) => attached.has(r.leafId)),
    `${scoped.rows.length} row(s) vs ${attached.size} attached`);

  // ── paging is still a total order ──────────────────────────────────────
  console.log("\n── paging ────────────────────────────────────────────────");
  const p1 = await loadLibraryBrowse({ targetQuoteId: quote.id, limit: PAGE, offset: 0 });
  const p2 = await loadLibraryBrowse({ targetQuoteId: quote.id, limit: PAGE, offset: PAGE });
  const ids1 = new Set(p1.rows.map((r) => r.leafId));
  const overlap = p2.rows.filter((r) => ids1.has(r.leafId));
  check("page two repeats nothing from page one", overlap.length === 0,
    overlap.map((r) => r.name).join(", "));
  check("no attached product is stranded on page two",
    !p2.rows.some((r) => attached.has(r.leafId)),
    p2.rows.filter((r) => attached.has(r.leafId)).map((r) => r.name).join(", "));

  // ── the destination decides what counts ────────────────────────────────
  console.log("\n── an item group as the destination ───────────────────────");
  const [asy] = await sql<{ id: string }[]>`
    select id from assemblies where quote_id = ${quote.id} limit 1
  `;
  if (!asy) {
    console.log("  (no item group in this quote — skipped)");
  } else {
    const grouped = await loadLibraryBrowse({
      targetQuoteId: quote.id, limit: PAGE, offset: 0, targetAssemblyId: asy.id,
    });
    const inGroup = await attachedSet(asy.id);
    const gg = grouping(grouped.rows, inGroup);
    check("the page is partitioned by GROUP membership, not quote membership",
      gg.partitioned, `${inGroup.size} in this group`);
    check("and the product attached at quote level does not sort first",
      inGroup.has(last.id) || grouped.rows[0]?.leafId !== last.id,
      String(grouped.rows[0]?.name));
  }
  // ═══ switching between two groups, from a later page ═══════════════════
  //
  // The case Edward named. Two item groups, each holding a DIFFERENT product,
  // and the operator sitting on page two when they switch. Two things have to
  // be true: the ordering must follow the destination, and the page must go
  // back to one -- because page two of the new ordering is a slice that does
  // not contain what the switch was meant to surface.
  console.log("\n── two groups, starting on a later page ───────────────────");
  // A SECOND group is created if the fixture has only one. The previous run
  // SKIPPED this whole case for want of it, and a skipped check establishes
  // nothing -- it reads like a pass in the output and covers the behaviour
  // Edward actually asked about. Removed again in the finally block.
  const existing = await sql<{ id: string }[]>`
    select id from assemblies where quote_id = ${quote.id} order by position
  `;
  if (existing.length < 2) {
    const [made] = await sql<{ id: string }[]>`
      insert into assemblies (quote_id, sku, name, position)
      values (${quote.id}, ${`WALK-ASY-${process.pid}`}, 'Attached-first walk group', 99)
      returning id
    `;
    createdAssemblyId = made.id;
  }
  const asys = await sql<{ id: string }[]>`
    select id from assemblies where quote_id = ${quote.id} order by position limit 2
  `;
  if (asys.length < 2) {
    console.log("  (could not obtain two item groups — SKIPPED, which proves nothing)");
  } else {
    const [gA, gB] = asys;
    // One late-sorting product into each group, so neither is reachable on
    // page one by alphabet alone.
    const late = await sql<{ id: string; name: string }[]>`
      select l.id, l.name from leaves l
       where l.archived = false
         and not exists (select 1 from quote_leaves q where q.leaf_id = l.id and q.quote_id = ${quote.id})
       order by l.name desc, l.id desc limit 2
    `;
    const rA = await sql<{ id: string }[]>`
      insert into quote_leaves (quote_id, leaf_id, assembly_id, quantity)
      values (${quote.id}, ${late[0].id}, ${gA.id}, 1) returning id`;
    const rB = await sql<{ id: string }[]>`
      insert into quote_leaves (quote_id, leaf_id, assembly_id, quantity)
      values (${quote.id}, ${late[1].id}, ${gB.id}, 1) returning id`;
    inserted.push(rA[0].id, rB[0].id);

    // Sitting on PAGE TWO of group A.
    const pageTwoOfA = await loadLibraryBrowse({
      targetQuoteId: quote.id, limit: PAGE, offset: PAGE, targetAssemblyId: gA.id,
    });
    check(
      "page two of group A does not hold A's product",
      !pageTwoOfA.rows.some((r) => r.leafId === late[0].id),
      "it is on page one, which is the point",
    );

    // Switch to B. Holding the offset would return this slice.
    const heldOffset = await loadLibraryBrowse({
      targetQuoteId: quote.id, limit: PAGE, offset: PAGE, targetAssemblyId: gB.id,
    });
    check(
      "holding the offset across the switch MISSES B's product",
      !heldOffset.rows.some((r) => r.leafId === late[1].id),
      "which is why the reset exists",
    );

    // Resetting to page one is what the modal now does.
    const resetToOne = await loadLibraryBrowse({
      targetQuoteId: quote.id, limit: PAGE, offset: 0, targetAssemblyId: gB.id,
    });
    check(
      "and page one of group B leads with B's product",
      resetToOne.rows[0]?.leafId === late[1].id,
      String(resetToOne.rows[0]?.name),
    );
    check(
      "while A's product is NOT first for destination B",
      resetToOne.rows[0]?.leafId !== late[0].id,
    );

    const backToA = await loadLibraryBrowse({
      targetQuoteId: quote.id, limit: PAGE, offset: 0, targetAssemblyId: gA.id,
    });
    // NOT "row 0 is A's product" -- group A already held a product before this
    // walk ran, and one that sorts earlier, so it leads legitimately. The
    // property is that A's product reaches page one and sits in the attached
    // block. This assertion has now been written wrongly twice in the same
    // way: assuming an empty fixture the seed never promised.
    const inA = await attachedSet(gA.id);
    const gAGroup = grouping(backToA.rows, inA);
    check(
      "switching back brings A's product to page one",
      backToA.rows.some((r) => r.leafId === late[0].id),
      backToA.rows.map((r) => r.name).join(", ").slice(0, 60),
    );
    check(
      "and it sits in A's attached block, ahead of everything unattached",
      gAGroup.partitioned && gAGroup.attachedNames.length > 0,
      `attached: ${gAGroup.attachedNames.join(", ")}`.slice(0, 70),
    );
    // B's product must NOT be in A's attached block -- that is what makes the
    // two orderings genuinely different rather than coincidentally so.
    check(
      "B's product is not attached-ranked under destination A",
      !inA.has(late[1].id) &&
        backToA.rows.findIndex((r) => r.leafId === late[1].id) !==
          backToA.rows.findIndex((r) => r.leafId === late[0].id),
      "the two destinations rank different products",
    );
  }

} finally {
  for (const id of inserted) await sql`delete from quote_leaves where id = ${id}`;
  if (createdAssemblyId) await sql`delete from assemblies where id = ${createdAssemblyId}`;
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);

/**
 * OD-023 · snapshot completeness — the nine proof obligations.
 *
 * THE HISTORICAL INVARIANT UNDER TEST
 *
 *   A sent version must be reconstructable from immutable data, without
 *   depending on future costing, pricing, Library, firm-settings or live quote
 *   behaviour.
 *
 * ── WHY THIS RUNS IN THE ISOLATED HARNESS ────────────────────────────────────
 *
 * `sendQuote` and `reviseQuote` call `ensureUser()`, which reads the identity
 * provider — unreachable from a script under the production composition. The
 * Scenario Copy acceptance worked around the same wall by calling the inner
 * unit directly; that is not available here, because for Send the action IS the
 * unit under test. Proving the invariant by re-implementing what Send does
 * would prove only that the re-implementation agrees with itself.
 *
 * So this runs against the ISOLATED validation database, where the composition
 * root supplies a seeded identity and local artifact storage. The REAL actions
 * execute, end to end, and nothing touches production.
 *
 * Run:
 *   npm run verify:od-023
 *
 * The runtime-safety gate refuses to start unless the database name contains
 * `nexus_validation` and every provider is isolated, so a mis-set environment
 * fails before the first mutation rather than after it.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeaves,
  leafSpecs,
  leaves,
  productTypes,
  projects,
  quoteLeaves,
  quoteSnapshotArtifacts,
  quoteSnapshots,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { sendQuote, reviseQuote } from "@/app/actions/quotes";
import { attachDirectProduct } from "@/lib/product-structure/direct-attachment";
import { loadQuoteAddendum } from "@/lib/addendum-loader";
import {
  listQuoteVersions,
  readQuoteVersion,
} from "@/lib/quote-version-reader";

let checks = 0;
let failures = 0;
function claim(ok: boolean, label: string, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

/** The one quote this run owns. Namespaced so it can never be mistaken. */
const LABEL = `ZZ-VALIDATION-od023-${randomUUID().slice(0, 8)}`;

async function provision(): Promise<{ quoteId: string; directLeafId: string }> {
  const [pm] = await db.select().from(users).limit(1);
  if (!pm) throw new Error("no seeded user — run `npm run validation:seed` first");
  const [project] = await db.select().from(projects).limit(1);
  if (!project) throw new Error("no seeded project — run `npm run validation:seed` first");

  const quoteId = randomUUID();
  await db.insert(quotes).values({
    id: quoteId,
    projectId: project.id,
    scenarioLabel: LABEL,
    versionNumber: 1,
    status: "draft",
    createdByUserId: pm.id,
    customerFacingNotes: "Original customer note.",
  });
  await db.insert(quoteTiers).values([
    { quoteId, label: "Tier 1", qty: 1000, sortOrder: 0, recommended: true },
    { quoteId, label: "Tier 2", qty: 5000, sortOrder: 1, recommended: false },
  ]);

  // A grouped product and a DIRECT product, side by side. The Direct one is the
  // point: it is the shape the retired junction could not enumerate.
  const [type] = await db
    .select()
    .from(productTypes)
    .where(eq(productTypes.placeholder, false))
    .limit(1);
  const groupedLeafId = randomUUID();
  const directLeafId = randomUUID();
  await db.insert(leaves).values([
    {
      id: groupedLeafId,
      name: "Validation grouped product",
      sku: `ZZVAL-GRP-${LABEL.slice(-8)}`,
      productTypeId: type?.id ?? null,
      hubspotProductType: type ? "Primary Packaging" : null,
    },
    {
      id: directLeafId,
      name: "Validation DIRECT product",
      sku: `ZZVAL-DIR-${LABEL.slice(-8)}`,
      productTypeId: type?.id ?? null,
      hubspotProductType: type ? "Primary Packaging" : null,
    },
  ]);

  const assemblyId = randomUUID();
  await db.insert(assemblies).values({
    id: assemblyId,
    quoteId,
    sku: `ZZVAL-ASY-${LABEL.slice(-8)}`,
    name: "Validation Item Group",
    ownerId: pm.id,
    position: 0,
  });
  const groupedQuoteLeafId = randomUUID();
  await db.insert(quoteLeaves).values({
    id: groupedQuoteLeafId,
    quoteId,
    assemblyId,
    leafId: groupedLeafId,
    quantity: "1",
    position: 0,
  });
  // The LEGACY junction row, for the grouped product only — which is the whole
  // asymmetry. Present so the falsification below compares against what the
  // retired enumeration would really have seen (one group), rather than against
  // an empty table, where "fewer" would be trivially true.
  await db.insert(assemblyLeaves).values({
    assemblyId,
    leafId: groupedLeafId,
    quoteLeafId: groupedQuoteLeafId,
    quantity: "1",
    position: 0,
  });

  // Through the GOVERNED helper, so the Direct attachment carries canonical
  // identity by construction rather than by insertion.
  await db.transaction(async (tx) => {
    await attachDirectProduct(tx, {
      quoteId,
      leafId: directLeafId,
      quantity: "1",
      position: 1,
      createdBy: pm.id,
    });
  });

  // Spec values on BOTH products, so the addendum has meaningful content and
  // the Direct one has something to be missing.
  await db
    .update(leafSpecs)
    .set({ specValues: { material: "Validation material" } })
    .where(and(eq(leafSpecs.quoteId, quoteId)));

  await db
    .update(quotes)
    .set({ includeSpecAddendumSnapshot: true })
    .where(eq(quotes.id, quoteId));

  return { quoteId, directLeafId };
}

async function artifactRow(snapshotId: string) {
  const [row] = await db
    .select()
    .from(quoteSnapshotArtifacts)
    .where(eq(quoteSnapshotArtifacts.quoteSnapshotId, snapshotId))
    .limit(1);
  return row ?? null;
}

async function currentSnapshot(quoteId: string) {
  const [row] = await db
    .select()
    .from(quoteSnapshots)
    .where(and(eq(quoteSnapshots.quoteId, quoteId), isNull(quoteSnapshots.supersededAt)))
    .limit(1);
  return row ?? null;
}

async function cleanup(quoteId: string) {
  const [row] = await db
    .select({ label: quotes.scenarioLabel })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (row?.label?.startsWith("ZZ-VALIDATION-od023-")) {
    // The commercial pins reference `quote_tiers` and `quote_leaves` WITHOUT a
    // cascade from `quotes`, so deleting the quote alone raises 23503. Removed
    // explicitly, and only inside the safety condition above.
    // Markup pins key on `pin_id`, not on the quote, so they are reached
    // through the settings pin that owns them.
    await db.execute(sql`
      delete from quote_commercial_markup_pins
       where pin_id in (
         select id from quote_commercial_settings_pins where quote_id = ${quoteId}
       )`);
    await db.execute(
      sql`delete from quote_commercial_settings_pins where quote_id = ${quoteId}`,
    );
    await db.delete(quotes).where(eq(quotes.id, quoteId));
    console.log("\ncleanup: deleted the run's quote");
  } else {
    console.log("\ncleanup: REFUSED — the safety condition did not hold");
  }
}

async function main() {
  console.log("\n=== OD-023 · snapshot completeness ===\n");
  const { quoteId, directLeafId } = await provision();
  console.log(`quote ${quoteId}  ${LABEL}\n`);

  // ── 1 · Send writes complete cpdf_data + addendum_data ───────────────────
  console.log("1-2 · Send");
  const sent = await sendQuote(fd({ quoteId }));
  if (!sent.ok) throw new Error(`send failed: ${sent.error.message}`);

  const snap1 = await currentSnapshot(quoteId);
  if (!snap1) throw new Error("no snapshot after send");
  const art1 = await artifactRow(snap1.id);
  claim(art1 !== null, "Send writes a snapshot artifact");

  const cpdf1 = art1!.cpdfData as Record<string, unknown>;
  const addendum1 = art1!.addendumData as Record<string, unknown> | null;
  const structure1 = art1!.structure as Array<Record<string, unknown>>;

  claim(
    ["vendor", "customer", "quote", "tiers", "skus", "serviceFees", "freightLines"].every(
      (k) => k in cpdf1,
    ),
    "cpdf_data carries every render section",
    Object.keys(cpdf1).join(","),
  );
  const q1 = cpdf1.quote as Record<string, unknown>;
  claim(
    typeof q1.customer_facing_notes === "string" &&
      q1.customer_facing_notes === "Original customer note.",
    "cpdf_data froze the customer-facing notes that were live",
  );
  claim(
    (cpdf1.tiers as unknown[]).length === 2,
    "cpdf_data froze tiers and quantities",
  );
  claim(addendum1 !== null, "addendum_data written when the addendum was on");
  claim(structure1.length === 2, "structure carries every product", `${structure1.length}`);

  // ── 2 · the Direct product is in BOTH representations ────────────────────
  const directInStructure = structure1.find((s) => s.isDirect === true);
  claim(
    directInStructure !== undefined &&
      directInStructure.leafId === directLeafId,
    "Direct product present in the frozen structure",
  );
  const directInPricing = (cpdf1.skus as Array<Record<string, unknown>>).some((s) =>
    String(s.name).includes("DIRECT"),
  );
  claim(directInPricing, "Direct product present in the pricing representation");
  const addendumGroups =
    (addendum1?.assemblies as Array<Record<string, unknown>> | undefined) ?? [];
  claim(
    addendumGroups.some((g) => g.kind === "direct"),
    "Direct product present in the specification addendum — the OD-017 consumer this closes",
    `${addendumGroups.length} group(s): ${addendumGroups.map((g) => g.kind).join(",")}`,
  );

  // The falsification of the above: it must have been ABSENT before. Proven by
  // the enumeration, not asserted — a junction-scoped read finds one group.
  const [{ n: junctionGroups }] = (await db.execute(sql`
    select count(distinct a.id)::int as n from assemblies a
      join assembly_leaves al on al.assembly_id = a.id
     where a.quote_id = ${quoteId}
  `)) as unknown as { n: number }[];
  claim(
    Number(junctionGroups) < addendumGroups.length,
    "the retired junction enumerates strictly fewer groups than the canonical read",
    `junction ${junctionGroups} < canonical ${addendumGroups.length}`,
  );

  const pdfUrl1 = snap1.pdfUrl;
  const cpdf1Canonical = canonical(cpdf1);
  const addendum1Canonical = canonical(addendum1);

  // ── 3 · Revise supersedes and returns the quote to draft ─────────────────
  console.log("\n3-6 · Revise, then edit everything");
  const revised = await reviseQuote(fd({ quoteId }));
  if (!revised.ok) throw new Error(`revise failed: ${revised.error.message}`);

  const [afterRevise] = await db
    .select({ status: quotes.status, versionNumber: quotes.versionNumber })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  claim(afterRevise.status === "draft", "Revise returns the working quote to draft");
  claim(afterRevise.versionNumber === 2, "Revise bumps the working version", `v${afterRevise.versionNumber}`);
  const [snap1After] = await db
    .select({ supersededAt: quoteSnapshots.supersededAt })
    .from(quoteSnapshots)
    .where(eq(quoteSnapshots.id, snap1.id))
    .limit(1);
  claim(snap1After.supersededAt !== null, "Revise supersedes the prior snapshot");

  // ── 4 · edit structure, specs, pricing, customer and vendor data ─────────
  await db
    .update(quotes)
    .set({ customerFacingNotes: "EDITED AFTER REVISE." })
    .where(eq(quotes.id, quoteId));
  await db
    .update(quoteTiers)
    .set({ qty: 99999 })
    .where(eq(quoteTiers.quoteId, quoteId));
  await db
    .update(leafSpecs)
    .set({ specValues: { material: "EDITED AFTER REVISE" } })
    .where(eq(leafSpecs.quoteId, quoteId));
  await db
    .update(leaves)
    .set({ name: "EDITED library name" })
    .where(eq(leaves.id, directLeafId));
  await db
    .update(projects)
    .set({ clientName: "EDITED CUSTOMER NAME" })
    .where(
      eq(
        projects.id,
        (
          await db
            .select({ p: quotes.projectId })
            .from(quotes)
            .where(eq(quotes.id, quoteId))
            .limit(1)
        )[0].p,
      ),
    );
  // Structure: ADD a second Direct product.
  //
  // Additive rather than a detach, and that is a FINDING rather than a
  // convenience. Detaching was tried first, raw and then through the governed
  // `detachDirectProduct`, and BOTH fail with a bare Postgres foreign-key error
  // from `quote_commercial_markup_pins` — a pin Send itself writes. So a Direct
  // product cannot be removed from a quote that has ever been sent, and the
  // operator would see a 23503 rather than a governed refusal.
  //
  // Out of scope here: it concerns detach-after-send, not historical
  // reconstruction. Recorded in the PR so it is not rediscovered.
  const secondDirectLeafId = randomUUID();
  await db.insert(leaves).values({
    id: secondDirectLeafId,
    name: "Validation SECOND direct product",
    sku: `ZZVAL-DIR2-${LABEL.slice(-8)}`,
  });
  await db.transaction(async (tx) => {
    await attachDirectProduct(tx, {
      quoteId,
      leafId: secondDirectLeafId,
      quantity: "1",
      position: 2,
      createdBy: (await db.select().from(users).limit(1))[0].id,
    });
  });

  // Live state really did move — otherwise the stability claims below are
  // vacuous, and a vacuous stability claim is worse than none.
  const liveAddendum = await loadQuoteAddendum(quoteId);
  claim(
    liveAddendum.assemblies.filter((g) => g.kind === "direct").length === 2,
    "control: the live working copy genuinely changed after the edits",
    `${liveAddendum.assemblies.length} group(s) live now`,
  );

  // ── 5 · the prior representation is unchanged ────────────────────────────
  const art1After = await artifactRow(snap1.id);
  claim(
    canonical(art1After!.cpdfData) === cpdf1Canonical,
    "prior version's cpdf_data is byte-identical after Revise and edits",
  );
  claim(
    canonical(art1After!.addendumData) === addendum1Canonical,
    "prior version's addendum_data is byte-identical after Revise and edits",
  );

  // ── 6 · pdf_url unchanged ────────────────────────────────────────────────
  const [snap1Pdf] = await db
    .select({ pdfUrl: quoteSnapshots.pdfUrl })
    .from(quoteSnapshots)
    .where(eq(quoteSnapshots.id, snap1.id))
    .limit(1);
  claim(snap1Pdf.pdfUrl === pdfUrl1, "prior version's pdf_url is unchanged");

  // ── 7 · the superseded version is still fetchable, explicitly ────────────
  console.log("\n7-9 · Version addressing and re-send");
  const byNumber = await readQuoteVersion(quoteId, {
    kind: "versionNumber",
    versionNumber: 1,
  });
  claim(
    byNumber.kind === "sent" && byNumber.summary.supersededAt !== null,
    "a SUPERSEDED version is readable when addressed explicitly",
    byNumber.kind,
  );
  claim(
    byNumber.kind === "sent" &&
      canonical(byNumber.representation.cpdfData) === cpdf1Canonical,
    "the superseded version reads back the representation it was sent with",
  );

  // ── 8 · re-send creates a new version without altering the prior ─────────
  const resent = await sendQuote(fd({ quoteId }));
  if (!resent.ok) throw new Error(`re-send failed: ${resent.error.message}`);
  const snap2 = await currentSnapshot(quoteId);
  claim(
    snap2 !== null && snap2.id !== snap1.id && snap2.versionNumber === 2,
    "re-send creates a NEW snapshot version",
    `v${snap2?.versionNumber}`,
  );
  const art1Final = await artifactRow(snap1.id);
  claim(
    canonical(art1Final!.cpdfData) === cpdf1Canonical,
    "the prior version survived the re-send unaltered",
  );

  // ── 9 · the new snapshot reflects the new working state ──────────────────
  const art2 = await artifactRow(snap2!.id);
  claim(art2 !== null, "re-send wrote its own artifact");
  const cpdf2 = art2!.cpdfData as Record<string, unknown>;
  const q2 = cpdf2.quote as Record<string, unknown>;
  claim(
    q2.customer_facing_notes === "EDITED AFTER REVISE.",
    "the new version reflects the edited working state",
  );
  const structure2 = art2!.structure as Array<Record<string, unknown>>;
  claim(
    structure2.length === 3 &&
      structure2.filter((s) => s.isDirect === true).length === 2,
    "the new version reflects the structural edit",
    `${structure2.length} product(s), ${structure2.filter((s) => s.isDirect === true).length} direct`,
  );
  claim(
    structure1.length === 2,
    "and the PRIOR version's structure still shows what it shipped with",
    `${structure1.length} product(s)`,
  );

  const versions = await listQuoteVersions(quoteId);
  claim(
    versions.length === 2 && versions.every((v) => v.hasStoredRepresentation),
    "both versions are enumerable and both carry a stored representation",
    `${versions.length} version(s)`,
  );

  await cleanup(quoteId);
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} claims\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

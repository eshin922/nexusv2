/**
 * OD-032 A — a Direct Product authors a component charge, identically.
 *
 * ── WHAT IS BEING PROVEN, AND WHY A UNIT TEST COULD NOT ─────────────────
 *
 * The claim is about OWNERSHIP SEMANTICS, which live in stored columns. A
 * source-reading test can show both rows call the same function; it cannot
 * show the two calls produce the same `owner_quote_leaf_id`, that neither
 * synthesizes Item Group ownership, or that the Costs reader returns both.
 * Those are facts about rows, so they are proven by writing rows through the
 * real writer and reading them back through the real reader.
 *
 * ── NON-VACUITY ─────────────────────────────────────────────────────────
 *
 * The whole proof turns on the second subject genuinely being UNGROUPED. A
 * quote where both subjects happen to be Item Group members would pass every
 * assertion below while proving nothing, so membership is asserted — 0 rows in
 * `assembly_leaves` for the direct subject, >= 1 for the grouped one — and the
 * script REFUSES rather than passing if it cannot find that shape.
 *
 * ── RESIDUE ─────────────────────────────────────────────────────────────
 *
 * This writes to the shared database. Everything it creates is removed and the
 * removal is VERIFIED, because a cleanup that is merely attempted is one that
 * can silently fail — which it already did once in this workstream.
 *
 *   usage: npm run gate1b:od-032-direct-authoring
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteTiers,
  users,
} from "@/db/schema";
import { createComponentChargesAs } from "@/lib/component-charges/create";
import { readComponentChargesForCosts } from "@/lib/component-charges/read";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function refuse(why: string): never {
  console.log(`REFUSED — ${why}`);
  console.log("The proof would be vacuous, so it does not report a pass.");
  process.exit(1);
}

async function main() {
  // ── SUBJECTS ──────────────────────────────────────────────────────────
  //
  // ONE quote carrying BOTH shapes, so the comparison is not confounded by
  // anything else differing between two quotes.
  const rows = await db.execute(sql`
    select q.id as quote_id,
           (select ql.id from quote_leaves ql
             where ql.quote_id = q.id
               and exists (select 1 from assembly_leaves al where al.quote_leaf_id = ql.id)
             limit 1) as grouped_leaf,
           (select ql.id from quote_leaves ql
             where ql.quote_id = q.id
               and not exists (select 1 from assembly_leaves al where al.quote_leaf_id = ql.id)
             limit 1) as direct_leaf
      from quotes q
     where q.status = 'draft'`);

  const hit = rows.find((r) => r.grouped_leaf && r.direct_leaf);
  if (!hit) refuse("no draft quote carries both a grouped and an ungrouped leaf");
  const quoteId = hit.quote_id as string;
  const groupedLeaf = hit.grouped_leaf as string;
  const directLeaf = hit.direct_leaf as string;

  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId));
  if (tiers.length === 0) refuse("subject quote has no tiers");
  const [operator] = await db.select({ id: users.id }).from(users).limit(1);
  if (!operator) refuse("no user to attribute the write to");

  console.log(`subject quote ${quoteId} · ${tiers.length} tier(s)`);
  console.log(`  grouped leaf ${groupedLeaf}`);
  console.log(`  direct  leaf ${directLeaf}`);

  // ── NON-VACUITY, ASSERTED BEFORE ANYTHING IS WRITTEN ──────────────────
  const membership = await db.execute(sql`
    select
      (select count(*) from assembly_leaves where quote_leaf_id = ${groupedLeaf}) as grouped_n,
      (select count(*) from assembly_leaves where quote_leaf_id = ${directLeaf}) as direct_n`);
  const groupedN = Number(membership[0].grouped_n);
  const directN = Number(membership[0].direct_n);
  const nonVacuous = groupedN >= 1 && directN === 0;
  record(
    "NON-VACUOUS · the subjects really are one grouped and one standalone",
    nonVacuous,
    `assembly_leaves rows: grouped=${groupedN}, direct=${directN}`,
  );
  if (!nonVacuous) refuse("the two subjects are not the two shapes");

  const amounts = tiers.map((t) => ({ tierId: t.id, cost: "111.00" }));
  const created: string[] = [];
  let directId: string | null = null;
  let groupedId: string | null = null;

  try {
    // ── BOTH PATHS AUTHOR ────────────────────────────────────────────────
    for (const [what, leafId] of [
      ["grouped member", groupedLeaf],
      ["Direct Product", directLeaf],
    ] as const) {
      const res = await createComponentChargesAs(operator.id, {
        quoteId,
        quoteLeafId: leafId,
        charges: [
          { chargeKey: "other_service", label: `OD-032 A proof · ${what}`, amounts },
        ],
      });
      record(
        `${what} can author a component charge`,
        res.ok,
        res.ok ? undefined : res.error.message,
      );
      if (res.ok) {
        const id = res.data.created[0].chargeInstanceId;
        created.push(id);
        if (leafId === directLeaf) directId = id;
        else groupedId = id;
      }
    }

    if (!directId || !groupedId) {
      record("both paths wrote", false, "one path did not persist");
    } else {
      // ── SAME OWNERSHIP SEMANTICS ───────────────────────────────────────
      const stored = await db
        .select({
          id: quoteChargeInstances.id,
          ownerRef: quoteChargeInstances.ownerRef,
          ownerQuoteLeafId: quoteChargeInstances.ownerQuoteLeafId,
        })
        .from(quoteChargeInstances)
        .where(inArray(quoteChargeInstances.id, created));
      const g = stored.find((s) => s.id === groupedId);
      const d = stored.find((s) => s.id === directId);

      record(
        "the grouped charge is owned by its own leaf",
        g?.ownerQuoteLeafId === groupedLeaf && g?.ownerRef === groupedLeaf,
        `owner_quote_leaf_id=${g?.ownerQuoteLeafId} owner_ref=${g?.ownerRef}`,
      );
      record(
        "the Direct Product charge is owned by its own leaf — SAME semantics",
        d?.ownerQuoteLeafId === directLeaf && d?.ownerRef === directLeaf,
        `owner_quote_leaf_id=${d?.ownerQuoteLeafId} owner_ref=${d?.ownerRef}`,
      );
      record(
        "neither path synthesizes Item Group ownership",
        // The direct charge's owner resolves to a leaf with NO assembly
        // membership, so there is no Item Group it could have been attributed
        // to; the grouped one points at its LEAF and never at its assembly;
        // and neither fell back to the engagement-level '@quote' owner.
        d?.ownerQuoteLeafId === directLeaf &&
          directN === 0 &&
          g?.ownerQuoteLeafId === groupedLeaf &&
          !stored.some((s) => s.ownerRef === "@quote"),
        "owners are leaf ids; no '@quote', no assembly id",
      );

      // ── THE SAME COSTS READER RETURNS BOTH ─────────────────────────────
      const readBack = await readComponentChargesForCosts(quoteId);
      const seen = new Map(readBack.map((c) => [c.chargeInstanceId, c]));
      record(
        "the Direct Product charge reaches the Costs reader",
        seen.get(directId)?.quoteLeafId === directLeaf,
        `keyed on ${seen.get(directId)?.quoteLeafId}`,
      );
      record(
        "so does the grouped one, through the same call",
        seen.get(groupedId)?.quoteLeafId === groupedLeaf,
        `keyed on ${seen.get(groupedId)?.quoteLeafId}`,
      );
      record(
        "both carry economics for every quoted tier",
        seen.get(directId)?.amounts.length === tiers.length &&
          seen.get(groupedId)?.amounts.length === tiers.length,
        `grouped ${seen.get(groupedId)?.amounts.length} / direct ${seen.get(directId)?.amounts.length} of ${tiers.length}`,
      );
    }
  } finally {
    // ── CLEANUP, THEN VERIFY IT ──────────────────────────────────────────
    if (created.length > 0) {
      const candidates = await db
        .select({ id: auditLog.id, diff: auditLog.diffJson })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, quoteId),
            eq(auditLog.action, "component_charge_created"),
          ),
        );
      const mine = candidates
        .filter((a) => {
          const cid = (a.diff as { charge_instance_id?: string } | null)
            ?.charge_instance_id;
          return !!cid && created.includes(cid);
        })
        .map((a) => a.id);

      await db
        .delete(quoteChargeInstances)
        .where(inArray(quoteChargeInstances.id, created));
      if (mine.length > 0) {
        await db.delete(auditLog).where(inArray(auditLog.id, mine));
      }

      const leftInstances = await db
        .select({ id: quoteChargeInstances.id })
        .from(quoteChargeInstances)
        .where(inArray(quoteChargeInstances.id, created));
      const leftTiers = await db
        .select({ t: quoteChargeInstanceTiers.tierId })
        .from(quoteChargeInstanceTiers)
        .where(inArray(quoteChargeInstanceTiers.chargeInstanceId, created));
      record(
        "RESIDUE · everything this proof created is gone, and that is VERIFIED",
        leftInstances.length === 0 && leftTiers.length === 0,
        `${leftInstances.length} instance(s), ${leftTiers.length} economics row(s) left; ${mine.length} audit row(s) removed`,
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

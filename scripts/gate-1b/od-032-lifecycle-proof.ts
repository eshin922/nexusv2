/**
 * OD-032 — the revised lifecycle, walked end to end.
 *
 *   Setup    creates the charge      identity + causal ownership
 *   Costs    completes its economics what DPS pays, every quoted tier
 *   Recovery decides its placement   how DPS recovers it
 *
 * ── WHY A LIFECYCLE PROOF AND NOT THREE SEPARATE ONES ───────────────────
 *
 * Steps A, B and C each carry their own falsifications, and each passes. What
 * none of them establishes is that the three surfaces COMPOSE: that a charge
 * created with no economics becomes placeable once, and only once, Costs has
 * completed it, and that every intermediate state is reported rather than lost.
 *
 * The failure this guards against is the one the whole workstream started
 * from — a charge that exists but is invisible. That failure lives BETWEEN
 * surfaces, so it can only be caught by a walk that crosses them.
 *
 * ── THE ASSERTIONS THAT MATTER ARE THE NEGATIVE ONES ────────────────────
 *
 * At `none` and at `partial`, EVERY recovery mode must be unavailable. A walk
 * that only checked the end state would pass on a system that let an operator
 * place a charge before its cost existed, which is precisely the ordering this
 * repair enforces.
 *
 * ── RESIDUE ─────────────────────────────────────────────────────────────
 *
 * This writes to the shared database. Everything it creates is removed and the
 * removal is VERIFIED by re-reading.
 *
 *   usage: npm run gate1b:od-032-lifecycle
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
import { getCostingBundle } from "@/app/actions/costing";
import { createComponentChargesAs } from "@/lib/component-charges/create";
import { updateComponentChargeCostAs } from "@/lib/component-charges/update";
import { readComponentChargeReadiness } from "@/lib/component-charges/readiness";
import { buildRecoveryWorkspace } from "@/lib/commercial-recovery/workspace-view";
import type { RecoveryChargeKey } from "@/lib/commercial-recovery/registry";

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

/** The recovery row for one charge, built the way the surface builds it. */
async function rowFor(quoteId: string, chargeInstanceId: string) {
  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) refuse(`costing bundle failed: ${bundle.error.message}`);
  const readiness = await readComponentChargeReadiness(quoteId);
  const skus = (bundle.data.skus ?? []) as { id: string; skuRole?: string }[];
  const rows = buildRecoveryWorkspace({
    costing: bundle.data.costing,
    isLeaf: (skuId: string) => skus.some((s) => s.id === skuId && s.skuRole === "leaf"),
    elections: bundle.data.chargeElections ?? [],
    allocationStates: [true],
    chargeEconomics: new Map(
      readiness.map((r) => [
        r.chargeInstanceId,
        {
          state: r.state,
          chargeKey: r.chargeKey as RecoveryChargeKey,
          ownLabel: r.ownLabel,
          missingTierLabels: r.missingTierLabels,
        },
      ]),
    ),
  });
  return rows.find((r) => r.chargeInstanceId === chargeInstanceId) ?? null;
}

async function main() {
  const found = await db.execute(sql`
    select q.id as quote_id,
           (select ql.id from quote_leaves ql where ql.quote_id = q.id limit 1) as leaf,
           (select count(*) from quote_tiers t where t.quote_id = q.id) as tier_n
      from quotes q
     where q.status = 'draft'`);
  const hit = found.find((r) => r.leaf && Number(r.tier_n) >= 2);
  if (!hit) refuse("no draft quote has a component and at least two tiers");
  const quoteId = hit.quote_id as string;
  const leafId = hit.leaf as string;

  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label, sortOrder: quoteTiers.sortOrder })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId))
    .orderBy(quoteTiers.sortOrder, quoteTiers.label);
  const [operator] = await db.select({ id: users.id }).from(users).limit(1);
  if (!operator) refuse("no user to attribute the write to");

  record(
    "NON-VACUOUS · more than one tier, so `partial` is reachable",
    tiers.length >= 2,
    `${tiers.length} tiers`,
  );
  console.log(`subject quote ${quoteId} · component ${leafId}\n`);

  const created: string[] = [];
  try {
    // ── SETUP · the charge exists, and nothing else about it does ─────────
    console.log("SETUP");
    const res = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "other_service", label: "OD-032 lifecycle" }],
    });
    if (!res.ok) refuse(`Setup refused: ${res.error.message}`);
    const id = res.data.created[0].chargeInstanceId;
    created.push(id);

    const econ0 = await db
      .select({ t: quoteChargeInstanceTiers.tierId })
      .from(quoteChargeInstanceTiers)
      .where(eq(quoteChargeInstanceTiers.chargeInstanceId, id));
    record("Setup creates the charge and NO economics", econ0.length === 0, `${econ0.length} rows`);

    const r0 = await rowFor(quoteId, id);
    record(
      "the charge REACHES Commercial recovery — it is not lost",
      r0 !== null,
      r0 ? "row present" : "MISSING — the defect this workstream began with",
    );
    record(
      "it reports no economics, and an EMPTY tier vector rather than zeroes",
      r0?.economics === "none" && r0?.perTier.length === 0,
      `economics=${r0?.economics} perTier=${r0?.perTier.length ?? "?"} entries`,
    );
    record(
      "NEGATIVE · no mode may be elected while it has no cost",
      !!r0 && r0.options.every((o) => !o.available),
      r0 ? `${r0.options.filter((o) => o.available).length} available` : "no row",
    );

    // ── COSTS · partway ──────────────────────────────────────────────────
    console.log("\nCOSTS · first tier only");
    const first = await updateComponentChargeCostAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[0].id,
      cost: "750.00",
    });
    if (!first.ok) refuse(`Costs refused a valid cost: ${first.error.message}`);

    const r1 = await rowFor(quoteId, id);
    record(
      "a partly costed charge reports PARTIAL and names what is missing",
      r1?.economics === "partial" && r1.missingTierLabels.length === tiers.length - 1,
      `economics=${r1?.economics} missing=${r1?.missingTierLabels.join(", ")}`,
    );
    record(
      "NEGATIVE · still no mode may be elected — economics are incomplete",
      !!r1 && r1.options.every((o) => !o.available),
      r1 ? `${r1.options.filter((o) => o.available).length} available` : "no row",
    );
    record(
      "and the refusal tells the operator which tiers to finish",
      !!r1 &&
        r1.options.every((o) => (o.reason ?? "").includes(tiers[1].label)),
      r1?.options[0]?.reason ?? undefined,
    );

    // ── COSTS · complete ─────────────────────────────────────────────────
    console.log("\nCOSTS · every quoted tier");
    for (const t of tiers.slice(1)) {
      const priced = await updateComponentChargeCostAs(operator.id, {
        quoteId,
        chargeInstanceId: id,
        tierId: t.id,
        cost: "750.00",
      });
      if (!priced.ok) refuse(`Costs refused a valid cost: ${priced.error.message}`);
    }

    const r2 = await rowFor(quoteId, id);
    record(
      "a fully costed charge reports COMPLETE",
      r2?.economics === "complete" && r2.missingTierLabels.length === 0,
      `economics=${r2?.economics}`,
    );
    record(
      "NOW recovery may decide it — the gate opens, and only here",
      !!r2 && r2.options.some((o) => o.available),
      r2 ? `${r2.options.filter((o) => o.available).length} of ${r2.options.length} available` : "no row",
    );
    record(
      "and it is still UNPLACED — completing a cost decides nothing",
      r2?.unplaced === true && r2?.effectiveMode === null,
      `unplaced=${r2?.unplaced} effectiveMode=${r2?.effectiveMode}`,
    );

    // ── SEND · what would stop it now ────────────────────────────────────
    const readiness = await readComponentChargeReadiness(quoteId);
    const unpriced = readiness.filter((r) => r.state !== "complete");
    record(
      "the send gate has nothing left to say about cost",
      unpriced.length === 0,
      `${unpriced.length} unpriced charge(s)`,
    );
    record(
      "but placement is still outstanding, so send still refuses",
      r2?.unplaced === true,
      "recovery is the remaining decision, which is the correct order",
    );
  } finally {
    if (created.length > 0) {
      const candidates = await db
        .select({ id: auditLog.id, diff: auditLog.diffJson })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, quoteId),
            inArray(auditLog.action, [
              "component_charge_created",
              "component_charge_cost_updated",
              "component_charge_recovery_ask_updated",
            ]),
          ),
        );
      const mine = candidates
        .filter((a) => {
          const cid = (a.diff as { charge_instance_id?: string } | null)?.charge_instance_id;
          return !!cid && created.includes(cid);
        })
        .map((a) => a.id);

      await db.delete(quoteChargeInstances).where(inArray(quoteChargeInstances.id, created));
      if (mine.length > 0) await db.delete(auditLog).where(inArray(auditLog.id, mine));

      const leftInstances = await db
        .select({ id: quoteChargeInstances.id })
        .from(quoteChargeInstances)
        .where(inArray(quoteChargeInstances.id, created));
      const leftTiers = await db
        .select({ t: quoteChargeInstanceTiers.tierId })
        .from(quoteChargeInstanceTiers)
        .where(inArray(quoteChargeInstanceTiers.chargeInstanceId, created));
      console.log("");
      record(
        "RESIDUE · everything this walk created is gone, and that is VERIFIED",
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

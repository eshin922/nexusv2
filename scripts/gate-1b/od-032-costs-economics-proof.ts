/**
 * OD-032 step B — Costs owns what DPS pays, proven against the real writers.
 *
 * ── WHAT NEEDS A DATABASE AND WHAT DOES NOT ─────────────────────────────
 *
 * The boundary itself is structural and is asserted in
 * `tests/unit/od-032-costs-economics.test.ts` — the Costs writer cannot create
 * a charge, cannot elect a mode, and readiness never consults the engine.
 *
 * What CANNOT be established that way is the behaviour of rows: that clearing a
 * cost removes the row rather than storing a zero, that readiness sees the
 * resulting state as `partial` and names the tier, and that a refusal leaves
 * nothing behind. Those are facts about stored state, so they are proven by
 * performing them.
 *
 * ── RESIDUE ─────────────────────────────────────────────────────────────
 *
 * This writes to the shared database. Everything it creates is removed and the
 * removal is VERIFIED by re-reading, because a cleanup that is merely attempted
 * is one that can silently fail — which it already did once in this workstream.
 *
 *   usage: npm run gate1b:od-032-costs-economics
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
import {
  updateComponentChargeAskAs,
  updateComponentChargeCostAs,
} from "@/lib/component-charges/update";
import {
  describeMissing,
  readComponentChargeReadiness,
} from "@/lib/component-charges/readiness";

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

async function tierRowCount(chargeInstanceId: string): Promise<number> {
  const rows = await db
    .select({ t: quoteChargeInstanceTiers.tierId })
    .from(quoteChargeInstanceTiers)
    .where(eq(quoteChargeInstanceTiers.chargeInstanceId, chargeInstanceId));
  return rows.length;
}

async function main() {
  // A draft quote with a component and MORE THAN ONE tier. One tier cannot
  // express `partial` at all, and `partial` is the state this step exists to
  // make visible — so a single-tier subject would prove the easy half only.
  const rows = await db.execute(sql`
    select q.id as quote_id,
           (select ql.id from quote_leaves ql where ql.quote_id = q.id limit 1) as leaf,
           (select count(*) from quote_tiers t where t.quote_id = q.id) as tier_n
      from quotes q
     where q.status = 'draft'`);
  const hit = rows.find((r) => r.leaf && Number(r.tier_n) >= 2);
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
    "NON-VACUOUS · the subject has more than one tier",
    tiers.length >= 2,
    `${tiers.length} tiers: ${tiers.map((t) => t.label).join(", ")}`,
  );
  console.log(`subject quote ${quoteId} · component ${leafId}`);

  const created: string[] = [];
  try {
    const res = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "other_service", label: "OD-032 B proof" }],
    });
    if (!res.ok) refuse(`could not author the subject charge: ${res.error.message}`);
    const id = res.data.created[0].chargeInstanceId;
    created.push(id);

    // Setup creates the charge; COSTS prices it. Two calls because that is the
    // real path — pricing at authoring time would exercise a route no operator
    // has, and would keep passing across a change that had broken theirs.
    for (const t of tiers) {
      const priced = await updateComponentChargeCostAs(operator.id, {
        quoteId,
        chargeInstanceId: id,
        tierId: t.id,
        cost: "500.00",
      });
      if (!priced.ok) refuse(`could not price the subject: ${priced.error.message}`);
    }

    const readOne = async () =>
      (await readComponentChargeReadiness(quoteId)).find((r) => r.chargeInstanceId === id);

    record(
      "a fully priced charge reads COMPLETE",
      (await readOne())?.state === "complete",
      `state=${(await readOne())?.state}`,
    );

    // ── CLEARING A COST REMOVES THE ROW ───────────────────────────────────
    const before = await tierRowCount(id);
    const cleared = await updateComponentChargeCostAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[1].id,
      cost: null,
    });
    const after = await tierRowCount(id);
    record(
      "clearing a cost DELETES the row — absence represented by absence",
      cleared.ok && after === before - 1,
      `tier rows ${before} → ${after}`,
    );

    // ── AND READINESS SEES IT, NAMING THE TIER ────────────────────────────
    const partial = await readOne();
    record(
      "readiness reads the result as PARTIAL and names the tier",
      partial?.state === "partial" &&
        partial.missingTierLabels.length === 1 &&
        partial.missingTierLabels[0] === tiers[1].label,
      `state=${partial?.state} missing=${partial?.missingTierLabels.join(", ")}`,
    );
    record(
      "the refusal an operator would see names the charge and the tier",
      !!partial &&
        describeMissing(partial).includes("OD-032 B proof") &&
        describeMissing(partial).includes(tiers[1].label),
      partial ? describeMissing(partial) : "no readiness row",
    );

    // ── NO ROW MEANS NO ZERO ──────────────────────────────────────────────
    const zeroRows = await db
      .select({ c: quoteChargeInstanceTiers.costAmount })
      .from(quoteChargeInstanceTiers)
      .where(
        and(
          eq(quoteChargeInstanceTiers.chargeInstanceId, id),
          eq(quoteChargeInstanceTiers.tierId, tiers[1].id),
        ),
      );
    record(
      "the cleared tier stores NOTHING, not a zero",
      zeroRows.length === 0,
      `${zeroRows.length} row(s) with cost ${zeroRows[0]?.c ?? "—"}`,
    );

    // ── AN EXPLICIT 0.00 IS REFUSED, AND NOTHING PERSISTS ─────────────────
    const rowsBeforeZero = await tierRowCount(id);
    const zero = await updateComponentChargeCostAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[1].id,
      cost: "0.00",
    });
    record(
      "an explicit 0.00 is refused",
      !zero.ok && /not a cost/.test(zero.ok ? "" : zero.error.message),
      zero.ok ? "ACCEPTED — Option A is not being enforced" : zero.error.message,
    );
    record(
      "and the refusal persists nothing",
      (await tierRowCount(id)) === rowsBeforeZero,
      `tier rows ${rowsBeforeZero} → ${await tierRowCount(id)}`,
    );

    // ── COST BEFORE ASK ───────────────────────────────────────────────────
    const askFirst = await updateComponentChargeAskAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[1].id,
      ask: "600.00",
    });
    record(
      "an ask on an unpriced tier is refused — cost first",
      !askFirst.ok,
      askFirst.ok ? "ACCEPTED — an economics row with no cost was minted" : askFirst.error.message,
    );

    // ── THE ASK IS STORED, UNCHANGED, WHERE THERE IS A COST ───────────────
    const ask = await updateComponentChargeAskAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[0].id,
      ask: "650.00",
    });
    const [stored] = await db
      .select({
        cost: quoteChargeInstanceTiers.costAmount,
        ask: quoteChargeInstanceTiers.recoveryAsk,
      })
      .from(quoteChargeInstanceTiers)
      .where(
        and(
          eq(quoteChargeInstanceTiers.chargeInstanceId, id),
          eq(quoteChargeInstanceTiers.tierId, tiers[0].id),
        ),
      );
    record(
      "the recovery ask stores as entered, and the cost is untouched",
      ask.ok && stored?.ask === "650.00" && stored?.cost === "500.00",
      `cost=${stored?.cost} ask=${stored?.ask}`,
    );

    // ── CLEARING THE COST TAKES THE ASK WITH IT ───────────────────────────
    await updateComponentChargeCostAs(operator.id, {
      quoteId,
      chargeInstanceId: id,
      tierId: tiers[0].id,
      cost: null,
    });
    const afterClear = await db
      .select({ t: quoteChargeInstanceTiers.tierId })
      .from(quoteChargeInstanceTiers)
      .where(
        and(
          eq(quoteChargeInstanceTiers.chargeInstanceId, id),
          eq(quoteChargeInstanceTiers.tierId, tiers[0].id),
        ),
      );
    const auditRows = await db
      .select({ diff: auditLog.diffJson })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, quoteId),
          eq(auditLog.action, "component_charge_cost_updated"),
        ),
      );
    const saidSo = auditRows.some((a) => {
      const d = a.diff as { charge_instance_id?: string; recovery_ask_cleared_with_cost?: string } | null;
      return d?.charge_instance_id === id && d?.recovery_ask_cleared_with_cost === "650.00";
    });
    record(
      "clearing the cost clears its ask, and the audit SAYS so",
      afterClear.length === 0 && saidSo,
      `${afterClear.length} row(s) left; audit recorded the cleared ask: ${saidSo}`,
    );

    // ── NO ECONOMICS AT ALL ───────────────────────────────────────────────
    for (const t of tiers.slice(2)) {
      await updateComponentChargeCostAs(operator.id, {
        quoteId,
        chargeInstanceId: id,
        tierId: t.id,
        cost: null,
      });
    }
    const none = await readOne();
    record(
      "a charge with no economics is still REPORTED, as `none`",
      none?.state === "none" && (await tierRowCount(id)) === 0,
      `state=${none?.state}, ${await tierRowCount(id)} tier row(s)`,
    );
    record(
      "and its refusal says there is no cost at any tier",
      !!none && describeMissing(none).includes("no cost at any tier"),
      none ? describeMissing(none) : "no readiness row",
    );
  } finally {
    // ── CLEANUP, THEN VERIFY IT ──────────────────────────────────────────
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

      await db
        .delete(quoteChargeInstances)
        .where(inArray(quoteChargeInstances.id, created));
      if (mine.length > 0) await db.delete(auditLog).where(inArray(auditLog.id, mine));

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

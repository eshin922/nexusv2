/**
 * A charge elected for recovery and never priced cannot be sent.
 *
 * ── THE STATE THIS EXISTS FOR ───────────────────────────────────────────
 *
 * Measured on Production 2026-08-28, through the operator UI: two charges on
 * one component, cost entered at all four tiers, both elected `separate`, no
 * recovery ask anywhere.
 *
 *   Recovery workspace : "not priced"          — correct
 *   customer document  : "One-time fees $0.00" — INCORRECT
 *   Finalize           : data-state="ready"    — INCORRECT
 *   sendQuote          : no refusal            — INCORRECT
 *
 * $2,700 elected to bill separately, stated to a customer as zero. The write
 * that would have priced it existed, was wrapped in a server action, and was
 * imported by the Costs drilldown — and never called, so no operator could
 * reach it.
 *
 * ── WHY IT WRITES ───────────────────────────────────────────────────────
 *
 * Whether a quote is sendable is a property of the database, the diagnostic and
 * the gate together. Reading any one of them proves nothing about the other
 * two, and the defect lived precisely in the gap between them.
 *
 * Everything it creates is deleted, and the deletion is verified
 * POPULATION-WIDE by re-reading — not scoped to what this run meant to create,
 * which is how a sibling proof caught a row an unexpectedly-successful call had
 * left behind.
 *
 * ── AND WHY IT USES THE LIBRARY WRITERS ─────────────────────────────────
 *
 * `*As` writers take a user id; the actions call `ensureUser`, which a script
 * has no session for. That is correct for a gate AND is exactly what hid the
 * defect: proving the write works says nothing about whether an operator can
 * perform it. `tests/unit/operator-action-reachability.test.ts` is the half
 * this cannot cover, and neither stands alone.
 *
 *   usage: npm run gate1b:od-032-recovery-ask
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { quoteChargeInstances, quoteChargeRecovery } from "@/db/schema";
import {
  createComponentChargesAs,
  deleteComponentChargeAs,
} from "@/lib/component-charges/create";
import {
  updateComponentChargeAskAs,
  updateComponentChargeCostAs,
} from "@/lib/component-charges/update";
import { readChargeRecoveryPricingGaps } from "@/lib/component-charges/recovery-pricing";
import { readComponentChargeReadiness } from "@/lib/component-charges/readiness";

const rows = <T,>(r: unknown) => r as unknown as T[];
let pass = 0;
let fail = 0;
function check(ok: boolean, name: string, detail: string) {
  if (ok) { pass++; console.log(`  PASS  ${name} — ${detail}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${detail}`); }
}
function refuse(why: string): never {
  console.log(`REFUSE — ${why}`);
  process.exit(1);
}

// ── subject ─────────────────────────────────────────────────────────────
const [op] = rows<{ id: string }>(
  await db.execute(sql`select id::text from users where email = 'edward@thedps.co'`),
);
if (!op) refuse("no operator to attribute writes to");

const [subject] = rows<{ quote_id: string; leaf: string; n: string }>(
  await db.execute(sql`
    select q.id::text quote_id,
           (select ql.id::text from quote_leaves ql where ql.quote_id = q.id order by ql.position limit 1) leaf,
           (select count(*)::text from quote_tiers t where t.quote_id = q.id) n
      from quotes q
     where q.status = 'draft'
       and (select count(*) from quote_tiers t where t.quote_id = q.id) >= 4
       and (select count(*) from quote_leaves ql where ql.quote_id = q.id) > 0
     order by q.id limit 1`),
);
if (!subject?.leaf) refuse("no draft quote has a component and at least four tiers");

const pre = await db
  .select({ id: quoteChargeInstances.id })
  .from(quoteChargeInstances)
  .where(and(eq(quoteChargeInstances.quoteId, subject.quote_id), isNotNull(quoteChargeInstances.ownerQuoteLeafId)));
if (pre.length !== 0) refuse(`subject already carries ${pre.length} component charge(s)`);

const tiers = rows<{ id: string; label: string }>(
  await db.execute(sql`select id::text, label from quote_tiers where quote_id=${subject.quote_id}::uuid order by sort_order`),
);
console.log(`subject ${subject.quote_id} · component ${subject.leaf.slice(0, 8)} · ${tiers.length} tiers\n`);

// ── the hard fixture: one component, TWO same-type instances ────────────
const made: { id: string; label: string | null }[] = [];
try {
  for (const label of [null, "Back panel"]) {
    const res = await createComponentChargesAs(op.id, {
      quoteId: subject.quote_id,
      quoteLeafId: subject.leaf,
      charges: [{ chargeKey: "print_plates", label }],
    });
    if (!res.ok) refuse(`create refused: ${JSON.stringify(res.error)}`);
    const id = res.data.created[0].chargeInstanceId;
    made.push({ id, label });
    for (const t of tiers) {
      const c = await updateComponentChargeCostAs(op.id, {
        quoteId: subject.quote_id, chargeInstanceId: id, tierId: t.id,
        cost: label === null ? "1900" : "800",
      });
      if (!c.ok) refuse(`cost refused: ${JSON.stringify(c.error)}`);
    }
  }
  check(made.length === 2, "TWO same-type instances on one component",
    `${made.map((m) => m.id.slice(0, 8)).join(", ")} — a type-keyed model could not hold both`);

  const elect = async (id: string, mode: string) =>
    db.insert(quoteChargeRecovery)
      .values({ quoteId: subject.quote_id, chargeKey: "print_plates", chargeInstanceId: id, mode: mode as never })
      .onConflictDoUpdate({ target: quoteChargeRecovery.chargeInstanceId, set: { mode: mode as never } });

  const gapsFor = async () => readChargeRecoveryPricingGaps(subject.quote_id);
  const idsOf = (g: Awaited<ReturnType<typeof gapsFor>>) => g.map((x) => x.chargeInstanceId).sort();

  // 1 · costs complete, no ask, both SEPARATE -> refused, naming every tier
  await elect(made[0].id, "separate");
  await elect(made[1].id, "separate");
  const cost = await readComponentChargeReadiness(subject.quote_id);
  check(cost.every((r) => r.state === "complete"), "COST is complete",
    "so nothing else can be blaming the cost gate for this refusal");

  let g = await gapsFor();
  check(g.length === 2 && idsOf(g).join() === made.map((m) => m.id).sort().join(),
    "SEPARATE + no ask · both charges refused", `${g.length} gap(s)`);
  check(g.every((x) => x.missingTierLabels.length === tiers.length),
    "the refusal names ALL missing tiers",
    g.map((x) => `${x.ownLabel ?? "—"}:[${x.missingTierLabels.join("|")}]`).join(" "));

  // 2 · INCLUDED with no ask is refused identically
  await elect(made[0].id, "included");
  await elect(made[1].id, "included");
  g = await gapsFor();
  check(g.length === 2 && g.every((x) => x.mode === "included"),
    "INCLUDED + no ask · refused the same way",
    "included puts the amount inside the unit price; it cannot be built from an unknown");

  // 3 · ABSORBED does not falsely require an ask
  await elect(made[0].id, "absorbed");
  await elect(made[1].id, "absorbed");
  g = await gapsFor();
  check(g.length === 0, "ABSORBED · no ask required",
    "recovering nothing is the decision, not a missing fact");

  // 4 · PARTIAL asks name only what remains
  await elect(made[0].id, "separate");
  await elect(made[1].id, "separate");
  for (const t of tiers.slice(0, 2)) {
    const a = await updateComponentChargeAskAs(op.id, {
      quoteId: subject.quote_id, chargeInstanceId: made[0].id, tierId: t.id, ask: "2400",
    });
    if (!a.ok) refuse(`ask refused: ${JSON.stringify(a.error)}`);
  }
  g = await gapsFor();
  const partial = g.find((x) => x.chargeInstanceId === made[0].id);
  check(
    !!partial && partial.missingTierLabels.length === tiers.length - 2 &&
      !partial.missingTierLabels.includes(tiers[0].label),
    "PARTIAL asks · only the REMAINING tiers are named",
    `still missing: ${partial?.missingTierLabels.join(", ")}`,
  );

  // 5 · A's ask cannot mutate B
  const bAsks = rows<{ n: string }>(await db.execute(sql`
    select count(recovery_ask)::text n from quote_charge_instance_tiers where charge_instance_id = ${made[1].id}::uuid`));
  check(bAsks[0].n === "0", "A's ask left B untouched",
    "B still has 0 asks — nothing was written positionally");

  // 6 · each ask persists against its OWN (instance, tier)
  const placed = rows<{ tier: string; ask: string }>(await db.execute(sql`
    select t.label tier, ct.recovery_ask::text ask
      from quote_charge_instance_tiers ct join quote_tiers t on t.id = ct.tier_id
     where ct.charge_instance_id = ${made[0].id}::uuid and ct.recovery_ask is not null
     order by t.sort_order`));
  check(
    placed.length === 2 && placed.every((p) => Number(p.ask) === 2400) &&
      placed[0].tier === tiers[0].label && placed[1].tier === tiers[1].label,
    "each ask persisted against its own (instance, tier)",
    placed.map((p) => `${p.tier}=${p.ask}`).join(" "),
  );

  // 7 · completing the asks clears the gate
  for (const t of tiers.slice(2)) {
    await updateComponentChargeAskAs(op.id, {
      quoteId: subject.quote_id, chargeInstanceId: made[0].id, tierId: t.id, ask: "2400",
    });
  }
  for (const t of tiers) {
    await updateComponentChargeAskAs(op.id, {
      quoteId: subject.quote_id, chargeInstanceId: made[1].id, tierId: t.id, ask: "1000",
    });
  }
  g = await gapsFor();
  check(g.length === 0, "asks complete · the gate CLEARS",
    "the refusal is resolvable by the operator path, not permanent");

  // 8 · the governed ask is what the engine carries — never zero
  const asked = rows<{ n: string; min: string; max: string }>(await db.execute(sql`
    select count(*)::text n, min(recovery_ask)::text min, max(recovery_ask)::text max
      from quote_charge_instance_tiers ct join quote_charge_instances i on i.id = ct.charge_instance_id
     where i.owner_quote_leaf_id is not null and ct.recovery_ask is not null`));
  check(asked[0].n === String(tiers.length * 2) && Number(asked[0].min) === 1000 && Number(asked[0].max) === 2400,
    "the GOVERNED ask is stored, never a zero stand-in",
    `${asked[0].n} priced cells, ${asked[0].min}..${asked[0].max}`);

  // 9 · clearing one ask re-opens the gate for exactly that tier
  await updateComponentChargeAskAs(op.id, {
    quoteId: subject.quote_id, chargeInstanceId: made[1].id, tierId: tiers[3].id, ask: null,
  });
  g = await gapsFor();
  check(
    g.length === 1 && g[0].chargeInstanceId === made[1].id &&
      g[0].missingTierLabels.length === 1 && g[0].missingTierLabels[0] === tiers[3].label,
    "clearing ONE ask re-opens the gate for exactly that tier",
    `${g[0]?.missingTierLabels.join(", ")}`,
  );
} finally {
  for (const m of made) {
    await deleteComponentChargeAs(op.id, { quoteId: subject.quote_id, chargeInstanceId: m.id });
  }
}

// ── residue, population-wide, verified by RE-READING ────────────────────
const after = rows<{ inst: string; tiers: string; elect: string }>(
  await db.execute(sql`
    select (select count(*)::text from quote_charge_instances where owner_quote_leaf_id is not null) inst,
           (select count(*)::text from quote_charge_instance_tiers t join quote_charge_instances i on i.id = t.charge_instance_id where i.owner_quote_leaf_id is not null) tiers,
           (select count(*)::text from quote_charge_recovery r join quote_charge_instances i on i.id = r.charge_instance_id where i.owner_quote_leaf_id is not null) elect`),
);
check(after[0].inst === "0" && after[0].tiers === "0" && after[0].elect === "0",
  "RESIDUE · population-wide, verified by re-reading",
  `instances=${after[0].inst} tierRows=${after[0].tiers} elections=${after[0].elect}`);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);

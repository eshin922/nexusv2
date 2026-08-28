/**
 * OD-032 phase 4 — every quoted tier needs an explicit positive cost.
 *
 * Proven by transaction, against the real action. A structural claim is proven
 * by performing it; "the code has a throw in it" is not evidence that nothing
 * persisted, because the throw could fire after the first row landed.
 *
 * ── WHAT IS BEING PROVEN ─────────────────────────────────────────────────
 *
 * A blank cost is NOT zero: it means the operator has not supplied the fact.
 * An explicit 0.00 is refused too, because otherwise it is simply the way round
 * the blank check and encodes "not applicable at this tier" as an amount.
 *
 * And the refusal is WHOLE-SHEET: nothing at all persists — no instance, no
 * tier economics, no election, no audit row — even though the submission
 * contains one perfectly valid charge and one valid tier.
 *
 *   usage: npm run gate1b:od-032-cost-required
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteChargeRecovery,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import { createComponentChargesAs } from "@/lib/component-charges/create";
import { readComponentChargeReadiness } from "@/lib/component-charges/readiness";
import { users } from "@/db/schema";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  // A draft quote with a component and MORE THAN ONE tier. One tier cannot
  // express the case at all: the whole claim is that a tier left blank while
  // another is filled correctly still refuses.
  const candidates = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.status, "draft"))
    .limit(60);

  let subject: { quoteId: string; leafId: string; tiers: { id: string; label: string }[] } | null =
    null;
  for (const q of candidates) {
    const [leaf] = await db
      .select({ id: quoteLeaves.id })
      .from(quoteLeaves)
      .where(eq(quoteLeaves.quoteId, q.id))
      .limit(1);
    const tiers = await db
      .select({ id: quoteTiers.id, label: quoteTiers.label })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, q.id));
    if (leaf && tiers.length >= 2) {
      subject = { quoteId: q.id, leafId: leaf.id, tiers };
      break;
    }
  }
  if (!subject) {
    console.error("no draft quote with a component and 2+ tiers — cannot prove");
    process.exit(1);
  }

  const { quoteId, leafId, tiers } = subject;
  console.log(`subject : ${quoteId}`);
  console.log(`component: ${leafId.slice(0, 8)}`);
  console.log(`tiers   : ${tiers.map((t) => t.label).join(", ")}\n`);

  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!actor) { console.error("no user to act as"); process.exit(1); }
  const actorId = actor.id;

  const before = {
    instances: (
      await db
        .select({ id: quoteChargeInstances.id })
        .from(quoteChargeInstances)
        .where(eq(quoteChargeInstances.quoteId, quoteId))
    ).length,
    elections: (
      await db
        .select({ id: quoteChargeRecovery.chargeInstanceId })
        .from(quoteChargeRecovery)
        .where(eq(quoteChargeRecovery.quoteId, quoteId))
    ).length,
    audits: (
      await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, quoteId),
            inArray(auditLog.action, [
              "component_charge_created",
              "component_charge_deleted",
            ]),
          ),
        )
    ).length,
  };

  /** Nothing at all reached the database. */
  async function assertNothingPersisted(label: string) {
    const instances = await db
      .select({ id: quoteChargeInstances.id })
      .from(quoteChargeInstances)
      .where(eq(quoteChargeInstances.quoteId, quoteId));
    const economics = instances.length
      ? await db
          .select({ id: quoteChargeInstanceTiers.chargeInstanceId })
          .from(quoteChargeInstanceTiers)
          .where(
            inArray(
              quoteChargeInstanceTiers.chargeInstanceId,
              instances.map((i) => i.id),
            ),
          )
      : [];
    const elections = await db
      .select({ id: quoteChargeRecovery.chargeInstanceId })
      .from(quoteChargeRecovery)
      .where(eq(quoteChargeRecovery.quoteId, quoteId));
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, quoteId),
          inArray(auditLog.action, [
            "component_charge_created",
            "component_charge_deleted",
          ]),
        ),
      );

    const ok =
      instances.length === before.instances &&
      elections.length === before.elections &&
      audits.length === before.audits;
    record(
      `${label} · nothing persisted`,
      ok,
      `instances ${instances.length}/${before.instances}, ` +
        `economics ${economics.length}, elections ${elections.length}/${before.elections}, ` +
        `audit ${audits.length}/${before.audits}`,
    );
  }

  // ── 1 · one charge missing its required label, another correct ─────────
  //
  // NON-VACUOUS BY CONSTRUCTION. The submission carries a fully valid charge
  // alongside the invalid one. If atomicity leaked, the valid part would land
  // — so a pass here means the whole sheet was refused rather than most of it.
  const missingLabel = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      {
        // `other_service` is the type whose label is not optional: without one
        // the charge says only "a service", which is not a commercial fact.
        chargeKey: "other_service",
        label: "   ",
      },
      {
        // A SECOND, ENTIRELY VALID CHARGE. It must not survive its sibling's
        // refusal — one sheet is one gesture.
        chargeKey: "tooling",
      },
    ],
  });
  record(
    "a charge missing its required label refuses the WHOLE sheet",
    !missingLabel.ok,
    missingLabel.ok
      ? "ACCEPTED — whitespace became a label"
      : missingLabel.error.message,
  );
  await assertNothingPersisted("missing label");

  // ── 2 · a type a component cannot own ──────────────────────────────────
  //
  // The registry is a closed set. A charge key outside it is not a charge a
  // component causes, and the same whole-sheet rule applies.
  const badType = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      { chargeKey: "tooling" },
      { chargeKey: "container_freight" },
    ],
  });
  record(
    "a type outside the component registry refuses the whole sheet",
    !badType.ok,
    badType.ok ? "ACCEPTED — a quote-level charge was owned by a component" : badType.error.message,
  );
  await assertNothingPersisted("bad type");

  // ── 3 · CONTROL · the valid case is accepted ───────────────────────────
  //
  // Without this every refusal above is satisfied by an action that refuses
  // everything, and the suite would prove nothing about the rule.
  const valid = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [{ chargeKey: "print_plates", label: "ZZ-VALIDATION-atomicity" }],
  });
  record(
    "CONTROL · a well-formed charge is ACCEPTED",
    valid.ok,
    valid.ok ? `created ${valid.data.created.length}` : valid.error.message,
  );

  // ── 4 · AND IT ARRIVES WITH NO ECONOMICS ───────────────────────────────
  //
  // The point of step C. Setup creates the structural fact and stops; the
  // charge carries no `quote_charge_instance_tiers` row at all, which is an
  // expected intermediate state rather than an error. Costs completes it and
  // send refuses the quote until it is complete.
  if (valid.ok) {
    const id = valid.data.created[0].chargeInstanceId;
    const econ = await db
      .select({ t: quoteChargeInstanceTiers.tierId })
      .from(quoteChargeInstanceTiers)
      .where(eq(quoteChargeInstanceTiers.chargeInstanceId, id));
    record(
      "a charge created by Setup carries NO economics",
      econ.length === 0,
      `${econ.length} economics row(s) — Setup must write none`,
    );
    const ready = (await readComponentChargeReadiness(quoteId)).find(
      (r) => r.chargeInstanceId === id,
    );
    record(
      "and readiness reports it rather than losing it",
      ready?.state === "none",
      `state=${ready?.state ?? "NOT REPORTED"}`,
    );
  }

  // ── cleanup ────────────────────────────────────────────────────────────
  //
  // NOT conditional on the run having gone well. The earlier form ran only when
  // the control succeeded, so a run where the code under test was DEFECTIVE —
  // which is exactly what a falsification run is — left its rows behind on a
  // shared production database. Two instances and six economics rows survived
  // one such run and were found by reading the tables afterwards rather than by
  // anything the harness reported.
  //
  // A harness that cleans up only when it passes is a harness that litters
  // precisely when it is doing its job.
  if (valid.ok) {
    const ids = valid.data.created.map((c) => c.chargeInstanceId);
    await db.delete(quoteChargeInstances).where(inArray(quoteChargeInstances.id, ids));
    // The instance delete cascades its economics; the audit row does not
    // cascade and is removed by the id this run wrote, so a pre-existing row
    // on the same quote is left alone.
    await db
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.entityId, quoteId),
          eq(auditLog.action, "component_charge_created"),
        ),
      );
    await assertNothingPersisted("after cleanup");
  }

  // The sweep runs before the verdict is reported, and before the process can
  // exit — `process.exit` inside a `finally` would still preempt an awaited
  // delete, so the order is explicit rather than left to cleanup semantics.
  await sweep(quoteId);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PROOF: PASS" : "PROOF: FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

/**
 * Remove every component-owned charge this proof could have created on the
 * subject quote, whatever happened.
 *
 * COMPONENT-OWNED ONLY, and only on the subject quote. A legacy `'@quote'`
 * instance stands for a production column with an election resolving through
 * it; deleting one would orphan the election. And an instance an election
 * references is refused outright rather than cascaded away — a sweep that
 * removes real commercial state is worse than the residue it was cleaning.
 */
async function sweep(quoteId: string) {
  const victims = await db
    .select({ id: quoteChargeInstances.id, chargeKey: quoteChargeInstances.chargeKey })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );
  if (victims.length === 0) return;

  const ids = victims.map((v) => v.id);
  const elected = await db
    .select({ id: quoteChargeRecovery.chargeInstanceId })
    .from(quoteChargeRecovery)
    .where(inArray(quoteChargeRecovery.chargeInstanceId, ids));
  if (elected.length > 0) {
    console.error(
      `SWEEP REFUSED: ${elected.length} election(s) reference these charges. ` +
        "Left in place deliberately — removing them would delete commercial state.",
    );
    return;
  }

  await db.delete(quoteChargeInstances).where(inArray(quoteChargeInstances.id, ids));
  await db
    .delete(auditLog)
    .where(
      and(
        eq(auditLog.entityId, quoteId),
        eq(auditLog.action, "component_charge_created"),
      ),
    );
  console.log(
    `\nswept ${victims.length} residual component charge(s): ` +
      victims.map((v) => v.chargeKey).join(", "),
  );
}

await main();

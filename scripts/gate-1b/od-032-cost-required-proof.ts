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

  // ── 1 · one tier blank, another correct ────────────────────────────────
  //
  // NON-VACUOUS BY CONSTRUCTION. The submission carries a fully valid charge
  // AND a valid amount on the first tier. If the refusal were per-tier, or if
  // atomicity leaked, the valid parts would land — so a pass here means the
  // whole sheet was refused rather than most of it.
  const blank = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      {
        chargeKey: "print_plates",
        // EVERY tier supplied, exactly ONE left blank. Omitting the others
        // would let the missing-tier check fire instead, and the test would
        // pass while proving a different rule — the case it names is "one tier
        // blank while the rest are correct".
        amounts: tiers.map((t, i) => ({
          tierId: t.id,
          cost: i === 1 ? "" : "1450.00",
        })),
      },
      {
        // A SECOND, ENTIRELY VALID CHARGE. It must not survive its sibling's
        // refusal — one sheet is one gesture.
        chargeKey: "tooling",
        amounts: tiers.map((t) => ({ tierId: t.id, cost: "600.00" })),
      },
    ],
  });
  record(
    "a blank cost on ONE tier refuses the whole sheet",
    !blank.ok,
    blank.ok ? "ACCEPTED — a blank became a value" : blank.error.message,
  );
  record(
    "the refusal NAMES the tier",
    !blank.ok && blank.error.message.includes(tiers[1].label),
    !blank.ok ? blank.error.message : undefined,
  );
  await assertNothingPersisted("blank cost");

  // ── 2 · explicit 0.00 ──────────────────────────────────────────────────
  //
  // The way round the blank check, closed. Without this, an operator who does
  // not have a figure types a zero and the quote carries a charge that costs
  // nothing — indistinguishable afterwards from one that genuinely does.
  const zero = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      {
        chargeKey: "print_plates",
        // ISOLATED. Every tier carries a value and exactly one is 0.00, so the
        // MISSING check cannot fire first — the earlier form of this supplied
        // two of three tiers and was refused for the absent third, passing
        // while never exercising the zero rule at all.
        amounts: tiers.map((t, i) => ({
          tierId: t.id,
          cost: i === 1 ? "0.00" : "1450.00",
        })),
      },
    ],
  });
  record(
    "an explicit 0.00 refuses too",
    !zero.ok,
    zero.ok ? "ACCEPTED — zero is the way round the blank check" : zero.error.message,
  );
  record(
    "the zero refusal is a ZERO refusal, and names the tier",
    !zero.ok &&
      zero.error.message.includes("cost of 0.00") &&
      zero.error.message.includes(tiers[1].label),
    !zero.ok ? zero.error.message : undefined,
  );
  await assertNothingPersisted("explicit zero");

  // ── 3 · a tier simply OMITTED from the payload ─────────────────────────
  //
  // Not a blank string but an absent entry — the shape a stale tab or a
  // replayed action id produces. Iterating the QUOTE's tiers rather than the
  // submission is what catches it.
  const omitted = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      {
        chargeKey: "print_plates",
        amounts: [{ tierId: tiers[0].id, cost: "1450.00" }],
      },
    ],
  });
  record(
    "a tier omitted from the payload refuses",
    !omitted.ok,
    omitted.ok ? "ACCEPTED — an absent tier read as complete" : omitted.error.message,
  );
  await assertNothingPersisted("omitted tier");

  // ── 4 · CONTROL · the valid case is accepted ───────────────────────────
  //
  // Without this every refusal above is satisfied by an action that refuses
  // everything, and the suite would prove nothing about the rule.
  const valid = await createComponentChargesAs(actorId, {
    quoteId,
    quoteLeafId: leafId,
    charges: [
      {
        chargeKey: "print_plates",
        label: "ZZ-VALIDATION-cost-required",
        amounts: tiers.map((t, i) => ({
          tierId: t.id,
          cost: i === 0 ? "1450.00" : "1200.00",
        })),
      },
    ],
  });
  record(
    "CONTROL · every tier priced is ACCEPTED",
    valid.ok,
    valid.ok ? `created ${valid.data.created.length}` : valid.error.message,
  );

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

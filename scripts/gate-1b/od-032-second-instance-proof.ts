/**
 * OD-032 — two charges of one type on one component, proven against the writer.
 *
 * ── WHY A RUNTIME PROOF ─────────────────────────────────────────────────
 *
 * The source assertions establish that the prop is wired and the collision is
 * refused. Neither can establish that the writer actually MINTS A SECOND
 * IDENTITY when the labels differ — that is a fact about rows, and it is the
 * capability the whole instance grain exists to give back.
 *
 * The old behaviour is the sharp control: a second charge with no label
 * reported SUCCESS and created nothing, because `ensureChargeInstance` resolved
 * it to the first. So this proves both directions — the collision is refused,
 * and the distinguishable pair really are two rows.
 *
 * ── RESIDUE ─────────────────────────────────────────────────────────────
 *
 * This writes to the shared database. Everything it creates is removed and the
 * removal is VERIFIED by re-reading.
 *
 *   usage: npm run gate1b:od-032-second-instance
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, quoteChargeInstances, users } from "@/db/schema";
import { createComponentChargesAs } from "@/lib/component-charges/create";
import { readExistingComponentCharges } from "@/lib/component-charges/read";

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
  const found = await db.execute(sql`
    select q.id as quote_id,
           (select ql.id from quote_leaves ql where ql.quote_id = q.id limit 1) as leaf
      from quotes q where q.status = 'draft'`);
  const hit = found.find((r) => r.leaf);
  if (!hit) refuse("no draft quote has a component");
  const quoteId = hit.quote_id as string;
  const leafId = hit.leaf as string;
  const [operator] = await db.select({ id: users.id }).from(users).limit(1);
  if (!operator) refuse("no user to attribute the write to");

  const existing = await db
    .select({ id: quoteChargeInstances.id })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.quoteId, quoteId),
        isNotNull(quoteChargeInstances.ownerQuoteLeafId),
      ),
    );
  record(
    "NON-VACUOUS · the component starts with no component-owned charges",
    existing.length === 0,
    `${existing.length} already present`,
  );
  if (existing.length !== 0) refuse("subject is not clean; the counts below would not mean what they say");
  console.log(`subject quote ${quoteId} · component ${leafId}\n`);

  const created: string[] = [];
  try {
    // ── 1 · the first charge ──────────────────────────────────────────────
    const first = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "print_plates", label: "Front panel" }],
    });
    record("the first charge is created", first.ok, first.ok ? undefined : first.error.message);
    if (first.ok) created.push(first.data.created[0].chargeInstanceId);

    // ── 2 · THE OLD BEHAVIOUR, now refused ────────────────────────────────
    //
    // Unlabelled, which is exactly what the sheet used to send because it did
    // not know the component already owned the type. It reported success and
    // created nothing.
    const unlabelled = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "print_plates" }],
    });
    // TRACKED EVEN THOUGH IT IS EXPECTED TO FAIL. The first run of this proof
    // recorded only the calls it expected to succeed, so when this one
    // unexpectedly succeeded its row was never cleaned up — found by the
    // population-wide residue check, which is the reason that check is
    // population-wide rather than scoped to what the run meant to create.
    if (unlabelled.ok) created.push(...unlabelled.data.created.map((c) => c.chargeInstanceId));
    record(
      "a SECOND unlabelled charge of the type is REFUSED, not silently absorbed",
      !unlabelled.ok,
      unlabelled.ok
        ? "ACCEPTED — reported success for a write it did not perform"
        : unlabelled.error.message,
    );

    // ── 3 · an identical label is refused too ─────────────────────────────
    const same = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "print_plates", label: "Front panel" }],
    });
    if (same.ok) created.push(...same.data.created.map((c) => c.chargeInstanceId));
    record(
      "a second charge with the SAME label is refused",
      !same.ok,
      same.ok ? "ACCEPTED — two charges nothing tells apart" : same.error.message,
    );

    const afterRefusals = await db
      .select({ id: quoteChargeInstances.id })
      .from(quoteChargeInstances)
      .where(
        and(
          eq(quoteChargeInstances.quoteId, quoteId),
          isNotNull(quoteChargeInstances.ownerQuoteLeafId),
        ),
      );
    record(
      "and neither refusal persisted anything",
      afterRefusals.length === 1,
      `${afterRefusals.length} instance(s); expected the first only`,
    );

    // ── 4 · THE CAPABILITY · a distinct label mints a second identity ─────
    const second = await createComponentChargesAs(operator.id, {
      quoteId,
      quoteLeafId: leafId,
      charges: [{ chargeKey: "print_plates", label: "Back panel" }],
    });
    record(
      "a distinct label creates a SECOND instance",
      second.ok,
      second.ok ? undefined : second.error.message,
    );
    if (second.ok) created.push(second.data.created[0].chargeInstanceId);

    const both = await db
      .select({ id: quoteChargeInstances.id, label: quoteChargeInstances.label })
      .from(quoteChargeInstances)
      .where(
        and(
          eq(quoteChargeInstances.quoteId, quoteId),
          eq(quoteChargeInstances.chargeKey, "print_plates"),
          isNotNull(quoteChargeInstances.ownerQuoteLeafId),
        ),
      );
    record(
      "TWO distinct instances on ONE component, of ONE type",
      both.length === 2 && new Set(both.map((b) => b.id)).size === 2,
      `${both.length} instance(s): ${both.map((b) => b.label ?? "(no label)").join(" / ")}`,
    );

    // ── 5 · and the sheet would now SEE them ──────────────────────────────
    const seen = (await readExistingComponentCharges(quoteId)).filter(
      (e) => e.quoteLeafId === leafId && e.chargeKey === "print_plates",
    );
    record(
      "the reader reports both, with identity and labels",
      seen.length === 2 &&
        seen.every((e) => !!e.chargeInstanceId) &&
        new Set(seen.map((e) => e.label)).size === 2,
      seen.map((e) => `${e.label} (${e.chargeInstanceId.slice(0, 8)})`).join(" / "),
    );
  } finally {
    if (created.length > 0) {
      const candidates = await db
        .select({ id: auditLog.id, diff: auditLog.diffJson })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, quoteId), eq(auditLog.action, "component_charge_created")),
        );
      const mine = candidates
        .filter((a) => {
          const cid = (a.diff as { charge_instance_id?: string } | null)?.charge_instance_id;
          return !!cid && created.includes(cid);
        })
        .map((a) => a.id);
      await db.delete(quoteChargeInstances).where(inArray(quoteChargeInstances.id, created));
      if (mine.length > 0) await db.delete(auditLog).where(inArray(auditLog.id, mine));

      const left = await db
        .select({ id: quoteChargeInstances.id })
        .from(quoteChargeInstances)
        .where(isNotNull(quoteChargeInstances.ownerQuoteLeafId));
      record(
        "RESIDUE · everything this proof created is gone, POPULATION-WIDE, and verified",
        left.length === 0,
        `${left.length} component charge(s) remain anywhere; ${mine.length} audit row(s) removed`,
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

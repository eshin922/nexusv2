/**
 * The frozen-election grain, proven against the real database.
 *
 * Uniqueness and referential behaviour are properties of POSTGRES, not of the
 * TypeScript that describes them. A test asserting the schema text says
 * `SET NULL` cannot tell you what happens when a row is deleted — so this
 * exercises the constraints directly and reads what the database does.
 *
 * ── IT WRITES, AND IT KEEPS NOTHING ──────────────────────────────────────
 *
 * Everything happens inside one transaction that ALWAYS rolls back, including
 * on success. Nothing survives. That is the only way to observe a unique
 * violation or a delete cascade honestly: you have to actually attempt them.
 *
 * Each case runs in its own SAVEPOINT, because a failed statement poisons the
 * surrounding transaction in Postgres and every later case would then report a
 * failure it did not cause.
 *
 * ── WHAT IS BEING FALSIFIED ──────────────────────────────────────────────
 *
 *   1  same snapshot + same charge key + two DISTINCT instance ids -> permitted
 *      (the O3 shape; refusing this is the defect 0118 repaired)
 *   2  same snapshot + the SAME instance twice                     -> refused
 *      (the modern uniqueness still binds)
 *   3  two legacy NULL rows with one charge key                    -> refused
 *      (history keeps the guarantee it was written under)
 *   4  deleting the live charge instance                           -> the frozen
 *      row and its UUID are UNCHANGED (0119: frozen provenance)
 *
 * Case 4 is the one 0119 exists for. Under 0118's `ON DELETE SET NULL` it would
 * null the column, migrating a modern row into the legacy namespace — and with
 * two such rows, colliding on `(snapshot_id, charge_key)`: the same 23505 class
 * 0118 removed, reintroduced by a delete rather than by a send.
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";

const QUOTE = process.argv[2] ?? "4ec5db82-967a-482c-a9e5-48baf3fc11f5";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
};

console.log("FROZEN ELECTION GRAIN — FALSIFIED AGAINST POSTGRES\n");

class Rollback extends Error {}

try {
  await db.transaction(async (tx) => {
    // A snapshot to hang the rows off. Real FK, real table, rolled back.
    const [snap]: any = await tx.execute(sql`
      insert into quote_snapshots (quote_id, version_number, quote_number, effective_from, sent_at)
      values (${QUOTE}, 9999, 'FALSIFY-TMP', now(), now())
      returning id`);
    const snapshotId = snap.id;

    // Two live charge instances, standing in for O3's two print_plates.
    const leaf: any = (
      await tx.execute(sql`
        select ql.id from quote_leaves ql
        join assembly_leaves al on al.quote_leaf_id = ql.id
        join assemblies a on a.id = al.assembly_id
        where a.quote_id = ${QUOTE} limit 1`)
    )[0];
    const mk = async (label: string) => {
      const [r]: any = await tx.execute(sql`
        insert into quote_charge_instances (quote_id, charge_key, owner_quote_leaf_id, owner_ref, label)
        values (${QUOTE}, 'print_plates', ${leaf.id}, ${leaf.id}, ${label})
        returning id`);
      return r.id as string;
    };
    const instA = await mk("FALSIFY-A");
    const instB = await mk("FALSIFY-B");

    const attempt = async (name: string, run: () => Promise<unknown>) => {
      // Own savepoint: a failed statement poisons the transaction, and every
      // later case would then report a failure it did not cause.
      await tx.execute(sql`savepoint s`);
      try {
        await run();
        await tx.execute(sql`release savepoint s`);
        return { ok: true as const };
      } catch (e: any) {
        await tx.execute(sql`rollback to savepoint s`);
        return { ok: false as const, code: e?.code, msg: String(e?.message ?? "").slice(0, 90) };
      }
    };

    const insert = (instanceId: string | null) =>
      tx.execute(sql`
        insert into quote_snapshot_charge_recovery (snapshot_id, charge_key, mode, charge_instance_id)
        values (${snapshotId}, 'print_plates', 'separate', ${instanceId})`);

    // ── 1 · the O3 shape ────────────────────────────────────────────────
    const a = await attempt("first", () => insert(instA));
    const b = await attempt("second", () => insert(instB));
    check(
      a.ok && b.ok,
      "same snapshot + same charge key + two DISTINCT instances — permitted",
      a.ok && b.ok ? "both inserted" : `a=${a.ok} b=${b.ok} ${(b as any).msg ?? ""}`,
    );

    // ── 2 · the modern uniqueness still binds ───────────────────────────
    const dup = await attempt("dup", () => insert(instA));
    check(
      !dup.ok && dup.code === "23505",
      "the SAME instance twice in one snapshot — refused",
      dup.ok ? "PERMITTED — uniqueness lost" : `${dup.code}`,
    );

    // ── 3 · history keeps its own rule ──────────────────────────────────
    const l1 = await attempt("legacy1", () => insert(null));
    const l2 = await attempt("legacy2", () => insert(null));
    check(
      l1.ok && !l2.ok && l2.code === "23505",
      "two legacy NULL rows with one charge key — refused, as before 0118",
      `first=${l1.ok} second=${l2.ok ? "PERMITTED — legacy guarantee lost" : l2.code}`,
    );

    // ── 4 · WHAT 0119 EXISTS FOR ────────────────────────────────────────
    const before: any = (
      await tx.execute(sql`
        select charge_instance_id from quote_snapshot_charge_recovery
        where snapshot_id = ${snapshotId} and charge_instance_id = ${instA}`)
    )[0];

    const del = await attempt("delete", () =>
      tx.execute(sql`delete from quote_charge_instances where id = ${instA}`),
    );
    check(del.ok, "the live charge instance can still be deleted", del.ok ? "" : `${del.code} ${(del as any).msg}`);

    const after: any = (
      await tx.execute(sql`
        select charge_instance_id from quote_snapshot_charge_recovery
        where snapshot_id = ${snapshotId} and charge_instance_id = ${instA}`)
    )[0];
    check(
      !!after && after.charge_instance_id === before?.charge_instance_id,
      "the frozen row keeps the UUID it froze — no SET NULL, no CASCADE",
      after ? `${String(after.charge_instance_id).slice(0, 8)} preserved` : "ROW GONE OR NULLED",
    );

    // And the collision that SET NULL would have caused cannot arise, because
    // nothing moved into the legacy namespace.
    const legacyNow: any = (
      await tx.execute(sql`
        select count(*) n from quote_snapshot_charge_recovery
        where snapshot_id = ${snapshotId} and charge_instance_id is null`)
    )[0];
    check(
      Number(legacyNow.n) === 1,
      "the delete moved nothing into the legacy namespace",
      `${legacyNow.n} legacy row(s) — expected the 1 inserted in case 3`,
    );

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.log("\n  HARNESS ERROR —", (e as any)?.message);
    process.exit(2);
  }
}

// The control: a harness that silently kept its rows would be worse than none.
const leaked: any = (
  await db.execute(sql`select count(*) n from quote_snapshots where quote_number = 'FALSIFY-TMP'`)
)[0];
check(Number(leaked.n) === 0, "the harness left nothing behind", `${leaked.n} row(s)`);

console.log(failures === 0 ? "\nGRAIN FALSIFIED — all four cases behave" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

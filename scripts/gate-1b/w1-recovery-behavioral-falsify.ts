/**
 * W1 · BEHAVIOURAL falsification of the recovery contract.
 *
 * Predicate and source-text tests establish that the RULES are right. They
 * cannot establish that the writers, the binding and the mirror behave -- a
 * source grep proves a line exists, not that it runs, and a pure-function test
 * proves an implication, not that the implication is reached.
 *
 * So this drives the REAL lifecycle writers and the REAL binding against the
 * REAL schema, inside a transaction that is always rolled back. Nothing here
 * touches a historical record: it creates its own attempt rows against a
 * scratch quote and unwinds them.
 *
 * Cases, each mapped to a way production actually broke:
 *
 *   1  interrupted tranid lookup   the SO id must already be durable
 *   2  tranid attaches after       and reaches the quote mirror
 *   3  a failed lookup never clears an established tranid
 *   4  snapshot mismatch            binding REFUSES before any CREATE path
 *   5  identity is stable           the binding names one order, repeatedly
 *   6  repeated continuation        idempotent - same attempt, same order
 *   7  interruption mid-continue    still resumable afterwards
 *   8  successful freeze            reaches succeeded, mirror agrees
 *   9  needs_reconciliation         mirrors, and no longer reads as pending
 */
import { db } from "@/db";
import { sql, eq, desc } from "drizzle-orm";
import { netsuiteSoPushes, quotes, quoteSnapshots } from "@/db/schema";
import {
  bindResume,
  recordAttemptFailure,
  recordAttemptSucceeded,
  recordNeedsReconciliation,
  recordSalesOrderCreated,
  recordSalesOrderTranid,
} from "@/lib/netsuite/attempt-lifecycle";
import { receiptVariantFor } from "@/lib/netsuite/receipt-variant";

const HISTORICAL = new Set([
  "DPS-1046",
  "DPS-1051",
  "DPS-1055",
  "DPS-1062",
]);

const fails: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(62)} ${detail}`);
  if (!ok) fails.push(label);
};

// A scratch quote to hang attempts from: any quote with a snapshot, never one
// of the four under adjudication.
// Excludes the four under adjudication AND the certified O1-O5 references:
// the transaction rolls back, but a preservation reference is not a scratch
// pad, and picking one would be the kind of convenience that stops being
// harmless the first time a rollback does not happen.
const [subject] = (await db.execute(sql`
  SELECT q.id::text qid, q.quote_number qn, s.id::text sid, t.id::text tid
    FROM quotes q
    JOIN quote_snapshots s ON s.quote_id = q.id
    JOIN quote_tiers  t ON t.quote_id = q.id
   WHERE q.quote_number IS NOT NULL
     AND q.quote_number NOT IN ('DPS-1046','DPS-1051','DPS-1055','DPS-1062')
     AND q.quote_number NOT IN ('DPS-1072','DPS-1073','DPS-1074','DPS-1075','DPS-1076')
     -- and no EXISTING succeeded push: the success unique index permits one
     -- per quote, and case 8 writes a succeeded row. The schema refusing a
     -- second is correct; the falsification just needs a subject where its
     -- own write is the first.
     AND NOT EXISTS (
       SELECT 1 FROM netsuite_so_pushes p
        WHERE p.quote_id = q.id AND p.status = 'succeeded'
     )
   ORDER BY q.created_at DESC LIMIT 1
`)) as unknown as Array<{ qid: string; qn: string; sid: string; tid: string }>;

if (!subject) {
  console.log("INDETERMINATE - no scratch quote with a snapshot available.");
  process.exit(2);
}
if (HISTORICAL.has(subject.qn)) {
  console.log("REFUSED - the scratch subject is a historical record under adjudication.");
  process.exit(1);
}
console.log(`W1 behavioural falsification · scratch subject ${subject.qn}\n`);

class Rollback extends Error {}

try {
  await db.transaction(async (tx) => {
    const exec = tx as unknown as typeof db;

    const mirror = async () => {
      const [q] = await exec
        .select({
          status: quotes.netsuiteSoPushStatus,
          soId: quotes.netsuiteSoId,
          tranid: quotes.netsuiteSoTranid,
          err: quotes.netsuiteSoPushError,
        })
        .from(quotes)
        .where(eq(quotes.id, subject.qid));
      return q;
    };
    const row = async (id: string) => {
      const [r] = await exec
        .select({
          status: netsuiteSoPushes.status,
          soId: netsuiteSoPushes.netsuiteSoId,
          tranid: netsuiteSoPushes.netsuiteSoTranid,
        })
        .from(netsuiteSoPushes)
        .where(eq(netsuiteSoPushes.id, id));
      return r;
    };

    const mkAttempt = async (key: string) => {
      const [a] = await exec
        .insert(netsuiteSoPushes)
        .values({
          quoteId: subject.qid,
          quoteSnapshotId: subject.sid,
          acceptedTierId: subject.tid,
          status: "pending",
          idempotencyKey: key,
        })
        .returning({ id: netsuiteSoPushes.id });
      return a.id;
    };

    // ── 1 · the SO id is durable BEFORE any tranid lookup ───────────────
    const a1 = await mkAttempt(`w1-falsify-${subject.qid}-1`);
    await recordSalesOrderCreated(
      { attemptId: a1, netsuiteSoId: "999001", netsuiteSoTranid: null, amountPushed: 100 },
      exec,
    );
    const r1 = await row(a1);
    check("1 · interrupted tranid lookup leaves the SO id durable", r1.soId === "999001" && r1.status === "awaiting_rates", `${r1.status} / ${r1.soId}`);
    const m1 = await mirror();
    check("1b · and the quote mirror carries that id", m1.soId === "999001" && m1.status === "awaiting_rates", `${m1.status} / ${m1.soId}`);

    // ── 2 · the tranid attaches afterwards, and reaches the mirror ──────
    await recordSalesOrderTranid({ attemptId: a1, netsuiteSoTranid: "SO9001" }, exec);
    const r2 = await row(a1);
    const m2 = await mirror();
    check("2 · tranid attaches to the row after the id is durable", r2.tranid === "SO9001", String(r2.tranid));
    check("2b · and reaches the quote mirror", m2.tranid === "SO9001", String(m2.tranid));
    check("2c · the id did not move when the tranid landed", r2.soId === "999001", String(r2.soId));

    // ── 3 · a failed lookup must not clear an established tranid ────────
    await recordSalesOrderTranid({ attemptId: a1, netsuiteSoTranid: "" }, exec);
    const r3 = await row(a1);
    check("3 · an empty lookup result cannot erase a known tranid", r3.tranid === "SO9001", String(r3.tranid));

    // ── 4 · snapshot mismatch REFUSES ──────────────────────────────────
    const bad = await bindResume(
      { quoteId: subject.qid, currentSnapshotId: "00000000-0000-0000-0000-000000000000" },
      exec,
    );
    check("4 · a snapshot mismatch refuses the binding", bad.ok === false, bad.ok ? "BOUND" : bad.reason.slice(0, 48));

    // ── 5 · identity is stable, and named by the binding ────────────────
    const good = await bindResume({ quoteId: subject.qid, currentSnapshotId: subject.sid }, exec);
    check("5 · the binding names the existing order", good.ok === true && good.netsuiteSoId === "999001", good.ok ? good.netsuiteSoId : good.reason);

    // ── 6 · repeated continuation is idempotent ────────────────────────
    const again = await bindResume({ quoteId: subject.qid, currentSnapshotId: subject.sid }, exec);
    check(
      "6 · a repeated binding returns the SAME attempt and order",
      again.ok === true && good.ok === true && again.attemptId === good.attemptId && again.netsuiteSoId === good.netsuiteSoId,
      again.ok ? `${again.attemptId.slice(0, 8)} / ${again.netsuiteSoId}` : again.reason,
    );

    // ── 7 · an interruption mid-continuation stays resumable ───────────
    await recordAttemptFailure(
      { attemptId: a1, netsuiteSoId: "999001", errorClass: "verification", errorDetail: "interrupted" },
      exec,
    );
    const r7 = await row(a1);
    const b7 = await bindResume({ quoteId: subject.qid, currentSnapshotId: subject.sid }, exec);
    check("7 · a post-CREATE interruption never becomes failed", r7.status === "awaiting_rates", String(r7.status));
    check("7b · and the order remains bindable for continuation", b7.ok === true, b7.ok ? "bindable" : b7.reason);
    check("7c · with its identity intact", r7.soId === "999001" && r7.tranid === "SO9001", `${r7.soId} / ${r7.tranid}`);

    // ── 8 · a successful continuation reaches succeeded ────────────────
    await recordAttemptSucceeded(
      { attemptId: a1, netsuiteSoId: "999001", netsuiteSoTranid: "SO9001", amountPushed: 100 },
      exec,
    );
    const r8 = await row(a1);
    const m8 = await mirror();
    check("8 · continuation reaches succeeded", r8.status === "succeeded", String(r8.status));
    check("8b · the mirror agrees, with identity", m8.status === "succeeded" && m8.soId === "999001" && m8.tranid === "SO9001", `${m8.status} / ${m8.soId} / ${m8.tranid}`);
    const b8 = await bindResume({ quoteId: subject.qid, currentSnapshotId: subject.sid }, exec);
    check("8c · a succeeded order is no longer continuable", b8.ok === false, b8.ok ? "STILL BINDABLE" : b8.reason.slice(0, 40));

    // ── C3 · the ownership invariant refuses a sibling attempt ─────────
    //
    // Not a contrivance -- an earlier version of this falsification tried to
    // insert a SECOND attempt row against the same snapshot for case 9, and
    // migration 0065's snapshot-attempt unique index refused it. That is the
    // rule that makes a second CREATE impossible, demonstrated behaviourally
    // rather than asserted: the attempt owns its snapshot, so no sibling can
    // exist to create anything behind it.
    let siblingRefused = false;
    try {
      await mkAttempt(`w1-falsify-${subject.qid}-sibling`);
    } catch {
      siblingRefused = true;
    }
    check("C3 · a sibling attempt on an owned snapshot is refused", siblingRefused, siblingRefused ? "unique index held" : "SIBLING ADMITTED");

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}

// ── 9 · needs_reconciliation mirrors, and is not pending ────────────────
//
// Its own transaction: the previous one drove its attempt to `succeeded`, and
// that attempt owns the snapshot, so a second row cannot be inserted beside it.
// Reusing one transaction here would have meant testing the state on a row
// that had already terminated somewhere else.
try {
  await db.transaction(async (tx) => {
    const exec = tx as unknown as typeof db;
    const [a9] = await exec
      .insert(netsuiteSoPushes)
      .values({
        quoteId: subject.qid,
        quoteSnapshotId: subject.sid,
        acceptedTierId: subject.tid,
        status: "pending",
        idempotencyKey: `w1-falsify-${subject.qid}-9`,
      })
      .returning({ id: netsuiteSoPushes.id });

    await recordNeedsReconciliation(
      { attemptId: a9.id, errorDetail: "DUPLICATED DEAL" },
      exec,
    );
    const [r9] = await exec
      .select({ status: netsuiteSoPushes.status })
      .from(netsuiteSoPushes)
      .where(eq(netsuiteSoPushes.id, a9.id));
    const [m9] = await exec
      .select({
        status: quotes.netsuiteSoPushStatus,
        err: quotes.netsuiteSoPushError,
      })
      .from(quotes)
      .where(eq(quotes.id, subject.qid));

    check("9 · needs_reconciliation is recorded on the row", r9.status === "needs_reconciliation", String(r9.status));
    check("9b · and MIRRORS onto the quote — the gap this closes", m9.status === "needs_reconciliation", String(m9.status ?? "NULL"));
    check("9c · with operator copy that explains the conflict", /may already exist/i.test(String(m9.err)), String(m9.err ?? "").slice(0, 44));
    check("9d · and it never renders as pending", receiptVariantFor(m9.status, false) === "reconcile", receiptVariantFor(m9.status, false));

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}

// ── the transaction unwound; nothing persists ────────────────────────────
const [after] = (await db.execute(sql`
  SELECT count(*)::text n FROM netsuite_so_pushes WHERE idempotency_key LIKE 'w1-falsify-%'
`)) as unknown as Array<{ n: string }>;
check("ROLLBACK · no falsification row survived", after.n === "0", `${after.n} row(s)`);

// The four under adjudication, asserted by STATE rather than by a timestamp:
// `netsuite_so_pushes` has no `updated_at`, and a digest of what the rows
// actually say is the stronger claim anyway.
const histRows = (await db.execute(sql`
  SELECT q.quote_number qn, p.status::text ps,
         coalesce(p.netsuite_so_id,'-') sid, coalesce(p.netsuite_so_tranid,'-') tid
    FROM netsuite_so_pushes p JOIN quotes q ON q.id = p.quote_id
   WHERE q.quote_number IN ('DPS-1046','DPS-1051','DPS-1055','DPS-1062')
   ORDER BY q.quote_number
`)) as unknown as Array<Record<string, string>>;
const observed = histRows.map((r) => `${r.qn}:${r.ps}:${r.sid}:${r.tid}`).join("|");
const EXPECTED_HISTORICAL =
  "DPS-1046:awaiting_rates:361341:-|" +
  "DPS-1051:awaiting_rates:361542:-|" +
  "DPS-1055:needs_reconciliation:-:-|" +
  "DPS-1062:needs_reconciliation:-:-";
check(
  "ROLLBACK · the four historical records are byte-for-byte unchanged",
  observed === EXPECTED_HISTORICAL,
  observed === EXPECTED_HISTORICAL ? "4 records unchanged" : observed,
);

console.log("");
console.log(fails.length === 0 ? "W1 BEHAVIOURAL FALSIFICATION: PASS" : `FAIL — ${fails.length}`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);

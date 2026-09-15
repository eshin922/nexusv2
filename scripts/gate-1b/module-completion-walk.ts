/**
 * Mark complete, per module — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:module-completion-walk
 *
 * Drives the REAL actions against the isolated database. The banner that used
 * to carry all of this was deleted; what has to be shown is that NOTHING
 * underneath it went with it — the same rows, the same audit entries, the same
 * refusals, reached now from inside the modules.
 *
 * ── WHAT IS UNDER TEST IS MOSTLY REFUSALS ────────────────────────────────
 *
 * A refusal is only established by attempting the thing it forbids, so every
 * one is attempted here: a PM completing freight they do not hold, a second
 * click creating a second handoff, a reopen of a completion that has already
 * been reopened, a withdrawal of a request logistics has already closed.
 *
 * ── AND ONE THING THE BANNER NEVER HAD TO GET RIGHT ──────────────────────
 *
 * The banner read the OPEN handoff, and vanished when there was none. Two
 * modules cannot do that: once logistics completes, the open read goes empty
 * while Packaging is still complete and Freight is finished. Reading only the
 * open row would make both modules report that the work had never been handed
 * over — because it had been handed over and finished. §2c is that case.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}

// Starts as the PM — the quote side, which asks and takes back. Flipped to
// admin where the holder's end is under test. The identity provider reads the
// environment per call, so flipping it mid-walk changes who is asking without
// rebuilding the composition.
process.env.NEXUS_VALIDATION_IDENTITY = "pm";

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const {
  completeFreightHandoff,
  getFreightHandoff,
  getLatestFreightHandoff,
  markFreightIncomplete,
  markPackagingIncomplete,
  markReadyForFreight,
} = await import("../../src/app/actions/freight-handoff.ts");
const {
  getProductionCompletion,
  markProductionComplete,
  reopenProduction,
} = await import("../../src/app/actions/production-completion.ts");

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

// ═══ setup ═════════════════════════════════════════════════════════════════
//
// Read from the database rather than written here. A fixture that invents the
// ids would be asserting against its own scaffolding, and a quote that is not
// really a draft would pass a draft gate that was not really enforced.
const [pm] = await sql<{ id: string; email: string }[]>`
  select id, email from users where clerk_user_id = 'validation_clerk_pm'
`;
const [admin] = await sql<{ id: string; email: string }[]>`
  select id, email from users where clerk_user_id = 'validation_clerk_admin'
`;
const [quote] = await sql<{ id: string; status: string }[]>`
  select id, status from quotes where status = 'draft' order by id limit 1
`;
if (!pm || !admin || !quote) {
  console.error("REFUSING: the isolated fixtures are missing a PM, an admin or a draft quote.");
  process.exit(1);
}
const QUOTE = quote.id;

// Logistics is the ADMIN here, so the PM is genuinely neither the assignee nor
// an admin when §2a asks them to complete the freight. A refusal tested by
// someone who would have been refused anyway proves nothing about the rule.
const [settings] = await sql<{ id: string; logistics_recipient_user_id: string | null }[]>`
  select id, logistics_recipient_user_id from firm_settings where effective_until is null
`;
const priorRecipient = settings.logistics_recipient_user_id;
await sql`
  update firm_settings set logistics_recipient_user_id = ${admin.id} where id = ${settings.id}
`;

const wipe = async () => {
  await sql`delete from audit_log where entity_id = ${QUOTE}
            and action in ('freight_requested','freight_completed','freight_request_withdrawn',
                           'freight_reopened','packaging_reopened',
                           'production_completed','production_reopened')`;
  await sql`delete from freight_handoffs where quote_id = ${QUOTE}`;
  await sql`delete from production_completions where quote_id = ${QUOTE}`;
};
await wipe();

// The quote itself must not move. Captured BEFORE anything runs, compared at
// the end: completion state lives in its own tables, and a quote whose status
// or columns shifted would be a second source of truth appearing quietly.
const [quoteBefore] = await sql<{ sig: string }[]>`
  select md5(to_jsonb(q)::text) as sig from quotes q where id = ${QUOTE}
`;

const rows = () => sql<
  { id: string; status: string; requested_by_user_id: string; assigned_to_user_id: string;
    notification_status: string; requested_at: Date }[]
>`select * from freight_handoffs where quote_id = ${QUOTE} order by requested_at`;
const audits = (action: string) =>
  sql<{ n: number }[]>`
    select count(*)::int n from audit_log where entity_id = ${QUOTE} and action = ${action}
  `.then((r) => r[0].n);

console.log(`\nquote ${QUOTE} (${quote.status}) · pm ${pm.email} · logistics ${admin.email}`);

// ═══ 1 · Packaging complete IS the freight request ═════════════════════════
console.log("\n── 1 · Packaging · Mark complete ─────────────────────────");

const first = await markReadyForFreight(form({ quoteId: QUOTE }));
check("a PM can mark Packaging complete", first.ok, first.ok ? "" : first.error.code);

let all = await rows();
check("and exactly one handoff exists", all.length === 1, `${all.length} row(s)`);
check("  open", all[0]?.status === "open", all[0]?.status);
check("  requested by the PM who pressed it", all[0]?.requested_by_user_id === pm.id);
check(
  "  assigned to the CONFIGURED logistics recipient, not the presser",
  all[0]?.assigned_to_user_id === admin.id,
);
check("and the request is audited", (await audits("freight_requested")) === 1);

// Slack is not configured in isolation, and the handoff exists anyway. What
// must not happen is the outcome being reported as a success it never was.
check(
  "the notification outcome is reported as what it was",
  all[0]?.notification_status === "not_configured",
  all[0]?.notification_status,
);

const again = await markReadyForFreight(form({ quoteId: QUOTE }));
all = await rows();
check("a second click is harmless", again.ok, again.ok ? "" : again.error.code);
check("  no second handoff", all.length === 1, `${all.length} row(s)`);
check("  and no second notification or audit entry", (await audits("freight_requested")) === 1);

const latest1 = await getLatestFreightHandoff(QUOTE);
check(
  "the modules read it as complete-and-open",
  latest1.ok && latest1.data?.status === "open",
  latest1.ok ? String(latest1.data?.status) : "",
);
check(
  "  carrying the assignee Freight renders",
  latest1.ok && latest1.data?.assignedToEmail === admin.email,
  latest1.ok ? String(latest1.data?.assignedToEmail) : "",
);

// ═══ 2 · Freight · who may close it ════════════════════════════════════════
console.log("\n── 2a · as the PM, who does not hold it ──────────────────");

const handoffId = all[0].id;
const byPm = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId }));
check("a PM cannot complete freight assigned to someone else", !byPm.ok);
check(
  "  and is refused as FORBIDDEN, not as a validation slip",
  !byPm.ok && byPm.error.code === "FORBIDDEN",
  byPm.ok ? "ALLOWED" : byPm.error.code,
);
all = await rows();
check("  the handoff is untouched", all[0]?.status === "open", all[0]?.status);

console.log("\n── 2b · as logistics ─────────────────────────────────────");
process.env.NEXUS_VALIDATION_IDENTITY = "admin";

const closed = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId }));
check("the holder can mark Freight complete", closed.ok, closed.ok ? "" : closed.error.code);
all = await rows();
check("  the handoff is completed", all[0]?.status === "completed", all[0]?.status);
check("  and the completion is audited", (await audits("freight_completed")) === 1);

console.log("\n── 2c · a closed handoff is still legible ────────────────");

// The regression `getLatestFreightHandoff` exists to prevent. Both reads are
// asserted: the open read going empty is CORRECT and unchanged, and it is
// exactly why the modules cannot be built on it.
const openAfter = await getFreightHandoff(QUOTE);
check(
  "the open read is empty, as it always was",
  openAfter.ok && openAfter.data === null,
  openAfter.ok ? String(openAfter.data) : "",
);
const latest2 = await getLatestFreightHandoff(QUOTE);
check(
  "but the modules still see the handoff",
  latest2.ok && latest2.data?.status === "completed",
  latest2.ok ? String(latest2.data?.status) : "",
);
check(
  "  so Packaging reads complete rather than never-handed-over",
  latest2.ok && latest2.data !== null,
);
check(
  "  and Freight can say who closed it, and when",
  latest2.ok &&
    latest2.data?.completedByEmail === admin.email &&
    latest2.data?.completedAt !== null,
  latest2.ok ? String(latest2.data?.completedByEmail) : "",
);

// Packaging's Mark incomplete still works once freight is finished -- it
// pulls the packaging end back and leaves the completed row standing.
process.env.NEXUS_VALIDATION_IDENTITY = "pm";
const lateWithdraw = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId }));
check("Packaging can still be marked incomplete afterwards", lateWithdraw.ok,
  lateWithdraw.ok ? "" : lateWithdraw.error.code);
check(
  "  and it reopens the packaging end rather than withdrawing a finished request",
  lateWithdraw.ok && (lateWithdraw.data as { outcome: string }).outcome === "packaging_reopened",
  lateWithdraw.ok ? (lateWithdraw.data as { outcome: string }).outcome : "",
);
// Undone immediately: §3 below re-uses this handoff and needs it as logistics
// left it. The round trip itself is §6b.
await sql`update freight_handoffs set packaging_reopened_at = null,
          packaging_reopened_by_user_id = null where id = ${handoffId}`;
await sql`delete from audit_log where entity_id = ${QUOTE} and action = 'packaging_reopened'`;

// ═══ 3 · Reopening Packaging before freight finishes ═══════════════════════
console.log("\n── 3 · Packaging · Reopen ────────────────────────────────");

const second = await markReadyForFreight(form({ quoteId: QUOTE }));
check("Packaging can be marked complete again", second.ok, second.ok ? "" : second.error.code);
all = await rows();
check("  which mints a NEW handoff rather than reviving the old", all.length === 2, `${all.length}`);

const openId = all.find((r) => r.status === "open")!.id;
const pulled = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId: openId }));
check("the quote side can reopen Packaging", pulled.ok, pulled.ok ? "" : pulled.error.code);
all = await rows();
check(
  "  the request is withdrawn, not deleted",
  all.length === 2 && all.some((r) => r.id === openId && r.status === "withdrawn"),
);
check("  and the withdrawal is audited", (await audits("freight_request_withdrawn")) === 1);

const latest3 = await getLatestFreightHandoff(QUOTE);
check(
  "a withdrawn handoff reads as NOT complete",
  latest3.ok && latest3.data?.status === "withdrawn",
  latest3.ok ? String(latest3.data?.status) : "",
);

// ═══ 4 · Production, the one module with state of its own ══════════════════
console.log("\n── 4 · Production · Mark complete ────────────────────────");

const prod1 = await markProductionComplete(form({ quoteId: QUOTE }));
check("a PM can mark Production complete", prod1.ok, prod1.ok ? "" : prod1.error.code);
let prodRows = await sql<{ id: string; status: string; completed_by_user_id: string }[]>`
  select * from production_completions where quote_id = ${QUOTE} order by completed_at
`;
check("  exactly one completion exists", prodRows.length === 1, `${prodRows.length}`);
check("  recording WHO completed it", prodRows[0]?.completed_by_user_id === pm.id);
check("  and it is audited", (await audits("production_completed")) === 1);

const prodAgain = await markProductionComplete(form({ quoteId: QUOTE }));
prodRows = await sql`select * from production_completions where quote_id = ${QUOTE} order by completed_at`;
check("a second click is harmless", prodAgain.ok, prodAgain.ok ? "" : prodAgain.error.code);
check("  no second completion", prodRows.length === 1, `${prodRows.length}`);
check("  and no second audit entry", (await audits("production_completed")) === 1);

const readBack = await getProductionCompletion(QUOTE);
check(
  "the module reads who completed it and when",
  readBack.ok &&
    readBack.data?.completedByEmail === pm.email &&
    readBack.data?.completedAt instanceof Date,
  readBack.ok ? String(readBack.data?.completedByEmail) : "",
);

const firstCompletionId = prodRows[0].id;
const reopened = await reopenProduction(form({ completionId: firstCompletionId }));
check("Production can be reopened", reopened.ok, reopened.ok ? "" : reopened.error.code);
prodRows = await sql`select * from production_completions where quote_id = ${QUOTE} order by completed_at`;
check(
  "  the completion is marked reopened, not deleted",
  prodRows.length === 1 && prodRows[0].status === "reopened",
  prodRows[0]?.status,
);
check("  and the reopen is audited", (await audits("production_reopened")) === 1);

const afterReopen = await getProductionCompletion(QUOTE);
check(
  "and the module reads as not complete again",
  afterReopen.ok && afterReopen.data === null,
  afterReopen.ok ? String(afterReopen.data) : "",
);

const prod3 = await markProductionComplete(form({ quoteId: QUOTE }));
prodRows = await sql`select * from production_completions where quote_id = ${QUOTE} order by completed_at`;
check("completing again is permitted", prod3.ok, prod3.ok ? "" : prod3.error.code);
check(
  "  and keeps the earlier claim as history",
  prodRows.length === 2 && prodRows.filter((r) => r.status === "reopened").length === 1,
  `${prodRows.length} row(s)`,
);

const staleReopen = await reopenProduction(form({ completionId: firstCompletionId }));
check("a screen holding the OLD completion cannot reopen the new one", !staleReopen.ok);
check(
  "  refused as a stale write",
  !staleReopen.ok && staleReopen.error.code === "STALE_WRITE",
  staleReopen.ok ? "ALLOWED" : staleReopen.error.code,
);

// ═══ 5 · no second source of truth ═════════════════════════════════════════
console.log("\n── 5 · the quote itself ──────────────────────────────────");

const [quoteAfter] = await sql<{ sig: string }[]>`
  select md5(to_jsonb(q)::text) as sig from quotes q where id = ${QUOTE}
`;
check(
  "not one column of the quote moved",
  quoteAfter.sig === quoteBefore.sig,
  quoteAfter.sig === quoteBefore.sig ? "" : "the quote row changed",
);

// ═══ 6 · complete → incomplete → complete, on each module ══════════════════
//
// The round trip is the thing, not any one leg of it. A module that completes
// and reverses but cannot complete AGAIN is a module an operator can only
// break once, and nothing in the two halves on their own would say so.
console.log("\n── 6a · Packaging, while logistics still holds it ─────────");
await wipe();

let r = await markReadyForFreight(form({ quoteId: QUOTE }));
check("complete", r.ok, r.ok ? "" : r.error.code);
all = await rows();
const openId1 = all[0].id;

r = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId: openId1 }));
check("incomplete", r.ok, r.ok ? "" : r.error.code);
check(
  "  withdraws the outstanding request",
  r.ok && (r.data as { outcome: string }).outcome === "withdrawn",
  r.ok ? (r.data as { outcome: string }).outcome : "",
);
all = await rows();
check("  the row is kept and marked withdrawn", all[0]?.status === "withdrawn", all[0]?.status);
check("  and it is audited", (await audits("freight_request_withdrawn")) === 1);

let latest = await getLatestFreightHandoff(QUOTE);
check(
  "  so Packaging reads incomplete",
  latest.ok && latest.data?.status === "withdrawn",
  latest.ok ? String(latest.data?.status) : "",
);

r = await markReadyForFreight(form({ quoteId: QUOTE }));
check("complete again", r.ok, r.ok ? "" : r.error.code);
all = await rows();
check("  which mints a NEW handoff", all.length === 2, `${all.length} row(s)`);
check("  open", all.some((row) => row.status === "open"));
check(
  "  and notifies logistics again through the same path",
  (await audits("freight_requested")) === 2,
);

// ═══ 6b · Packaging, AFTER logistics finished ══════════════════════════════
console.log("\n── 6b · Packaging, after Freight completed ───────────────");

all = await rows();
const openId2 = all.find((row) => row.status === "open")!.id;
process.env.NEXUS_VALIDATION_IDENTITY = "admin";
r = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId: openId2 }));
check("logistics completes the freight", r.ok, r.ok ? "" : r.error.code);
process.env.NEXUS_VALIDATION_IDENTITY = "pm";

r = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId: openId2 }));
check("Packaging can be marked incomplete anyway", r.ok, r.ok ? "" : r.error.code);
check(
  "  and this is a reopen, not a withdrawal",
  r.ok && (r.data as { outcome: string }).outcome === "packaging_reopened",
  r.ok ? (r.data as { outcome: string }).outcome : "",
);

// THE constraint: the freight record is not rewritten. It really was completed
// and saying otherwise would erase someone else's finished work.
const [afterPull] = await sql<
  { status: string; completed_at: Date | null; completed_by_user_id: string | null;
    packaging_reopened_at: Date | null; packaging_reopened_by_user_id: string | null }[]
>`select * from freight_handoffs where id = ${openId2}`;
check("  the freight completion still stands", afterPull.status === "completed", afterPull.status);
check("  with its completer and time untouched",
  afterPull.completed_at !== null && afterPull.completed_by_user_id === admin.id);
check("  and WHO pulled Packaging back, and when, is recorded",
  afterPull.packaging_reopened_by_user_id === pm.id && afterPull.packaging_reopened_at !== null);
check("  audited as its own event", (await audits("packaging_reopened")) === 1);

latest = await getLatestFreightHandoff(QUOTE);
check(
  "  Packaging reads incomplete though the row says completed",
  latest.ok && latest.data?.status === "completed" && latest.data?.packagingReopenedAt !== null,
  latest.ok ? `${latest.data?.status}/${latest.data?.packagingReopenedAt}` : "",
);

r = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId: openId2 }));
check("a second press changes nothing", !r.ok);
check("  refused as a stale write", !r.ok && r.error.code === "STALE_WRITE",
  r.ok ? "ALLOWED" : r.error.code);
check("  and records no second reopen", (await audits("packaging_reopened")) === 1);

r = await markReadyForFreight(form({ quoteId: QUOTE }));
check("complete again", r.ok, r.ok ? "" : r.error.code);
all = await rows();
check("  a FRESH handoff, leaving the completed one alone", all.length === 3, `${all.length} row(s)`);
check("  the completed one is still completed",
  all.filter((row) => row.status === "completed").length === 1);
check("  and logistics was notified again", (await audits("freight_requested")) === 3);

// ═══ 6c · Freight reopens its own task ═════════════════════════════════════
console.log("\n── 6c · Freight ──────────────────────────────────────────");

all = await rows();
const openId3 = all.find((row) => row.status === "open")!.id;
process.env.NEXUS_VALIDATION_IDENTITY = "admin";
r = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId: openId3 }));
check("complete", r.ok, r.ok ? "" : r.error.code);

process.env.NEXUS_VALIDATION_IDENTITY = "pm";
r = await markFreightIncomplete(form({ quoteId: QUOTE, handoffId: openId3 }));
check("someone who does not hold it cannot reopen it", !r.ok);
check("  refused as FORBIDDEN", !r.ok && r.error.code === "FORBIDDEN",
  r.ok ? "ALLOWED" : r.error.code);

process.env.NEXUS_VALIDATION_IDENTITY = "admin";
// Counted rather than asserted against a literal: the number of completions so
// far depends on what earlier sections did, and a hand-counted expectation
// would be measuring my arithmetic instead of the behaviour.
const completionsBefore = await audits("freight_completed");
r = await markFreightIncomplete(form({ quoteId: QUOTE, handoffId: openId3 }));
check("the holder can", r.ok, r.ok ? "" : r.error.code);

const [freightReopened] = await sql<
  { status: string; completed_at: Date | null; reopened_at: Date | null;
    reopened_by_user_id: string | null }[]
>`select * from freight_handoffs where id = ${openId3}`;
check("  the task is open again", freightReopened.status === "open", freightReopened.status);
check("  it no longer claims to be completed as well", freightReopened.completed_at === null);
check("  and WHO reopened it, and when, is recorded",
  freightReopened.reopened_by_user_id === admin.id && freightReopened.reopened_at !== null);
check("  audited as its own event", (await audits("freight_reopened")) === 1);

// The completion it undid is not lost. `audit_log` is where this subsystem
// keeps history, and the entry that recorded the completion is still there --
// which is what makes clearing the column safe rather than lossy.
const completionsAfter = await audits("freight_completed");
check(
  "  and the completion it undid is still in the history",
  completionsAfter === completionsBefore && completionsBefore > 0,
  `${completionsBefore} before, ${completionsAfter} after`,
);

r = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId: openId3 }));
check("complete again", r.ok, r.ok ? "" : r.error.code);
const [afterRecomplete] = await sql<{ status: string; completed_at: Date | null }[]>`
  select * from freight_handoffs where id = ${openId3}
`;
check("  the same task closes again", afterRecomplete.status === "completed", afterRecomplete.status);
check("  carrying a completion time once more", afterRecomplete.completed_at !== null);

r = await markFreightIncomplete(form({ quoteId: QUOTE, handoffId: openId3 }));
check("and it can be reopened a second time", r.ok, r.ok ? "" : r.error.code);
r = await completeFreightHandoff(form({ quoteId: QUOTE, handoffId: openId3 }));
check("and closed a second time", r.ok, r.ok ? "" : r.error.code);

// ═══ 6d · the two reopens do not collide ═══════════════════════════════════
console.log("\n── 6d · one end at a time ────────────────────────────────");

process.env.NEXUS_VALIDATION_IDENTITY = "pm";
r = await markPackagingIncomplete(form({ quoteId: QUOTE, handoffId: openId3 }));
check("Packaging pulls its end back", r.ok, r.ok ? "" : r.error.code);

process.env.NEXUS_VALIDATION_IDENTITY = "admin";
r = await markFreightIncomplete(form({ quoteId: QUOTE, handoffId: openId3 }));
check("and the freight task can no longer be reopened", !r.ok);
check(
  "  refused as a stale write, not silently ignored",
  !r.ok && r.error.code === "STALE_WRITE",
  r.ok ? "ALLOWED" : r.error.code,
);
const [untouched] = await sql<{ status: string }[]>`
  select * from freight_handoffs where id = ${openId3}
`;
check("  and the refused reopen left it completed", untouched.status === "completed", untouched.status);

// ═══ 6e · Production ═══════════════════════════════════════════════════════
console.log("\n── 6e · Production ───────────────────────────────────────");

process.env.NEXUS_VALIDATION_IDENTITY = "pm";
await sql`delete from production_completions where quote_id = ${QUOTE}`;

r = await markProductionComplete(form({ quoteId: QUOTE }));
check("complete", r.ok, r.ok ? "" : r.error.code);
let prodNow = await sql<{ id: string; status: string; reopened_by_user_id: string | null }[]>`
  select * from production_completions where quote_id = ${QUOTE} order by completed_at
`;
const completionId = prodNow[0].id;

r = await reopenProduction(form({ completionId }));
check("incomplete", r.ok, r.ok ? "" : r.error.code);
prodNow = await sql`select * from production_completions where quote_id = ${QUOTE} order by completed_at`;
check("  the record is kept and marked reopened", prodNow[0].status === "reopened", prodNow[0].status);
check("  and WHO reopened it is recorded", prodNow[0].reopened_by_user_id === pm.id);

const readAfter = await getProductionCompletion(QUOTE);
check("  so Production reads incomplete", readAfter.ok && readAfter.data === null);

r = await markProductionComplete(form({ quoteId: QUOTE }));
check("complete again", r.ok, r.ok ? "" : r.error.code);
prodNow = await sql`select * from production_completions where quote_id = ${QUOTE} order by completed_at`;
check("  a NEW record, keeping the earlier claim", prodNow.length === 2, `${prodNow.length} row(s)`);

r = await reopenProduction(form({ completionId }));
check("and the old record cannot be reopened twice", !r.ok);
check("  refused as a stale write", !r.ok && r.error.code === "STALE_WRITE",
  r.ok ? "ALLOWED" : r.error.code);

// ═══ cleanup ═══════════════════════════════════════════════════════════════
await wipe();
await sql`
  update firm_settings set logistics_recipient_user_id = ${priorRecipient} where id = ${settings.id}
`;
await sql.end();

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

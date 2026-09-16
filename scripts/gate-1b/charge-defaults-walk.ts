/**
 * Product Type → charge defaults, in Settings — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:charge-defaults-walk
 *
 * Drives the REAL admin actions against the isolated database. Everything here
 * was previously asserted structurally — that a lock is taken, that an audit
 * uses the transaction handle, that a non-admin is refused. A structural
 * assertion establishes that the code SAYS those things. This establishes that
 * the database agrees.
 *
 * ── THE THREE CLAIMS THAT NEEDED EXECUTION, NOT READING ──────────────────
 *
 * 1 · THE LOCK ACTUALLY GATES THE WRITE. Asserted deterministically, by
 *     holding the same advisory lock from a separate connection and observing
 *     that the action does not complete until it is released. A grep for
 *     `pg_advisory_xact_lock` cannot distinguish a lock that is taken from one
 *     that is taken on the wrong key.
 *
 * 2 · THE RACE IT EXCLUDES IS REAL. A control runs the SAME statements with
 *     the lock removed and produces the contradiction. Without this, "no
 *     contradiction observed" is equally consistent with a lock that works and
 *     with a hazard that never existed — Pattern 60: a control that cannot
 *     express the failure proves nothing by not reporting it.
 *
 * 3 · AN AUDIT FAILURE TAKES THE DATA WITH IT. Forced by a trigger that
 *     rejects the audit row, then checked for the absence of the profile the
 *     action would otherwise have written.
 *
 * ── WHAT THIS WALK DOES NOT ESTABLISH ────────────────────────────────────
 *
 * The UI. Every path here is an action call. The Settings surface is
 * exercised separately, in a browser, against this same database — see the
 * PR's verification section. A passing walk says the actions are right; it
 * says nothing about whether a control is reachable.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}

// Admin by default, because Settings is admin-only. Set BEFORE the modules
// load: the composition layer reads the identity at import time.
process.env.NEXUS_VALIDATION_IDENTITY = "admin";

const sql = postgres(url, { max: 8, prepare: false });

let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const {
  listChargeDefaults,
  setNoneExpected,
  upsertChargeDefault,
  removeChargeDefault,
  clearChargeProfile,
} = await import("../../src/app/actions/charge-defaults.ts");

const { describeEmptyResolution } = await import(
  "../../src/lib/commercial-recovery/charge-defaults.ts"
);

/** Real HubSpot values, including one whose label diverges from it. */
const T_NONE = "Freight";
const T_RULES = "Secondary"; // label "Secondary Packaging"
const T_RACE = "Primary"; // label "Primary Packaging"
const T_BAD = "Labels";
const TYPES = [T_NONE, T_RULES, T_RACE, T_BAD];

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

/**
 * Start from nothing, EVERY run.
 *
 * A walk that inherits its own leftovers stops testing the transition it
 * claims to: "no profile" would be satisfied by a row that happens to be
 * absent for an unrelated reason, and the refusal assertions would pass
 * trivially on the second run. Banked from the formulated-schema walk, which
 * passed a refusal that had already been applied.
 */
const purge = async () => {
  await sql`delete from product_type_charge_defaults where product_type_value = any(${TYPES})`;
  await sql`delete from product_type_charge_profile where product_type_value = any(${TYPES})`;
};

const resolutionFor = async (value: string) => {
  const r = await listChargeDefaults();
  if (!r.ok) throw new Error(`listChargeDefaults failed: ${r.error.message}`);
  return r.data.find((x) => x.productTypeValue === value)?.resolution ?? null;
};

/** Everything the two tables hold, as one comparable string. */
const stateSignature = async () => {
  const p = await sql<{ s: string }[]>`
    select coalesce(string_agg(product_type_value || '=' || verdict, '|' order by product_type_value), '') as s
      from product_type_charge_profile
  `;
  const d = await sql<{ s: string }[]>`
    select coalesce(string_agg(product_type_value || ':' || charge_key || ':' || preselected, '|'
                   order by product_type_value, charge_key), '') as s
      from product_type_charge_defaults
  `;
  return `${p[0].s}//${d[0].s}`;
};

const auditCount = async (value: string) =>
  (
    await sql<{ n: number }[]>`
      select count(*)::int n from audit_log
       where entity_id = ${value} or entity_id like ${value + ":%"}
    `
  )[0].n;

const lockKey = (value: string) =>
  sql`select hashtextextended(${"product_type_charge_defaults:" + value}, 0) as k`;

const auditBaseline = async () => {
  const rows = await sql<{ action: string; n: number }[]>`
    select action, count(*)::int n from audit_log
     where action like 'product_type_charge%' group by action
  `;
  return new Map(rows.map((r) => [r.action, r.n]));
};

try {
  await purge();
  const auditAtStart = await auditBaseline();

  // ═══ 1 · the three states, and the transitions between them ═══════════
  console.log("\n── needs review → none expected → needs review ─────────────");

  const before = await resolutionFor(T_NONE);
  check("an unreviewed type is absent from the reviewed listing", before === null);

  const none = await setNoneExpected(
    form({ productTypeValue: T_NONE, note: "freight is a landed charge" }),
  );
  check("an admin can record `none expected`", none.ok,
    none.ok ? "" : none.error.message.slice(0, 90));

  const afterNone = await resolutionFor(T_NONE);
  check("and it now reads as `none_expected`", afterNone?.kind === "none_expected",
    String(afterNone?.kind));
  check(
    "carrying a real reviewer and date from the database",
    afterNone?.kind === "none_expected" &&
      afterNone.reviewedByEmail === "admin@nexus-validation.invalid" &&
      afterNone.reviewedAt instanceof Date,
    afterNone?.kind === "none_expected" ? String(afterNone.reviewedByEmail) : "",
  );
  check(
    "the note the reviewer wrote survives the round trip",
    afterNone?.kind === "none_expected" && afterNone.note === "freight is a landed charge",
  );

  const profileRow = (
    await sql<{ reviewed_by_user_id: string; reviewed_at: Date; verdict: string }[]>`
      select reviewed_by_user_id, reviewed_at, verdict
        from product_type_charge_profile where product_type_value = ${T_NONE}
    `
  )[0];
  check("the row records WHO, not just what", profileRow?.reviewed_by_user_id != null);
  check("with the governed verdict value", profileRow?.verdict === "none_expected");

  // A DELTA, not a count. audit_log is append-only and survives the purge --
  // an absolute count passes on the first run and fails on the second, which
  // is a walk measuring its own history rather than this call.
  const auditedNone = auditAtStart.get("product_type_charge_profile_reviewed") ?? 0;
  const auditedNow = (
    await sql<{ n: number }[]>`
      select count(*)::int n from audit_log
       where action = 'product_type_charge_profile_reviewed'
    `
  )[0].n;
  check("and the review is audited", auditedNow === auditedNone + 1,
    `${auditedNone} → ${auditedNow}`);
  const attributed = (
    await sql<{ n: number }[]>`
      select count(*)::int n from audit_log
       where entity_id = ${T_NONE} and action = 'product_type_charge_profile_reviewed'
         and user_id is not null and actor_display_name is not null
    `
  )[0].n;
  check("against the product type, by a named actor", attributed >= 1, `${attributed} row(s)`);

  const cleared = await clearChargeProfile(form({ productTypeValue: T_NONE }));
  check("the review can be withdrawn", cleared.ok);
  check("returning the type to unreviewed", (await resolutionFor(T_NONE)) === null);

  const clearAgain = await clearChargeProfile(form({ productTypeValue: T_NONE }));
  check(
    "and withdrawing a review that does not exist is refused, not silently accepted",
    !clearAgain.ok && clearAgain.error.code === "NOT_FOUND",
    clearAgain.ok ? "accepted" : clearAgain.error.code,
  );

  // ═══ 2 · suggestions ══════════════════════════════════════════════════
  console.log("\n── needs review → suggestions ─────────────────────────────");

  const add1 = await upsertChargeDefault(
    form({ productTypeValue: T_RULES, chargeKey: "print_plates", preselected: "on" }),
  );
  check("adding the first suggestion creates the profile too", add1.ok,
    add1.ok ? "" : add1.error.message.slice(0, 90));

  const v1 = (
    await sql<{ verdict: string }[]>`
      select verdict from product_type_charge_profile where product_type_value = ${T_RULES}
    `
  )[0];
  check("at verdict `defaults`, in the same transaction", v1?.verdict === "defaults",
    String(v1?.verdict));

  await upsertChargeDefault(form({ productTypeValue: T_RULES, chargeKey: "tooling" }));
  const sugg = await resolutionFor(T_RULES);
  check("two suggestions read back", sugg?.kind === "suggestions", String(sugg?.kind));
  check(
    "in a stable order, with preselection preserved",
    sugg?.kind === "suggestions" &&
      sugg.suggestions.map((s) => `${s.chargeKey}:${s.preselected}`).join(",") ===
        "print_plates:true,tooling:false",
    sugg?.kind === "suggestions"
      ? sugg.suggestions.map((s) => `${s.chargeKey}:${s.preselected}`).join(",")
      : "",
  );

  const toggled = await upsertChargeDefault(
    form({ productTypeValue: T_RULES, chargeKey: "tooling", preselected: "on" }),
  );
  check("preselection is editable", toggled.ok);
  const after = await resolutionFor(T_RULES);
  check(
    "and the edit updates in place rather than duplicating the rule",
    after?.kind === "suggestions" && after.suggestions.length === 2,
    after?.kind === "suggestions" ? `${after.suggestions.length} rule(s)` : "",
  );

  const bogus = await upsertChargeDefault(
    form({ productTypeValue: T_RULES, chargeKey: "run_setup" }),
  );
  check(
    "a charge outside the governed registry is refused",
    !bogus.ok && bogus.error.code === "VALIDATION_ERROR",
    bogus.ok ? "accepted" : bogus.error.code,
  );

  // The refusal that keeps a review from deleting somebody's work.
  const refused = await setNoneExpected(form({ productTypeValue: T_RULES }));
  check(
    "`none expected` is REFUSED while rules exist",
    !refused.ok && refused.error.code === "VALIDATION_ERROR",
    refused.ok ? "accepted" : refused.error.code,
  );
  const stillThere = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_defaults where product_type_value = ${T_RULES}
    `
  )[0].n;
  check("and it discarded nothing on the way", stillThere === 2, `${stillThere} rule(s)`);
  check(
    "the refusal names what has to happen first",
    !refused.ok && /remove/i.test(refused.error.message),
    refused.ok ? "" : refused.error.message.slice(0, 80),
  );

  // ═══ 3 · removing the last rule is a contradiction, not an answer ═════
  console.log("\n── the last rule, and what removing it means ──────────────");

  await removeChargeDefault(form({ productTypeValue: T_RULES, chargeKey: "print_plates" }));
  const oneLeft = await resolutionFor(T_RULES);
  check("removing one leaves the rest", oneLeft?.kind === "suggestions");

  const last = await removeChargeDefault(
    form({ productTypeValue: T_RULES, chargeKey: "tooling" }),
  );
  check("the last rule can be removed", last.ok && last.data.remaining === 0,
    last.ok ? `${last.data.remaining} remaining` : "");
  const empty = await resolutionFor(T_RULES);
  check(
    "and the result is reported as a CONTRADICTION, not invented as `none expected`",
    empty?.kind === "contradiction",
    String(empty?.kind),
  );

  const missing = await removeChargeDefault(
    form({ productTypeValue: T_RULES, chargeKey: "tooling" }),
  );
  check("removing a rule that is not there is refused",
    !missing.ok && missing.error.code === "NOT_FOUND",
    missing.ok ? "accepted" : missing.error.code);

  // Recovery from that state, through the action an admin actually has.
  const recovered = await setNoneExpected(form({ productTypeValue: T_RULES }));
  check("with no rules left, `none expected` is now accepted", recovered.ok);
  check("and the contradiction is gone",
    (await resolutionFor(T_RULES))?.kind === "none_expected");

  // ═══ 4 · the two empty states are not the same sentence ══════════════
  console.log("\n── `none expected` is not `needs review` ──────────────────");

  const reviewedEmpty = await resolutionFor(T_RULES);
  const unreviewed = await resolutionFor("Design"); // never touched
  check("an unreviewed type has no profile", unreviewed === null);
  check("a reviewed-none type does", reviewedEmpty?.kind === "none_expected");
  const sentenceReviewed = reviewedEmpty ? describeEmptyResolution(reviewedEmpty) : null;
  const sentenceUnreviewed = describeEmptyResolution({
    kind: "needs_review",
    productTypeValue: "Design",
  });
  check(
    "and an operator is told different things",
    sentenceReviewed !== sentenceUnreviewed && !!sentenceReviewed && !!sentenceUnreviewed,
    `${sentenceUnreviewed} / ${sentenceReviewed}`,
  );
  check(
    "only ONE of them claims somebody decided",
    /Reviewed/.test(sentenceReviewed ?? "") && !/Reviewed/.test(sentenceUnreviewed ?? ""),
  );

  // ═══ 5 · a contradiction that was stored, not produced here ═══════════
  console.log("\n── stored contradictory state ─────────────────────────────");

  // Written around the actions ON PURPOSE. The database cannot hold this
  // invariant, and this is what that permits — so the read path is tested
  // against a state the write path would never produce.
  const [adminUser] = await sql<{ id: string }[]>`
    select id from users where clerk_user_id = 'validation_clerk_admin' limit 1
  `;
  await sql`
    insert into product_type_charge_profile
      (product_type_value, verdict, reviewed_by_user_id, updated_by_user_id)
    values (${T_BAD}, 'none_expected', ${adminUser.id}, ${adminUser.id})
  `;
  await sql`
    insert into product_type_charge_defaults (product_type_value, charge_key, preselected)
    values (${T_BAD}, 'samples', false)
  `;
  check(
    "the database ACCEPTS the contradiction — which is why the layer above must not",
    (
      await sql<{ n: number }[]>`
        select count(*)::int n from product_type_charge_defaults where product_type_value = ${T_BAD}
      `
    )[0].n === 1,
  );

  const bad = await resolutionFor(T_BAD);
  check("the read reports it as a contradiction", bad?.kind === "contradiction",
    String(bad?.kind));
  check(
    "naming which side is inconsistent, not just that something is",
    bad?.kind === "contradiction" && /none_expected/.test(bad.detail),
    bad?.kind === "contradiction" ? bad.detail : "",
  );

  const badNone = await setNoneExpected(form({ productTypeValue: T_BAD }));
  check("re-recording `none expected` over it is refused", !badNone.ok,
    badNone.ok ? "accepted" : badNone.error.code);

  const badRemove = await removeChargeDefault(
    form({ productTypeValue: T_BAD, chargeKey: "samples" }),
  );
  check("and the admin can resolve it by removing the rule", badRemove.ok);
  check("which leaves a consistent `none expected`",
    (await resolutionFor(T_BAD))?.kind === "none_expected");

  // ═══ 6 · a non-admin writes nothing ═══════════════════════════════════
  console.log("\n── a non-admin is refused, and changes nothing ────────────");

  const sigBefore = await stateSignature();
  const auditBefore = (await sql<{ n: number }[]>`select count(*)::int n from audit_log`)[0].n;

  process.env.NEXUS_VALIDATION_IDENTITY = "pm";
  const asPm = {
    setNoneExpected: await setNoneExpected(form({ productTypeValue: "Design" })),
    upsert: await upsertChargeDefault(
      form({ productTypeValue: T_RULES, chargeKey: "samples", preselected: "on" }),
    ),
    remove: await removeChargeDefault(form({ productTypeValue: T_BAD, chargeKey: "samples" })),
    clear: await clearChargeProfile(form({ productTypeValue: T_BAD })),
    list: await listChargeDefaults(),
  };
  process.env.NEXUS_VALIDATION_IDENTITY = "admin";

  for (const [name, r] of Object.entries(asPm)) {
    check(
      `a PM is refused by ${name}`,
      !r.ok && r.error.code === "FORBIDDEN",
      r.ok ? "ACCEPTED" : r.error.code,
    );
  }
  const sigAfter = await stateSignature();
  const auditAfter = (await sql<{ n: number }[]>`select count(*)::int n from audit_log`)[0].n;
  check("and NOTHING was written", sigAfter === sigBefore, sigAfter === sigBefore ? "" : sigAfter);
  check("not even an audit row", auditAfter === auditBefore, `${auditBefore} → ${auditAfter}`);

  // ═══ 7 · an audit failure takes the data with it ══════════════════════
  console.log("\n── audit failure rolls the state change back ──────────────");

  await sql`delete from product_type_charge_defaults where product_type_value = ${T_RACE}`;
  await sql`delete from product_type_charge_profile where product_type_value = ${T_RACE}`;

  await sql.unsafe(`
    create or replace function validation_reject_charge_audit() returns trigger as $$
    begin
      if new.action like 'product_type_charge%' then
        raise exception 'validation: audit rejected';
      end if;
      return new;
    end $$ language plpgsql;
    create trigger validation_reject_charge_audit
      before insert on audit_log
      for each row execute function validation_reject_charge_audit();
  `);

  let threw = false;
  try {
    const r = await setNoneExpected(form({ productTypeValue: T_RACE }));
    threw = !r.ok;
  } catch {
    threw = true;
  }
  check("the action does not report success when its audit fails", threw);

  const afterFailure = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_profile where product_type_value = ${T_RACE}
    `
  )[0].n;
  check(
    "and the profile it would have written is ABSENT — the state rolled back with the audit",
    afterFailure === 0,
    `${afterFailure} row(s)`,
  );

  // The same for the rule table, where the write is a different shape.
  let threw2 = false;
  try {
    const r = await upsertChargeDefault(
      form({ productTypeValue: T_RACE, chargeKey: "tooling" }),
    );
    threw2 = !r.ok;
  } catch {
    threw2 = true;
  }
  check("a rule write fails the same way", threw2);
  const ruleAfter = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_defaults where product_type_value = ${T_RACE}
    `
  )[0].n;
  const profAfter = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_profile where product_type_value = ${T_RACE}
    `
  )[0].n;
  check("leaving neither the rule nor the profile it would have created",
    ruleAfter === 0 && profAfter === 0, `${profAfter} profile, ${ruleAfter} rule`);

  await sql.unsafe(`
    drop trigger if exists validation_reject_charge_audit on audit_log;
    drop function if exists validation_reject_charge_audit();
  `);

  // Proof the trigger is gone, so a later PASS is not the trigger still firing.
  const recheck = await setNoneExpected(form({ productTypeValue: T_RACE }));
  check("with the audit working again, the same call succeeds", recheck.ok,
    recheck.ok ? "" : recheck.error.message.slice(0, 80));
  await clearChargeProfile(form({ productTypeValue: T_RACE }));

  // ═══ 8 · concurrency ═════════════════════════════════════════════════
  console.log("\n── two admins on the same product type ────────────────────");

  // ── 8a · the hazard is REAL. The same statements, minus the lock.
  await sql`delete from product_type_charge_defaults where product_type_value = ${T_RACE}`;
  await sql`delete from product_type_charge_profile where product_type_value = ${T_RACE}`;

  const unlockedA = sql.begin(async (tx) => {
    // "setNoneExpected" without the lock: read first…
    const rules = await tx`
      select id from product_type_charge_defaults where product_type_value = ${T_RACE}
    `;
    await new Promise((r) => setTimeout(r, 250)); // …the window the lock removes
    if (rules.length === 0) {
      await tx`
        insert into product_type_charge_profile
          (product_type_value, verdict, reviewed_by_user_id, updated_by_user_id)
        values (${T_RACE}, 'none_expected', ${adminUser.id}, ${adminUser.id})
        on conflict (product_type_value) do update set verdict = 'none_expected'
      `;
    }
  });
  const unlockedB = (async () => {
    await new Promise((r) => setTimeout(r, 60));
    await sql.begin(async (tx) => {
      await tx`
        insert into product_type_charge_profile
          (product_type_value, verdict, reviewed_by_user_id, updated_by_user_id)
        values (${T_RACE}, 'defaults', ${adminUser.id}, ${adminUser.id})
        on conflict (product_type_value) do update set verdict = 'defaults'
      `;
      await tx`
        insert into product_type_charge_defaults (product_type_value, charge_key)
        values (${T_RACE}, 'tooling')
        on conflict do nothing
      `;
    });
  })();
  await Promise.all([unlockedA, unlockedB]);

  const raced = await resolutionFor(T_RACE);
  check(
    "CONTROL: the same check-then-write WITHOUT the lock produces the contradiction",
    raced?.kind === "contradiction",
    `got ${raced?.kind} — if this is not a contradiction the lock is being credited for nothing`,
  );

  // ── 8b · the real action WAITS on the lock. Deterministic.
  await purge();
  const [{ k }] = await lockKey(T_RACE);
  const holder = postgres(url, { max: 1, prepare: false });
  await holder`select pg_advisory_lock(${k}::bigint)`;

  let settled = false;
  const blocked = setNoneExpected(form({ productTypeValue: T_RACE })).then((r) => {
    settled = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 900));
  const stayedBlocked = !settled;
  const wrotePrematurely = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_profile where product_type_value = ${T_RACE}
    `
  )[0].n;
  check("the real action BLOCKS while another holds the lock for that type",
    stayedBlocked, stayedBlocked ? "" : "it completed anyway");
  check("and had written nothing while blocked", wrotePrematurely === 0,
    `${wrotePrematurely} row(s)`);

  await holder`select pg_advisory_unlock(${k}::bigint)`;
  const unblocked = await blocked;
  check("and completes once the lock is released", unblocked.ok,
    unblocked.ok ? "" : unblocked.error.message.slice(0, 80));

  // A DIFFERENT type must not queue behind it — the lock is per type.
  await holder`select pg_advisory_lock(${k}::bigint)`;
  const otherStart = Date.now();
  const other = await setNoneExpected(form({ productTypeValue: "Design" }));
  const otherMs = Date.now() - otherStart;
  check("a different product type is NOT blocked by it", other.ok && otherMs < 900,
    `${otherMs}ms`);
  await holder`select pg_advisory_unlock(${k}::bigint)`;
  await holder.end();
  await clearChargeProfile(form({ productTypeValue: "Design" }));

  // ── 8c · competing verdict and rule changes, repeatedly.
  let contradictions = 0;
  let inconsistentRows = 0;
  const ROUNDS = 25;
  for (let i = 0; i < ROUNDS; i++) {
    await sql`delete from product_type_charge_defaults where product_type_value = ${T_RACE}`;
    await sql`delete from product_type_charge_profile where product_type_value = ${T_RACE}`;

    // Admin one records "none expected". Admin two adds a rule. Whichever
    // order they land in, the END STATE has to be one of the three answers.
    await Promise.all([
      setNoneExpected(form({ productTypeValue: T_RACE })),
      upsertChargeDefault(form({ productTypeValue: T_RACE, chargeKey: "tooling" })),
    ]);

    const r = await resolutionFor(T_RACE);
    if (r?.kind === "contradiction") contradictions++;

    const rows = await sql<{ verdict: string; n: number }[]>`
      select p.verdict, count(d.id)::int n
        from product_type_charge_profile p
        left join product_type_charge_defaults d using (product_type_value)
       where p.product_type_value = ${T_RACE}
       group by p.verdict
    `;
    const row = rows[0];
    if (!row) inconsistentRows++;
    else if (row.verdict === "none_expected" && row.n > 0) inconsistentRows++;
    else if (row.verdict === "defaults" && row.n === 0) inconsistentRows++;
  }
  check(
    `${ROUNDS} competing verdict/rule pairs left no contradiction`,
    contradictions === 0,
    `${contradictions} contradiction(s)`,
  );
  check(
    "and the stored rows are consistent every time",
    inconsistentRows === 0,
    `${inconsistentRows} inconsistent end state(s)`,
  );

  // Two writers of the SAME rule, which the unique index also has an opinion
  // about — the lock must not turn that into a failure.
  await sql`delete from product_type_charge_defaults where product_type_value = ${T_RACE}`;
  await sql`delete from product_type_charge_profile where product_type_value = ${T_RACE}`;
  const both = await Promise.all([
    upsertChargeDefault(form({ productTypeValue: T_RACE, chargeKey: "samples", preselected: "on" })),
    upsertChargeDefault(form({ productTypeValue: T_RACE, chargeKey: "samples" })),
  ]);
  check("two admins writing the same rule both succeed", both.every((r) => r.ok),
    both.map((r) => (r.ok ? "ok" : r.error.code)).join(","));
  const dupes = (
    await sql<{ n: number }[]>`
      select count(*)::int n from product_type_charge_defaults
       where product_type_value = ${T_RACE} and charge_key = 'samples'
    `
  )[0].n;
  check("leaving exactly one rule, not two answers to one question", dupes === 1,
    `${dupes} row(s)`);

  // Competing REMOVE and ADD on the same rule.
  const mixed = await Promise.all([
    removeChargeDefault(form({ productTypeValue: T_RACE, chargeKey: "samples" })),
    upsertChargeDefault(form({ productTypeValue: T_RACE, chargeKey: "samples", preselected: "on" })),
  ]);
  const final = await resolutionFor(T_RACE);
  check(
    "a concurrent remove and add leaves a state the resolver can name",
    final?.kind === "suggestions" || final?.kind === "contradiction",
    `${final?.kind} (${mixed.map((r) => (r.ok ? "ok" : r.error.code)).join(",")})`,
  );
  // Either order is legitimate; what must NOT happen is a rule surviving with
  // no verdict, or a verdict claiming rules that are gone without saying so.
  check(
    "and it is reported, never silently preferred",
    final !== null,
    String(final?.kind),
  );

  // ═══ 9 · the audit trail as a whole ══════════════════════════════════
  console.log("\n── what the audit log has to say afterwards ───────────────");
  const auditAtEnd = await auditBaseline();
  const grew = [...auditAtEnd].filter(
    ([a, n]) => n > (auditAtStart.get(a) ?? 0),
  );
  check(
    "all four governed writes left audit rows IN THIS RUN",
    grew.length === 4,
    grew.map(([a, n]) => `${a}+${n - (auditAtStart.get(a) ?? 0)}`).join(" "),
  );
  const anon = (
    await sql<{ n: number }[]>`
      select count(*)::int n from audit_log
       where action like 'product_type_charge%' and (user_id is null or actor_display_name is null)
    `
  )[0].n;
  check("and none of them is anonymous", anon === 0, `${anon} anonymous row(s)`);
} finally {
  await purge();
  await sql.unsafe(`
    drop trigger if exists validation_reject_charge_audit on audit_log;
    drop function if exists validation_reject_charge_audit();
  `);
  await sql.end();
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);

/**
 * Gate 1A backfill — preflight. READ ONLY. Writes nothing.
 *
 * The execution precondition is that every historical actor still resolves. If
 * any does not, the backfill must stop rather than turn an unknown historical
 * person into an inferred identity — a fallback string in that position would
 * assert "a person was reached and their name was never recorded", when what
 * actually happened is that we no longer know who acted. Those are different
 * facts and the trace must not conflate them.
 *
 * Reports, in order:
 *   1. total rows, and how many carry a human actor at all
 *   2. rows whose user_id no longer resolves          — must be zero
 *   3. rows with no user_id at all                    — machine-authored
 *   4. resolvable actors whose name is blank          — fallback candidates
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const one = async <T>(q: ReturnType<typeof sql>): Promise<T> =>
  ((await db.execute(q)) as unknown as T[])[0];
const all = async <T>(q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)) as unknown as T[];

const totals = await one<{
  rows: string;
  with_actor: string;
  without_actor: string;
  already: string;
}>(sql`
  select count(*)::text                                          as rows,
         count(*) filter (where user_id is not null)::text        as with_actor,
         count(*) filter (where user_id is null)::text            as without_actor,
         count(*) filter (where actor_user_id is not null)::text  as already
    from audit_log
`);

console.log("\nGate 1A backfill preflight — read only\n");
console.log(`  total rows                       ${totals.rows}`);
console.log(`  with a human actor (user_id)     ${totals.with_actor}`);
console.log(`  no user_id — machine-authored    ${totals.without_actor}`);
console.log(`  already carrying actor_user_id   ${totals.already}`);

const unresolved = await all<{ user_id: string; rows: string }>(sql`
  select a.user_id::text as user_id, count(*)::text as rows
    from audit_log a
    left join users u on u.id = a.user_id
   where a.user_id is not null and u.id is null
   group by 1
   order by 2 desc
`);

console.log(
  `\n  unresolved actor references      ${unresolved.length === 0 ? "0  — precondition met" : unresolved.length}`,
);
if (unresolved.length > 0) {
  console.log("\n  STOP. These actors no longer resolve:\n");
  for (const r of unresolved) console.log(`    ${r.user_id}  ${r.rows} row(s)`);
  console.log(
    "\n  A fallback here would assert a person was reached whose name was never\n" +
      "  recorded. What actually happened is that we no longer know who acted.\n" +
      "  Report rather than infer.\n",
  );
}

const actors = await all<{
  id: string;
  name: string | null;
  email: string | null;
  rows: string;
}>(sql`
  select u.id::text as id, u.name, u.email, count(a.id)::text as rows
    from users u
    join audit_log a on a.user_id = u.id
   group by 1, 2, 3
   order by count(a.id) desc
`);

console.log("\n  actors present in history:\n");
for (const a of actors) {
  const named = (a.name ?? "").trim() !== "";
  console.log(
    `    ${String(a.rows).padStart(5)}  ${named ? a.name : "(no name recorded)"}` +
      `${named ? "" : `  <${a.email ?? "no email"}>  id ${a.id.slice(0, 8)}`}`,
  );
}

const blank = actors.filter((a) => (a.name ?? "").trim() === "");
if (blank.length > 0) {
  console.log(
    `\n  ${blank.length} resolvable actor(s) with no recorded name.\n` +
      "  These are backfillable — the person is known, the name simply was never\n" +
      "  entered. They would receive the same never-empty fallback runtime writes\n" +
      "  use. Fixing the user record first is the better order: the snapshot is\n" +
      "  taken at write time by design, so later profile cleanup will NOT rewrite\n" +
      "  history already backfilled.\n",
  );
}

// ---------------------------------------------------------------------------
// 0062 preconditions — what the RESTRICTIVE migration additionally requires.
//
// Between 0061 and the deploy, production keeps writing rows through the old
// code with none of the three columns set. Those rows are backfillable (0062
// re-runs the backfill), but a row with NO user_id would not be: after the
// fact there is no way to tell an unattended act from a lost actor. None exist
// today; if one appears it must be classified explicitly, not guessed.
// ---------------------------------------------------------------------------

const enforcement = await one<{
  unclassified: string;
  no_display: string;
  shape_violations: string;
  unclassifiable: string;
}>(sql`
  select count(*) filter (where actor_kind is null)::text                        as unclassified,
         count(*) filter (where actor_display_name is null
                             or btrim(actor_display_name) = '')::text            as no_display,
         count(*) filter (where actor_kind is not null and not (
                            (actor_kind = 'human'  and actor_user_id is not null) or
                            (actor_kind = 'system' and actor_user_id is null)))::text as shape_violations,
         count(*) filter (where user_id is null and actor_kind is null)::text    as unclassifiable
    from audit_log
`);

console.log("\n  0062 (enforcement) preconditions:\n");
console.log(`    rows with no actor_kind          ${enforcement.unclassified}  (0062 backfills these)`);
console.log(`    rows with no display name        ${enforcement.no_display}  (0062 backfills these)`);
console.log(`    rows violating the actor shape   ${enforcement.shape_violations}  (must be 0)`);
console.log(`    UNCLASSIFIABLE (no user_id, no kind)  ${enforcement.unclassifiable}  (must be 0)`);

const enforcementBlocked =
  enforcement.shape_violations !== "0" || enforcement.unclassifiable !== "0";

console.log(
  unresolved.length === 0
    ? "\nBACKFILL PRECONDITION MET — every historical actor still resolves."
    : "\nBACKFILL PRECONDITION FAILED — do not run the backfill.",
);
console.log(
  enforcementBlocked
    ? "ENFORCEMENT PRECONDITION FAILED — 0062 would abort. Classify the rows explicitly.\n"
    : "ENFORCEMENT PRECONDITION MET — 0062 can be applied once the code is deployed.\n",
);
process.exit(unresolved.length === 0 && !enforcementBlocked ? 0 : 1);

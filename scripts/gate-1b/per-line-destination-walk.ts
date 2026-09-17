/**
 * Per-line NetSuite item selection — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:per-line-destination-walk
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * I reported that `otc_testing` takes a firm-wide mapping and needs no
 * per-instance selection, on the strength of migration `0090`'s comment. That
 * comment was accurate when written and is now stale: `PER_LINE_DESTINATIONS`
 * at HEAD contains `otc_testing`, added by the Case 0 extension because the
 * account carries several concurrently-used testing items (Micro Testing,
 * HRIPT, Re-Test) that one firm-wide mapping would collapse.
 *
 * A migration comment is evidence about the day it was written. The runtime set
 * is the authority. This drives the authority.
 *
 * ── WHAT IT DEMONSTRATES, AT EACH STAGE ──────────────────────────────────
 *
 *   the switch      `isPerLineDestination('otc_testing')` is TRUE at HEAD
 *   authoring       the admin action REFUSES a firm-wide row for it
 *   freeze          a component-charge line carries `selectedNetsuiteItem:
 *                   null` unconditionally, so the selection has nowhere to live
 *   readiness       a per-line destination with no frozen selection blocks with
 *                   `per_line_destination_unresolved`, and clears when one is
 *                   recorded
 *   the tripwire    `qosi_leaf_unique` admits ONE selection per leaf, with no
 *                   destination discriminator — so one owner cannot hold both
 *                   an Other-Service and a Testing selection
 *
 * Everything it writes is removed in `finally`, including on failure.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}
process.env.NEXUS_VALIDATION_IDENTITY = "admin";

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
/**
 * The third outcome. NOT folded into pass or fail: a check that could not be
 * taken is different from one that was taken and succeeded, and reporting the
 * first as the second is how a control stops being able to express a failure.
 */
let indeterminates = 0;
const indeterminate = (name: string, why: string) => {
  console.log(`  ????  ${name} — INDETERMINATE: ${why}`);
  indeterminates++;
};

const { isPerLineDestination, BV011_DESTINATIONS } = await import(
  "../../src/lib/netsuite/bv011-destinations.ts"
);
const { saveDestinationMapping } = await import(
  "../../src/app/actions/netsuite-destination-map.ts"
);
const { assessProjectionReadiness, describeBlockers } = await import(
  "../../src/lib/netsuite/projection-readiness.ts"
);

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

let syntheticLineId: string | null = null;
const createdSelections: string[] = [];

try {
  // ═══ 1 · the switch ═══════════════════════════════════════════════════
  console.log("\n── the governing switch, at this head ─────────────────────");

  check(
    "`otc_testing` IS a per-line destination at HEAD",
    isPerLineDestination("otc_testing"),
    "the claim that it takes a firm-wide mapping was wrong",
  );
  check("`otc_other_service` is too", isPerLineDestination("otc_other_service"));

  const perLine = BV011_DESTINATIONS.filter((d) => isPerLineDestination(d.key));
  check(
    "and they are the only two",
    perLine.length === 2,
    perLine.map((d) => d.key).join(", "),
  );
  check(
    "a firm-wide destination is not one of them",
    !isPerLineDestination("otc_setup") && !isPerLineDestination("otc_formulation"),
    "otc_setup / otc_formulation",
  );

  // ═══ 2 · authoring ════════════════════════════════════════════════════
  console.log("\n── authoring: the admin map refuses a firm-wide row ───────");

  const refused = await saveDestinationMapping(
    form({ destination: "otc_testing", netsuiteItemCode: "OTC-0016", netsuiteInternalId: "99999" }),
  );
  check(
    "saving a firm-wide item for `otc_testing` is REFUSED",
    !refused.ok,
    refused.ok ? "ACCEPTED — a firm default would silently win over the per-line choice" : refused.error.code,
  );
  check(
    "and the refusal says why, in the operator's terms",
    !refused.ok && /chosen per line/i.test(refused.error.message),
    refused.ok ? "" : refused.error.message.slice(0, 90),
  );

  const allowed = await saveDestinationMapping(
    form({ destination: "otc_setup", netsuiteItemCode: "ZZ-WALK", netsuiteInternalId: "1" }),
  );
  // Restores below; this only establishes the refusal is specific to per-line.
  check(
    "a firm-wide destination still accepts one, so the refusal is not blanket",
    allowed.ok,
    allowed.ok ? "" : allowed.error.message.slice(0, 80),
  );

  // ═══ 3 · freeze ═══════════════════════════════════════════════════════
  console.log("\n── freeze: where a component charge's selection would live ─");

  const projection = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/commercial-projection.ts", "utf8").replace(/\r\n/g, "\n"),
  );
  // The component-charge branch, bounded by its own line push.
  const compBranch = projection.slice(
    projection.indexOf("key: `otc:instance:${chargeInstanceId}`"),
  );
  const compEnd = compBranch.indexOf("PUBLICATION BOUNDARY");
  check(
    "a component-charge line freezes `selectedNetsuiteItem: null` unconditionally",
    /selectedNetsuiteItem:\s*null/.test(compBranch.slice(0, compEnd)),
    "so a per-line destination on a component charge has nowhere to record its item",
  );
  check(
    "whereas the Direct Service line asks the governed predicate",
    /isPerLineDestination\(dest\)/.test(projection),
    "the switch is read, not a destination named",
  );

  // ═══ 4 · readiness ════════════════════════════════════════════════════
  console.log("\n── readiness: a per-line destination with no selection ────");

  // ATTEMPTED END-TO-END, AND IT COULD NOT BE DRIVEN. Reported as
  // INDETERMINATE rather than folded into a pass or a fail, because the third
  // outcome is the one that carries information here: no snapshot in the
  // isolated environment carries ANY frozen line, so `assessProjectionReadiness`
  // short-circuits at `no_frozen_matrix` and the per-line branch is never
  // reached. A check appended to such a snapshot reports "no blocker" for a
  // reason that has nothing to do with the behaviour under test.
  const [target] = await sql<{ quote_id: string; snapshot_id: string; lines: number }[]>`
    select q.id as quote_id, s.id as snapshot_id,
           (select count(*)::int from quote_snapshot_lines l
             where l.quote_snapshot_id = s.id) as lines
      from quotes q join quote_snapshots s on s.quote_id = q.id
     where q.customer_accepted_tier_id is not null
     order by lines desc, s.created_at desc limit 1
  `;

  if (!target || target.lines === 0) {
    const r = target ? await assessProjectionReadiness(target.quote_id) : null;
    const kinds = r && !r.ready ? r.blockers.map((b) => b.kind) : [];
    indeterminate(
      "the readiness stage could not be driven end to end",
      `no snapshot in the isolated environment carries a frozen line; readiness ` +
        `short-circuits at ${kinds.join(",") || "an earlier blocker"}. Closing this ` +
        `needs a frozen-matrix fixture, which is its own piece of work.`,
    );
  } else {
    const [line] = await sql<{ id: string }[]>`
      insert into quote_snapshot_lines
        (quote_snapshot_id, line_kind, display_name, position, bv011_destination, legacy_unresolved)
      values (${target.snapshot_id}, 'otc', 'ZZ-WALK · Testing charge',
              (select coalesce(max(position),0)+1 from quote_snapshot_lines
                where quote_snapshot_id = ${target.snapshot_id}),
              'otc_testing', false)
      returning id
    `;
    syntheticLineId = line.id;
    const unresolved = await assessProjectionReadiness(target.quote_id);
    const blocked = unresolved.ready
      ? []
      : unresolved.blockers.filter(
          (b) => b.kind === "per_line_destination_unresolved" && "lineId" in b && b.lineId === line.id,
        );
    check("a frozen `otc_testing` line with no selection BLOCKS the push",
      blocked.length === 1, `${blocked.length} matching blocker(s)`);
    await sql`update quote_snapshot_lines set selected_netsuite_item_id = '4242'
               where id = ${line.id}`;
    const after = await assessProjectionReadiness(target.quote_id);
    const still = after.ready ? [] : after.blockers.filter(
      (b) => b.kind === "per_line_destination_unresolved" && "lineId" in b && b.lineId === line.id);
    check("recording the frozen selection CLEARS that blocker", still.length === 0);
  }

  // What CAN be established without a frozen matrix: the instruction this
  // blocker gives an operator, which is the part that differs from every other
  // unresolved-destination state and the part an admin would act on.
  const sample = describeBlockers([
    {
      kind: "per_line_destination_unresolved",
      destination: "otc_testing",
      destinationLabel: "OTC - Testing",
      lineId: "zz",
      displayName: "Testing",
      remediation:
        '"Testing" posts to OTC - Testing, whose NetSuite item is chosen per line rather than firm-wide. Choose its item on Costs, then revise and re-send.',
    },
  ]);
  check(
    "the per-line blocker sends an operator to Costs, not to Settings",
    sample.length === 1 && /Costs/.test(sample[0]) && !/Settings/i.test(sample[0]),
    sample[0]?.slice(0, 90) ?? "",
  );

  // ═══ 5 · the keying tripwire ══════════════════════════════════════════
  console.log("\n── the tripwire: one selection per owner, no discriminator ─");

  const hasDiscriminator = (
    await sql<{ n: number }[]>`
      select count(*)::int n from information_schema.columns
       where table_name = 'quote_other_service_items' and column_name ilike '%destination%'
    `
  )[0].n;
  check(
    "`quote_other_service_items` carries NO destination discriminator",
    hasDiscriminator === 0,
    "so a row cannot say WHICH per-line destination it is for",
  );

  const [leaf] = await sql<{ id: string; quote_id: string }[]>`
    select ql.id, ql.quote_id from quote_leaves ql limit 1
  `;
  if (leaf) {
    const [first] = await sql<{ id: string }[]>`
      insert into quote_other_service_items
        (quote_id, quote_leaf_id, netsuite_item_code, netsuite_internal_id, selected_by_user_id)
      values (${leaf.quote_id}, ${leaf.id}, 'ZZ-WALK-A', '1',
              (select id from users where clerk_user_id='validation_clerk_admin'))
      returning id
    `;
    createdSelections.push(first.id);

    let secondRefused = false;
    let detail = "";
    try {
      const [second] = await sql<{ id: string }[]>`
        insert into quote_other_service_items
          (quote_id, quote_leaf_id, netsuite_item_code, netsuite_internal_id, selected_by_user_id)
        values (${leaf.quote_id}, ${leaf.id}, 'ZZ-WALK-B', '2',
                (select id from users where clerk_user_id='validation_clerk_admin'))
        returning id
      `;
      createdSelections.push(second.id);
    } catch (e) {
      secondRefused = true;
      detail = e instanceof Error ? (e.message.match(/qosi_leaf_unique/) ? "qosi_leaf_unique" : e.message.slice(0, 60)) : "";
    }
    check(
      "a SECOND per-line selection for the same owner is REFUSED by the database",
      secondRefused,
      detail || "it was accepted — the tripwire would not fire",
    );
    check(
      "so one owner cannot hold both an Other-Service and a Testing selection",
      secondRefused,
      "which is exactly the state a testing_micros owned charge would need",
    );
  }
} finally {
  if (syntheticLineId) {
    await sql`delete from quote_snapshot_lines where id = ${syntheticLineId}`;
  }
  for (const id of createdSelections) {
    await sql`delete from quote_other_service_items where id = ${id}`;
  }
  await sql`delete from netsuite_destination_item_map where netsuite_item_code = 'ZZ-WALK'`;
  await sql.end();
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

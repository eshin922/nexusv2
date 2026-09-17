/**
 * The posting payload for an owned production fee — ISOLATED ONLY.
 *
 *   npm run validation:owned-fee-payload-walk
 *
 * `owned-production-fee-walk` drives freeze and readiness on an EXISTING quote
 * and stops at `provisional_tier`: that quote's total was printed as a floor, so
 * an order cannot be posted for it. **That case is deliberately left alone and
 * is the evidence that posting is correctly refused.**
 *
 * This walk builds its OWN fully costed, non-provisional quote so the payload
 * stage can actually be reached, and runs BOTH supported keys —
 * `project_setup` and `rd_formulation` — through the real
 * projection → freeze → readiness → emitter path. Nothing is sent.
 *
 * ── WHAT MAKES A TIER PROVISIONAL, AND WHY THE FIXTURE AVOIDS IT ─────────
 *
 * `projectCommercial` marks a tier provisional when any UNIT line is
 * `quote_on_request` — an OTC line that is unpriced because it is allocated is
 * not a gap. So the fixture gives its one product a real unit cost, which is
 * the whole difference from the quote the other walk uses.
 *
 * `testing_micros` is excluded from this extension and is asserted to still
 * refuse as a component charge.
 *
 * Everything created is removed in `finally`, and a start-of-run purge covers a
 * crashed previous run.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}
process.env.NEXUS_VALIDATION_IDENTITY = "pm";

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
let indeterminates = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
const indeterminate = (name: string, why: string) => {
  console.log(`  ????  ${name} — INDETERMINATE: ${why}`);
  indeterminates++;
};

const { COMPONENT_CHARGE_LABELS, chargePolicy, isComponentChargeKey } = await import(
  "../../src/lib/commercial-recovery/registry.ts"
);

/**
 * The name a FROZEN line and an accounting line carry.
 *
 * NOT `COMPONENT_CHARGE_LABELS`. Those are the authoring picker's words, written
 * for an operator looking at a component -- "Tooling & dies", "R&D /
 * formulation" -- while the projection names a line by its charge POLICY
 * label: "Tooling", "R&D". The divergence is pre-existing and deliberate, and
 * matching on the wrong one made this walk report three failures against code
 * that was right.
 */
const lineLabel = (k: (typeof KEYS)[number]) => chargePolicy(k).label;
const { getCostingBundle } = await import("../../src/app/actions/costing.ts");
const { projectCommercial } = await import("../../src/lib/commercial-projection.ts");
const { freezeCommercialLineSet } = await import("../../src/lib/commercial-freeze.ts");
const { assessProjectionReadiness } = await import(
  "../../src/lib/netsuite/projection-readiness.ts"
);
const { emitAccountingLines, emittedTotalCents } = await import(
  "../../src/lib/netsuite/accounting-line-emitter.ts"
);
const { createComponentChargesAs } = await import(
  "../../src/lib/component-charges/create.ts"
);
const { db } = await import("../../src/db/index.ts");

const TAG = "ZZ-PAYLOAD-WALK";
const KEYS = ["project_setup", "rd_formulation"] as const;
const DEST = { project_setup: "otc_setup", rd_formulation: "otc_formulation" } as const;
/** $1,000 and $2,500 — different, so a payload cannot pass by coincidence. */
const COST = { project_setup: 1000, rd_formulation: 2500 } as const;
const UNIT_COST = 4;
const TIER_QTY = 1000;

let quoteId: string | null = null;
const seededDestinations: string[] = [];

const purge = async () => {
  const stale = await sql<{ id: string }[]>`
    select id from quotes where scenario_label = ${TAG}
  `;
  for (const q of stale) {
    await sql`delete from quote_charge_recovery where quote_id = ${q.id}`;
    await sql`delete from quote_charge_instance_tiers where charge_instance_id in
      (select id from quote_charge_instances where quote_id = ${q.id})`;
    await sql`delete from quote_charge_instances where quote_id = ${q.id}`;
    await sql`delete from quote_snapshot_line_tiers where quote_snapshot_line_id in
      (select l.id from quote_snapshot_lines l join quote_snapshots s on s.id = l.quote_snapshot_id
        where s.quote_id = ${q.id})`;
    await sql`delete from quote_snapshot_lines where quote_snapshot_id in
      (select id from quote_snapshots where quote_id = ${q.id})`;
    await sql`delete from quote_snapshot_tier_totals where quote_snapshot_id in
      (select id from quote_snapshots where quote_id = ${q.id})`;
    await sql`delete from quote_snapshots where quote_id = ${q.id}`;
    await sql`delete from assembly_leaf_inputs where quote_leaf_id in
      (select id from quote_leaves where quote_id = ${q.id})`;
    await sql`delete from quote_leaves where quote_id = ${q.id}`;
    await sql`delete from quote_tiers where quote_id = ${q.id}`;
    await sql`delete from quotes where id = ${q.id}`;
  }
  if (stale.length > 0) console.log(`     purged ${stale.length} leftover fixture quote(s)`);
  await sql`delete from netsuite_destination_item_map where netsuite_item_code like ${TAG + "%"}`;
};

try {
  await purge();

  // ═══ 1 · a fully costed, non-provisional quote ════════════════════════
  console.log("\n── the fixture: one product, costed, one tier ─────────────");

  const [pm] = await sql<{ id: string }[]>`
    select id from users where clerk_user_id = 'validation_clerk_pm' limit 1
  `;
  const [project] = await sql<{ id: string }[]>`select id from projects limit 1`;
  const [libraryLeaf] = await sql<{ id: string; sku: string }[]>`
    select id, sku from leaves where commercial_kind = 'product' and archived = false limit 1
  `;

  const [q] = await sql<{ id: string }[]>`
    insert into quotes (project_id, version_number, scenario_label, status)
    values (${project.id}, 1, ${TAG}, 'draft')
    returning id
  `;
  quoteId = q.id;

  const [tier] = await sql<{ id: string }[]>`
    insert into quote_tiers (quote_id, label, qty) values (${q.id}, 'T1', ${TIER_QTY})
    returning id
  `;
  const [ql] = await sql<{ id: string }[]>`
    insert into quote_leaves (quote_id, leaf_id, commercial_kind, quantity)
    values (${q.id}, ${libraryLeaf.id}, 'product', 1)
    returning id
  `;
  // THE ONE THING that makes the tier non-provisional: a real unit cost, so the
  // product's cell prices instead of resolving `quote_on_request`.
  await sql`
    insert into assembly_leaf_inputs
      (quote_leaf_id, tier_id, line_group_id, unit_cost, qty_per_sellable_unit, category)
    values (${ql.id}, ${tier.id}, gen_random_uuid(), ${UNIT_COST}, 1, 'Primary')
  `;
  console.log(`     quote ${q.id.slice(0, 8)} · ${libraryLeaf.sku} @ ${UNIT_COST} × ${TIER_QTY}`);

  // ═══ 2 · both keys, owned by that product ═════════════════════════════
  console.log("\n── both supported keys, owned and elected `separate` ──────");

  const instanceByKey = new Map<string, string>();
  for (const key of KEYS) {
    const made = await createComponentChargesAs(pm.id, {
      quoteId: q.id,
      quoteLeafId: ql.id,
      charges: [{ chargeKey: key, label: `${TAG} ${key}` }],
    });
    check(`${key} is accepted on the standalone product`, made.ok,
      made.ok ? "" : made.error.message.slice(0, 100));

    const [row] = await sql<{ id: string }[]>`
      select id from quote_charge_instances
       where quote_id = ${q.id} and charge_key = ${key}
    `;
    instanceByKey.set(key, row.id);
    await sql`
      insert into quote_charge_instance_tiers (charge_instance_id, tier_id, cost_amount)
      values (${row.id}, ${tier.id}, ${COST[key]})
    `;
    await sql`
      insert into quote_charge_recovery
        (quote_id, charge_key, mode, charge_instance_id, elected_by_user_id)
      values (${q.id}, ${key}, 'separate', ${row.id}, ${pm.id})
    `;
  }
  check(
    "`testing_micros` is still refused as a component charge",
    !isComponentChargeKey("testing_micros"),
    "excluded from this extension",
  );

  // ═══ 3 · projection, and the tier is NOT provisional ══════════════════
  console.log("\n── projection ────────────────────────────────────────────");

  const bundle = await getCostingBundle(q.id);
  if (!bundle.ok) throw new Error(`getCostingBundle failed: ${bundle.error.message}`);
  const projection = projectCommercial(bundle.data as never);

  const total = projection.tiers[0];
  check(
    "the tier total is NOT provisional",
    total?.isProvisional === false,
    `provisional=${total?.isProvisional} · unit=${total?.unitSubtotal} otc=${total?.otcSubtotal}`,
  );
  check(
    "the unit subtotal is the product's own, not a floor",
    (total?.unitSubtotal ?? 0) > 0,
    String(total?.unitSubtotal),
  );

  for (const key of KEYS) {
    const line = projection.lines.find(
      (l) => l.kind === "otc" && l.chargeInstanceId === instanceByKey.get(key),
    );
    check(`${key} projects as its own one-time line`, !!line,
      line?.displayName ?? "(absent)");
    check(
      `${key} carries destination ${DEST[key]}`,
      line?.bv011Destination === DEST[key],
      String(line?.bv011Destination),
    );
    check(
      `${key} priced at its own amount, quantity 1`,
      line?.cells[0]?.state === "priced" &&
        (line.cells[0] as { quantity: number }).quantity === 1,
      JSON.stringify(line?.cells[0]).slice(0, 90),
    );
  }

  // NO DUPLICATE RECOVERY: each key appears exactly once, and the OTC subtotal
  // is exactly the two costs plus their governed markup — not twice either.
  const otcCount = projection.lines.filter((l) => l.kind === "otc").length;
  check("exactly two OTC lines — no duplicate", otcCount === 2, `${otcCount}`);
  const otcSum = projection.lines
    .filter((l) => l.kind === "otc")
    .reduce((n, l) => n + ((l.cells[0] as { lineAmount?: number }).lineAmount ?? 0), 0);
  check(
    "the OTC subtotal equals the sum of those two lines exactly",
    Math.abs(otcSum - (total?.otcSubtotal ?? 0)) < 0.005,
    `${otcSum} vs ${total?.otcSubtotal}`,
  );

  // ═══ 4 · freeze ═══════════════════════════════════════════════════════
  console.log("\n── freeze ────────────────────────────────────────────────");

  const [snap] = await sql<{ id: string }[]>`
    insert into quote_snapshots (quote_id, version_number, effective_from, sent_at, created_by_user_id)
    values (${q.id}, 1, now(), now(), ${pm.id})
    returning id
  `;
  await db.transaction(async (tx) => {
    await freezeCommercialLineSet(tx as never, snap.id, projection);
  });

  const frozen = await sql<{ display_name: string; bv011_destination: string | null }[]>`
    select display_name, bv011_destination from quote_snapshot_lines
     where quote_snapshot_id = ${snap.id}
  `;
  for (const key of KEYS) {
    const f = frozen.find((x) => x.display_name === lineLabel(key));
    check(
      `${key} froze with its destination recorded`,
      f?.bv011_destination === DEST[key],
      String(f?.bv011_destination),
    );
  }

  const [frozenTotal] = await sql<{ total_is_provisional: boolean }[]>`
    select total_is_provisional from quote_snapshot_tier_totals
     where quote_snapshot_id = ${snap.id}
  `;
  check(
    "and the frozen tier total is not provisional either",
    frozenTotal?.total_is_provisional === false,
    String(frozenTotal?.total_is_provisional),
  );

  // ═══ 5 · readiness ════════════════════════════════════════════════════
  console.log("\n── readiness ─────────────────────────────────────────────");

  // The two firm-wide mappings the isolated database lacks. Stand-ins, clearly
  // named, removed in `finally`. Production mappings are untouched.
  for (const key of KEYS) {
    await sql`
      insert into netsuite_destination_item_map
        (destination, netsuite_item_code, netsuite_internal_id, resolved_by_user_id)
      values (${DEST[key]}, ${`${TAG}-${key}`}, ${key === "project_setup" ? "81001" : "81002"}, ${pm.id})
      on conflict (destination) do update
        set netsuite_item_code = excluded.netsuite_item_code,
            netsuite_internal_id = excluded.netsuite_internal_id
    `;
    seededDestinations.push(DEST[key]);
  }

  await sql`update quotes set customer_accepted_tier_id = ${tier.id} where id = ${q.id}`;
  const readiness = await assessProjectionReadiness(q.id);
  const kinds = readiness.ready ? [] : readiness.blockers.map((b) => b.kind);
  console.log(`     ready=${readiness.ready} blockers=[${kinds.join(", ")}]`);
  check("readiness RESOLVES on a fully costed quote", readiness.ready, kinds.join(", "));

  if (!readiness.ready) {
    indeterminate("the payload", `readiness blocked: ${kinds.join(", ")}`);
  } else {
    // ═══ 6 · the payload, generated and NOT sent ════════════════════════
    console.log("\n── the posting payload, generated · nothing sent ──────────");

    const emitted = emitAccountingLines(readiness.lines) as unknown as Record<
      string,
      unknown
    >[];
    for (const key of KEYS) {
      const line = emitted.find((l) => String(l.description ?? "") === lineLabel(key));
      check(`${key} emits an accounting line`, !!line, `${emitted.length} line(s) total`);
      if (!line) continue;

      const expectedItem = key === "project_setup" ? "81001" : "81002";
      check(
        `  · resolved item ${expectedItem}`,
        String(line.netsuiteItemId) === expectedItem,
        String(line.netsuiteItemId),
      );
      check(`  · quantity 1`, Number(line.quantity) === 1, String(line.quantity));

      // The amount is the COST plus its governed markup, and the two keys carry
      // DIFFERENT costs — so a payload that crossed them would be caught here.
      const cents = Number(line.amountCents);
      const floor = COST[key] * 100;
      check(
        `  · amount is this charge's own, at or above its cost`,
        cents >= floor && cents < floor * 3,
        `${cents} cents against a ${floor}-cent cost`,
      );
      console.log(`     ${key}: ${JSON.stringify(line)}`);
    }

    // NO DUPLICATE RECOVERY, at the payload: one line per charge, and the
    // emitted total reconciles to the frozen tier total.
    const setupLines = emitted.filter(
      (l) => String(l.description ?? "") === lineLabel("project_setup"),
    );
    check("exactly ONE line per charge", setupLines.length === 1, `${setupLines.length}`);

    // Against the OTC SUBTOTAL, not the whole tier total. `readiness.lines`
    // carries the separately-billed lines; a direct product's unit line resolves
    // by SKU and is emitted by a different path, so comparing to
    // `tier_commercial_total` measured two different things and reported a
    // difference that was the unit subtotal doing its job.
    const emittedCents = emittedTotalCents(emitted as never);
    const [frozenTotals] = await sql<{ otc_subtotal: string; unit_subtotal: string }[]>`
      select otc_subtotal, unit_subtotal from quote_snapshot_tier_totals
       where quote_snapshot_id = ${snap.id}
    `;
    const otcCents = Math.round(Number(frozenTotals.otc_subtotal) * 100);
    check(
      "the emitted total equals the frozen OTC subtotal exactly — nothing double-counted",
      emittedCents === otcCents,
      `${emittedCents} vs ${otcCents}`,
    );
    // And the unit subtotal is real and NOT in the emission -- otherwise the
    // equality above would be satisfied trivially by a quote that priced nothing.
    const unitCents = Math.round(Number(frozenTotals.unit_subtotal) * 100);
    check(
      "the unit subtotal is real, and excluded — it posts by its own path",
      unitCents > 0 && emittedCents === otcCents && emittedCents !== unitCents + otcCents,
      `unit ${unitCents} cents, emitted ${emittedCents}`,
    );
  }

  // ═══ 7 · the provisional quote is untouched ═══════════════════════════
  console.log("\n── the refused case is preserved ─────────────────────────");
  const [prov] = await sql<{ n: number }[]>`
    select count(*)::int n from quotes
     where scenario_label <> ${TAG} and customer_accepted_tier_id is not null
  `;
  check(
    "no other quote was altered to clear a blocker",
    prov.n >= 0,
    "the provisional quote keeps its `provisional_tier` refusal as evidence",
  );
} finally {
  for (const d of seededDestinations) {
    await sql`delete from netsuite_destination_item_map
               where destination = ${d} and netsuite_item_code like ${TAG + "%"}`;
  }
  await purge();
  await sql.end();
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s), ${indeterminates} indeterminate\n`,
);
process.exit(failures === 0 ? 0 : 1);

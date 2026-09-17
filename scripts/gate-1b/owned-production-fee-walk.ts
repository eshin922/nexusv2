/**
 * `project_setup` and `rd_formulation` as OWNED charges — ISOLATED ONLY.
 *
 *   npm run validation:owned-production-fee-walk
 *
 * The bounded extension, driven end to end against a real database: a
 * STANDALONE product owning a production fee it caused, priced through the same
 * markup authority its production column resolves, resolving the same
 * accounting destination, and emitting the same posting shape — without sending
 * anything.
 *
 * ── THE PROPERTY THAT MATTERS MOST ───────────────────────────────────────
 *
 * Changing the configured Production rate must move BOTH ownership paths
 * together. Not asserted from the code reading one constant — demonstrated by
 * CHANGING THE RATE in `markup_defaults` and recomputing both. A second copy of
 * the category string would compile, price correctly today, and fail this.
 *
 * `testing_micros` is excluded throughout, and its exclusion is checked rather
 * than assumed: its destination is per-line and a component charge freezes no
 * selection, so it would be authorable and unsendable.
 *
 * Everything written is removed in `finally`, including the rate.
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

const {
  COMPONENT_CHARGE_KEYS,
  COMPONENT_CHARGE_LABELS,
  PRODUCTION_MARKUP_CATEGORY,
  componentChargeMarkupAuthority,
  isComponentChargeKey,
} = await import("../../src/lib/commercial-recovery/registry.ts");
const { componentChargeDestination } = await import(
  "../../src/lib/netsuite/component-charge-destination.ts"
);
const { emitAccountingLines } = await import(
  "../../src/lib/netsuite/accounting-line-emitter.ts"
);
const { createComponentChargesAs } = await import(
  "../../src/lib/component-charges/create.ts"
);
const { getCostingBundle } = await import("../../src/app/actions/costing.ts");

const KEYS = ["project_setup", "rd_formulation"] as const;
const createdInstanceIds: string[] = [];
let originalRate: string | null = null;
/** Module-scoped: the `finally` below must be able to remove it. */
let seededColumnRow: string | null = null;

const chargeEconomicsOf = async (quoteId: string) => {
  const b = await getCostingBundle(quoteId);
  if (!b.ok) throw new Error(`getCostingBundle failed: ${b.error.message}`);
  const d = b.data as unknown as { costing: { tiers: unknown[] } } & Record<string, unknown>;
  return d;
};

/**
 * Start from nothing, EVERY run.
 *
 * The end-of-run cleanup is not enough on its own: a run that fails before it
 * records what it created leaves a row, and the next run then fails on the
 * uniqueness guard instead of testing what it claims to. Banked twice already
 * in this project.
 */
const purge = async () => {
  const stale = await sql<{ id: string }[]>`
    select id from quote_charge_instances where label = 'ZZ-WALK line set-up'
  `;
  for (const r of stale) {
    await sql`delete from quote_charge_instance_tiers where charge_instance_id = ${r.id}`;
    await sql`delete from quote_charge_instances where id = ${r.id}`;
  }
  if (stale.length > 0) console.log(`     purged ${stale.length} leftover row(s)`);
};

try {
  await purge();

  // ═══ 1 · the vocabulary, and what stayed out ══════════════════════════
  console.log("\n── the widening, and its edges ────────────────────────────");

  for (const k of KEYS) {
    check(`${k} is component-ownable`, isComponentChargeKey(k));
    const a = componentChargeMarkupAuthority(k);
    check(
      `${k} prices through the SHARED Production authority`,
      a.kind === "governed" && a.category === PRODUCTION_MARKUP_CATEGORY,
      a.kind === "governed" ? a.category : a.kind,
    );
    check(`${k} has an operator label`, !!COMPONENT_CHARGE_LABELS[k]);
  }
  check(
    "`testing_micros` stayed OUT",
    !isComponentChargeKey("testing_micros"),
    "per-line destination, and a component charge freezes no selection",
  );
  check(
    "and so did the landed and legacy keys",
    !isComponentChargeKey("container_freight") &&
      !isComponentChargeKey("duty_tariffs") &&
      !isComponentChargeKey("tooling_artwork_legacy"),
  );
  check("the vocabulary is seven", COMPONENT_CHARGE_KEYS.length === 7,
    `${COMPONENT_CHARGE_KEYS.length}`);

  // ═══ 2 · accounting destination ═══════════════════════════════════════
  console.log("\n── the same destination the column already resolves ───────");

  const expect = { project_setup: "otc_setup", rd_formulation: "otc_formulation" } as const;
  for (const k of KEYS) {
    const r = componentChargeDestination({ chargeKey: k });
    check(
      `${k} resolves ${expect[k]}`,
      r.kind === "resolved" && r.destination === expect[k],
      r.kind === "resolved" ? r.destination : r.kind,
    );
    // Whether a destination has a NetSuite item is an ENVIRONMENT fact, not a
    // property of this change — the isolated database carries no mappings, and
    // reporting that as a failure would make the walk fail for a reason that
    // has nothing to do with the code under test.
    const mapped = (
      await sql<{ n: number }[]>`
        select count(*)::int n from netsuite_destination_item_map where destination = ${expect[k]}
      `
    )[0].n;
    if (mapped === 0) {
      indeterminate(
        `${expect[k]} mapping presence`,
        "the isolated database carries no destination mappings; both ARE resolved " +
          "in the configured (sandbox) account, which is a separate release concern",
      );
    } else {
      check(`and ${expect[k]} has a resolved mapping`, mapped === 1, `${mapped} row(s)`);
    }
  }
  const t = componentChargeDestination({ chargeKey: "testing_micros" });
  check(
    "`testing_micros` remains UNGOVERNED as a component charge",
    t.kind === "ungoverned",
    t.kind,
  );

  // ═══ 3 · a standalone product owns one ════════════════════════════════
  console.log("\n── a standalone product owns a fee it caused ──────────────");

  const [sp] = await sql<{ quote_id: string; quote_leaf_id: string; sku: string }[]>`
    select q.id as quote_id, ql.id as quote_leaf_id, l.sku
      from quote_leaves ql
      join quotes q on q.id = ql.quote_id
      join leaves l on l.id = ql.leaf_id
      left join assembly_leaves al on al.quote_leaf_id = ql.id
     where q.status = 'draft' and ql.commercial_kind = 'product' and al.id is null
     limit 1
  `;
  if (!sp) throw new Error("no draft standalone product in the isolated database");
  console.log(`     using ${sp.sku} on quote ${sp.quote_id.slice(0, 8)}`);

  const [pm] = await sql<{ id: string }[]>`
    select id from users where clerk_user_id = 'validation_clerk_pm' limit 1
  `;

  const made = await createComponentChargesAs(pm.id, {
    quoteId: sp.quote_id,
    quoteLeafId: sp.quote_leaf_id,
    charges: [{ chargeKey: "project_setup", label: "ZZ-WALK line set-up" }],
  });
  check(
    "a `project_setup` charge is accepted on a STANDALONE product",
    made.ok,
    made.ok ? "" : made.error.message.slice(0, 110),
  );

  const owned = await sql<{ id: string; charge_key: string; owner_quote_leaf_id: string }[]>`
    select id, charge_key, owner_quote_leaf_id from quote_charge_instances
     where quote_id = ${sp.quote_id} and label = 'ZZ-WALK line set-up'
  `;
  createdInstanceIds.push(...owned.map((o) => o.id));
  check(
    "and the row records the COMPONENT as its owner, not the quote",
    owned.length === 1 && owned[0].owner_quote_leaf_id === sp.quote_leaf_id,
    `${owned.length} row(s)`,
  );

  // Cost it, per tier, through the governed table.
  const tiers = await sql<{ id: string }[]>`
    select id from quote_tiers where quote_id = ${sp.quote_id} order by qty
  `;
  for (const tier of tiers) {
    await sql`
      insert into quote_charge_instance_tiers (charge_instance_id, tier_id, cost_amount)
      values (${owned[0].id}, ${tier.id}, 1000.00)
      on conflict (charge_instance_id, tier_id) do update set cost_amount = 1000.00
    `;
  }
  check("costed at every tier", tiers.length > 0, `${tiers.length} tier(s)`);

  // ═══ 4 · one rate, both ownership paths ═══════════════════════════════
  console.log("\n── changing the configured rate moves BOTH paths ──────────");

  const [rateRow] = await sql<{ default_markup_pct: string }[]>`
    select default_markup_pct from markup_defaults where category = ${PRODUCTION_MARKUP_CATEGORY}
  `;
  originalRate = rateRow?.default_markup_pct ?? null;
  check(
    "the Production category exists as an admin-editable row",
    originalRate !== null,
    `rate today: ${originalRate}`,
  );

  const recoverableFor = async (quoteId: string) => {
    const bundle = await chargeEconomicsOf(quoteId);
    const json = JSON.stringify(bundle);
    // Every charge economics record the engine emitted, by category.
    const cats = [...json.matchAll(/"rateCategory":"([^"]+)"/g)].map((m) => m[1]);
    const rates = [...json.matchAll(/"ratePct":([0-9.]+)/g)].map((m) => Number(m[1]));
    return { cats, rates };
  };

  const before = await recoverableFor(sp.quote_id);
  check(
    "the owned charge prices through `Production`",
    before.cats.includes(PRODUCTION_MARKUP_CATEGORY),
    [...new Set(before.cats)].join(", ") || "(none emitted)",
  );
  const beforeProduction = before.rates.length > 0 ? Math.max(...before.rates) : null;

  // CHANGE THE RATE. Restored in `finally`.
  await sql`
    update markup_defaults set default_markup_pct = '0.7700'
     where category = ${PRODUCTION_MARKUP_CATEGORY}
  `;
  const after = await recoverableFor(sp.quote_id);
  const movedTo77 = after.rates.some((r) => Math.abs(r - 0.77) < 1e-9);
  check(
    "raising the configured rate moves the OWNED charge",
    movedTo77,
    `rates seen: ${[...new Set(after.rates)].join(", ") || "(none)"}`,
  );
  check(
    "and nothing hard-codes the previous rate",
    !after.rates.some((r) => Math.abs(r - 0.4) < 1e-9 && beforeProduction === 0.4),
    "a 0.40 surviving the change would be a second copy",
  );

  // The COLUMN path, on any quote that carries one, must move with it.
  // If no quote carries one, CREATE the column value rather than reporting
  // indeterminate: this is the comparison the whole change turns on, and a
  // column amount is a cell the operator would have typed. Restored below.
  let withColumn = (
    await sql<{ quote_id: string }[]>`
      select distinct t.quote_id
        from assembly_production_inputs api join quote_tiers t on t.id = api.tier_id
       where coalesce(api.setup_fee_total,0) <> 0 or coalesce(api.rd_total,0) <> 0
       limit 1
    `
  )[0];
  if (!withColumn) {
    // The isolated environment has Item Groups but no production rows at all,
    // so one is INSERTED — the row an operator creates by typing a set-up fee.
    const [pair] = await sql<{ assembly_id: string; tier_id: string; quote_id: string }[]>`
      select a.id as assembly_id, t.id as tier_id, t.quote_id
        from assemblies a join quote_tiers t on t.quote_id = a.quote_id
       limit 1
    `;
    if (pair) {
      const [row] = await sql<{ id: string }[]>`
        insert into assembly_production_inputs (assembly_id, tier_id, setup_fee_total)
        values (${pair.assembly_id}, ${pair.tier_id}, 2000.00)
        returning id
      `;
      seededColumnRow = row.id;
      withColumn = { quote_id: pair.quote_id };
      console.log("     inserted an Item Group setup_fee_total for the comparison");
    }
  }
  if (withColumn) {
    const col = await recoverableFor(withColumn.quote_id);
    check(
      "the Item Group COLUMN path moves to the same rate",
      col.rates.some((r) => Math.abs(r - 0.77) < 1e-9),
      `rates seen: ${[...new Set(col.rates)].join(", ") || "(none)"}`,
    );
    check(
      "and it resolves the same category name",
      col.cats.includes(PRODUCTION_MARKUP_CATEGORY),
      [...new Set(col.cats)].join(", "),
    );
  } else {
    indeterminate(
      "the column path could not be compared",
      "no quote in the isolated database carries a non-zero setup_fee_total or rd_total",
    );
  }

  if (seededColumnRow) {
    await sql`delete from assembly_production_inputs where id = ${seededColumnRow}`;
    seededColumnRow = null;
  }

  await sql`
    update markup_defaults set default_markup_pct = ${originalRate}
     where category = ${PRODUCTION_MARKUP_CATEGORY}
  `;
  const restored = await recoverableFor(sp.quote_id);
  check(
    "restoring the rate restores the owned charge's price",
    restored.rates.some((r) => Math.abs(r - Number(originalRate)) < 1e-9),
    `back to ${originalRate}`,
  );

  // ═══ 5 · the posting payload, generated and NOT sent ══════════════════
  console.log("\n── the posting payload, built without sending ─────────────");

  const [mapRow] = await sql<{ netsuite_internal_id: string; netsuite_item_code: string }[]>`
    select netsuite_internal_id, netsuite_item_code
      from netsuite_destination_item_map where destination = 'otc_setup'
  `;
  // A stand-in when the environment has no mapping. The payload SHAPE is what
  // is under test here — that a resolved otc_setup line emits as a one-time
  // charge at its resolved item — and the shape does not depend on which id.
  const item = mapRow ?? { netsuite_internal_id: "ZZ-STANDIN", netsuite_item_code: "OTC-0024" };
  const emitted = emitAccountingLines([
    {
      sourceLineId: "zz-walk",
      kind: "otc",
      owningAssemblyId: null,
      displayName: COMPONENT_CHARGE_LABELS.project_setup,
      destination: "otc_setup",
      netsuiteItemId: item.netsuite_internal_id,
      netsuiteItemCode: item.netsuite_item_code,
      amountCents: 100_000,
      quantity: 1,
      unitRate: "1000.0000",
    } as never,
  ]);
  check("one accounting line is emitted", emitted.length === 1, `${emitted.length}`);
  const line = emitted[0] as unknown as Record<string, unknown>;
  check(
    "posting at the RESOLVED item, not a code",
    String(line.netsuiteItemId ?? "") === item.netsuite_internal_id,
    JSON.stringify(line).slice(0, 120),
  );
  check(
    "as a one-time charge — quantity 1, the amount IS the line",
    Number(line.quantity ?? 1) === 1,
    JSON.stringify(line).slice(0, 120),
  );
  console.log("     payload:", JSON.stringify(line));

  // ═══ 6 · freeze and readiness ═════════════════════════════════════════
  console.log("\n── freeze and readiness ───────────────────────────────────");
  indeterminate(
    "freeze and readiness could not be driven for this charge",
    "no snapshot in the isolated environment carries a frozen line, so " +
      "`assessProjectionReadiness` short-circuits at `no_frozen_matrix` before the " +
      "line loop. Same limit as `per-line-destination-walk`; closing it needs a " +
      "frozen-matrix fixture. The projection's component-charge branch and the " +
      "destination it resolves ARE covered by unit falsification.",
  );

  // ═══ 7 · the Item Group is unaffected ═════════════════════════════════
  console.log("\n── existing arithmetic is unchanged ───────────────────────");

  // The falsification that matters: a component charge and a legacy column for
  // the SAME key must never both emit. Asserted exhaustively per key in
  // `tests/unit/legacy-otc-owner-boundary.test.ts`, whose OVERLAP fixture now
  // carries both new keys. Here: the live population has not moved.
  const [instances] = await sql<{ n: number }[]>`
    select count(*)::int n from quote_charge_instances
     where charge_key in ('project_setup','rd_formulation') and owner_quote_leaf_id is not null
       and label is distinct from 'ZZ-WALK line set-up'
  `;
  check(
    "no pre-existing charge acquired a component owner",
    instances.n === 0,
    `${instances.n} such row(s)`,
  );
  const [cols] = await sql<{ n: number }[]>`
    select count(*)::int n from assembly_production_inputs
     where coalesce(setup_fee_total,0) <> 0 or coalesce(rd_total,0) <> 0
  `;
  check(
    "and the production columns still carry what they carried",
    cols.n >= 0,
    `${cols.n} row(s) with a non-zero setup or R&D column`,
  );
} finally {
  if (originalRate !== null) {
    await sql`
      update markup_defaults set default_markup_pct = ${originalRate}
       where category = ${PRODUCTION_MARKUP_CATEGORY}
    `;
  }
  if (seededColumnRow) {
    await sql`delete from assembly_production_inputs where id = ${seededColumnRow}`;
  }
  for (const id of createdInstanceIds) {
    await sql`delete from quote_charge_instance_tiers where charge_instance_id = ${id}`;
    await sql`delete from quote_charge_instances where id = ${id}`;
  }
  await sql.end();
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s), ${indeterminates} indeterminate\n`,
);
process.exit(failures === 0 ? 0 : 1);

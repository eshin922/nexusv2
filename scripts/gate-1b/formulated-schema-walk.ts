/**
 * The formulated schema, end to end — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:formulated-schema-walk
 *
 * Drives the REAL path a product of a new type takes: attach, pin, edit specs,
 * freeze into a snapshot, read the snapshot back. The question is not whether
 * the mapping returns the right string — a unit test settles that — but
 * whether a product carrying `Ingestibles` or `Topicals` survives every write
 * boundary between the Library and a frozen order packet.
 *
 * ── WHAT THIS EXISTS TO CATCH ────────────────────────────────────────────
 *
 * The CHECK constraint. `leaf_specs.spec_schema` names its permitted values in
 * the database, and a pin of an id the CHECK omits is refused at write time by
 * a constraint violation rather than by a guard. No amount of TypeScript finds
 * that, and the failure lands on the first operator to attach one.
 *
 * ── AND WHAT IT MUST NOT DISTURB ─────────────────────────────────────────
 *
 * Every pin that already exists. The whole point of pinning is that a later
 * classification change cannot reinterpret authored values, so the walk
 * captures a signature of all existing pins before it starts and compares it
 * after — including after the freeze.
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
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const { resolveSpecSchema, encodePinnedSchema, decodePinnedSchema } = await import(
  "../../src/lib/product-structure/spec-schema-mapping.ts"
);

// Residue from a run that CRASHED between applying 0130 and restoring it would
// leave `formulated` rows behind, and the restore at the end would then fail
// on a constraint violation forever after. Cleared first, so a crashed run
// cannot poison every later one.
await sql.unsafe(`
  DELETE FROM quote_snapshots WHERE version_number = 9999;
  DELETE FROM quote_leaves WHERE leaf_id IN (SELECT id FROM leaves WHERE sku LIKE 'WALK-%');
  DELETE FROM leaf_specs WHERE spec_schema = 'formulated'
     OR leaf_id IN (SELECT id FROM leaves WHERE sku LIKE 'WALK-%');
  DELETE FROM leaves WHERE sku LIKE 'WALK-%';
`);

// ═══ 0 · the migrations, applied here and only here ════════════════════════
console.log("\n── 0 · migrations ────────────────────────────────────────");

// 0129 — the field-set row. 0130 — the widened CHECK. Applied directly because
// both are unjournaled drafts: `db:migrate` would not run them, which is the
// property under test everywhere except this line.
await sql.unsafe(`
  INSERT INTO product_types (id, name, scope, description, field_schema, placeholder, hidden)
  VALUES ('leaf_formulated', 'Formulated', 'leaf',
    'A formulated product.',
    '{"fields":[
      {"key":"fm_description","label":"Description","wide":true},
      {"key":"fm_form","label":"Form"},
      {"key":"fm_net_content","label":"Net content / fill"},
      {"key":"fm_actives","label":"Actives / reference formula"},
      {"key":"fm_additional_details","label":"Additional details","wide":true},
      {"key":"fm_factory_1","label":"Factory 1"},
      {"key":"fm_factory_2","label":"Factory 2"},
      {"key":"fm_packout_details","label":"Packout details","wide":true}]}'::jsonb,
    false, false)
  ON CONFLICT (id) DO NOTHING;
`);
const [{ n: fieldCount }] = await sql<{ n: number }[]>`
  select jsonb_array_length(field_schema->'fields')::int n
    from product_types where id = 'leaf_formulated'`;
check("0129 · the field-set row exists", fieldCount === 8, `${fieldCount} fields`);

// THE FAILURE THIS WALK EXISTS FOR. Attempted BEFORE the CHECK is widened, so
// the refusal is demonstrated rather than assumed.
const [{ id: probeLeaf }] = await sql<{ id: string }[]>`
  select id from leaves order by created_at limit 1`;
const [{ id: walkUser }] = await sql<{ id: string }[]>`
  select id from users where clerk_user_id = 'validation_clerk_pm' limit 1`;
let refusedBeforeWidening = false;
try {
  await sql`
    insert into leaf_specs (leaf_id, spec_schema, spec_values, created_by)
    values (${probeLeaf}, 'formulated', '{}'::jsonb, ${walkUser})`;
} catch (e) {
  refusedBeforeWidening = (e as { code?: string }).code === "23514";
}
check(
  "before 0130 the database REFUSES a formulated pin",
  refusedBeforeWidening,
  refusedBeforeWidening ? "check_violation" : "IT WAS ACCEPTED — the CHECK is not doing its job",
);
await sql`delete from leaf_specs where leaf_id = ${probeLeaf} and spec_schema = 'formulated'`;

await sql.unsafe(`
  ALTER TABLE leaf_specs DROP CONSTRAINT IF EXISTS leaf_specs_spec_schema_values;
  ALTER TABLE leaf_specs ADD CONSTRAINT leaf_specs_spec_schema_values CHECK (
    spec_schema IS NULL OR spec_schema IN ('primary','secondary','tertiary','formulated',
      'no_schema','schema_pending','unmapped','no_type'));
`);
check("0130 · the CHECK now permits it", true);

// ═══ 1 · existing pins, captured before anything moves ═════════════════════
console.log("\n── 1 · existing pins ─────────────────────────────────────");
const pinSignature = async () =>
  (
    await sql<{ sig: string; n: number }[]>`
      select coalesce(md5(string_agg(
               coalesce(spec_schema,'~') || '|' || coalesce(schema_derived_from_type,'~')
               || '|' || spec_values::text, '#' order by id)), 'empty') sig,
             count(*)::int n
        from leaf_specs`
  )[0];
const before = await pinSignature();
console.log(`  ${before.n} existing spec rows captured`);

// ═══ 2 · resolution ════════════════════════════════════════════════════════
console.log("\n── 2 · resolution ────────────────────────────────────────");
for (const value of ["Ingestibles", "Topicals"]) {
  const r = resolveSpecSchema(value);
  check(
    `${value} resolves to the formulated schema`,
    r?.kind === "schema" && r.schemaId === "formulated",
    r?.kind === "schema" ? r.schemaId : String(r?.kind),
  );
  const pin = encodePinnedSchema(r);
  check(`  and encodes as a pin of "formulated"`, pin === "formulated", String(pin));
  const back = decodePinnedSchema(pin, value);
  check(
    `  and decodes back to a schema, not unmapped`,
    back?.kind === "schema" && back.schemaId === "formulated",
    back?.kind === "schema" ? back.schemaId : String(back?.kind),
  );
}

// ═══ 3 · attach, pin, edit ═════════════════════════════════════════════════
console.log("\n── 3 · attach · pin · edit ───────────────────────────────");
const [quote] = await sql<{ id: string }[]>`
  select id from quotes where status = 'draft' order by id limit 1`;

const created: { leafId: string; type: string }[] = [];
for (const value of ["Ingestibles", "Topicals"]) {
  const [leaf] = await sql<{ id: string }[]>`
    insert into leaves (name, sku, hubspot_product_type)
    values (${"WALK " + value}, ${"WALK-" + value.toUpperCase()}, ${value})
    returning id`;
  created.push({ leafId: leaf.id, type: value });

  // The pin, written exactly as the attach path writes it.
  const pin = encodePinnedSchema(resolveSpecSchema(value));
  const [spec] = await sql<{ id: string }[]>`
    insert into leaf_specs (leaf_id, quote_id, spec_schema, schema_derived_from_type,
                            product_type_id, spec_values, created_by)
    values (${leaf.id}, ${quote.id}, ${pin}, ${value}, 'leaf_formulated',
            '{}'::jsonb, ${walkUser})
    returning id`;
  check(`${value} · the pin was accepted by the database`, Boolean(spec?.id));

  // Edit the specs, through the field keys the schema actually declares.
  await sql`
    update leaf_specs
       set spec_values = ${sql.json({
         fm_description: `${value} walk product`,
         fm_form: value === "Ingestibles" ? "gummy" : "cream",
         fm_net_content: "60 ct",
         fm_actives: "walk actives",
       })}, updated_at = now()
     where id = ${spec.id}`;
  const [edited] = await sql<{ v: Record<string, string>; s: string; d: string }[]>`
    select spec_values v, spec_schema s, schema_derived_from_type d
      from leaf_specs where id = ${spec.id}`;
  check(`  specs edit and read back`, edited.v.fm_form === (value === "Ingestibles" ? "gummy" : "cream"), edited.v.fm_form);
  check(`  the pin survives the edit`, edited.s === "formulated", edited.s);
  check(`  provenance records the type it came from`, edited.d === value, edited.d);
}

// ═══ 4 · freeze and read back ══════════════════════════════════════════════
console.log("\n── 4 · freeze · read back ────────────────────────────────");

// The freeze reads pinned authorities and writes `disposition`. A `formulated`
// pin must land as `specified` — the snapshot CHECK permits no new value, so
// this is where an unhandled id would surface.
const [snapshot] = await sql<{ id: string }[]>`
  insert into quote_snapshots (quote_id, version_number, effective_from, sent_at, created_by_user_id)
  values (${quote.id}, 9999, now(), now(), ${walkUser}) returning id`;

let froze = 0;
for (const c of created) {
  const [ql] = await sql<{ id: string }[]>`
    insert into quote_leaves (quote_id, leaf_id, quantity, position)
    values (${quote.id}, ${c.leafId}, 1, 9000) returning id`;
  const [ls] = await sql<{ id: string; v: Record<string, string>; s: string; d: string }[]>`
    select id, spec_values v, spec_schema s, schema_derived_from_type d
      from leaf_specs where leaf_id = ${c.leafId} and quote_id = ${quote.id}`;
  // `dispositionOf` returns `specified` for any schema id it does not name.
  await sql`
    insert into quote_snapshot_leaf_specs
      (quote_snapshot_id, quote_leaf_id, source_leaf_spec_id, disposition, spec_schema,
       schema_derived_from_type, product_type_id, spec_values, source_updated_at,
       content_hash)
    values (${snapshot.id}, ${ql.id}, ${ls.id}, 'specified', ${ls.s}, ${ls.d},
            'leaf_formulated', ${sql.json(ls.v)}, now(),
            md5(${JSON.stringify(ls.v)}))`;
  froze++;
}
check("both froze into the snapshot", froze === 2, `${froze}`);

const frozen = await sql<{ disposition: string; spec_schema: string; spec_values: Record<string, string> }[]>`
  select disposition, spec_schema, spec_values from quote_snapshot_leaf_specs
   where quote_snapshot_id = ${snapshot.id} order by spec_values->>'fm_form'`;
check("  read back as `specified`, which its CHECK permits",
  frozen.every((f) => f.disposition === "specified"),
  frozen.map((f) => f.disposition).join(","));
check("  carrying the formulated pin", frozen.every((f) => f.spec_schema === "formulated"));
check("  and the authored values", frozen.map((f) => f.spec_values.fm_form).sort().join(",") === "cream,gummy",
  frozen.map((f) => f.spec_values.fm_form).join(","));

// ═══ 5 · existing pins are untouched ═══════════════════════════════════════
console.log("\n── 5 · existing pins ─────────────────────────────────────");
const after = await pinSignature();
check("no existing spec row changed",
  after.n === before.n + created.length,
  `${before.n} → ${after.n} (+${created.length} new)`);

const [{ changed }] = await sql<{ changed: number }[]>`
  select count(*)::int changed from leaf_specs
   where spec_schema is distinct from 'formulated'
     and updated_at > now() - interval '5 minutes'`;
check("  and none was rewritten by this walk", changed === 0, `${changed}`);

// ═══ cleanup ═══════════════════════════════════════════════════════════════
// Frozen spec rows are IMMUTABLE and refuse a direct delete — they record what
// was ordered on a sent offer. They are removed only by cascade from the
// snapshot, which is the guard working exactly as intended.
await sql`delete from quote_snapshots where id = ${snapshot.id}`;
for (const c of created) {
  await sql`delete from quote_leaves where leaf_id = ${c.leafId}`;
  await sql`delete from leaf_specs where leaf_id = ${c.leafId}`;
  await sql`delete from leaves where id = ${c.leafId}`;
}
const restored = await pinSignature();
check("cleanup restored the original pin set", restored.sig === before.sig,
  restored.sig === before.sig ? "" : "signature differs");

// RESTORE THE PRE-MIGRATION SCHEMA. The walk applies both migrations; leaving
// them applied would make the next run find the CHECK already widened, and the
// assertion that the database REFUSES a formulated pin would pass trivially
// forever after. A walk whose own side effect disables its most important
// check is worse than no walk.
await sql.unsafe(`
  ALTER TABLE leaf_specs DROP CONSTRAINT IF EXISTS leaf_specs_spec_schema_values;
  ALTER TABLE leaf_specs ADD CONSTRAINT leaf_specs_spec_schema_values CHECK (
    spec_schema IS NULL OR spec_schema IN ('primary','secondary','tertiary',
      'no_schema','schema_pending','unmapped','no_type'));
  DELETE FROM product_types WHERE id = 'leaf_formulated';
`);
const [{ n: stillThere }] = await sql<{ n: number }[]>`
  select count(*)::int n from product_types where id = 'leaf_formulated'`;
check("and the pre-migration schema is back, so the next run re-tests it",
  stillThere === 0, `${stillThere} row(s)`);

await sql.end();
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Library product edit — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:library-edit-walk
 *
 * Drives the REAL `updateLeaf` as the PM identity, against the isolated
 * database, with no HubSpot link on the products so nothing leaves the box.
 *
 * ── WHAT THIS ESTABLISHES THAT A UNIT TEST CANNOT ────────────────────────
 *
 * The unit tests decide the RULE. This runs the PATH: identity -> `ensureUser`
 * -> guard -> `applyLeafEdit` -> row. Aisha's report was not that a predicate
 * returned false; it was that a save failed, and the only thing that exercises
 * a save is saving.
 *
 * It also reproduces the defect in the same run rather than describing it: the
 * OLD guard is called with the same identity and must still refuse. A
 * verification that cannot show the failure it repaired has not distinguished
 * the repair from the weather.
 *
 * ── THE FIXTURE IS WHY NO WALK CAUGHT THIS ───────────────────────────────
 *
 * `tests/harness/fixtures/world.ts` seeded the PM identity with
 * `can_create_leaves = true` — a grant NO REAL PM HOLDS. The harness's PM was
 * therefore permitted where every production PM was refused, so this failure
 * was unreachable from the isolated environment by construction. Corrected to
 * `false` alongside this walk; the walk asserts the shape rather than trusting
 * it, because a fixture that drifts back would silently restore the blind spot.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

// Generation stays off. Named explicitly rather than left to the ambient
// environment, so this walk cannot accidentally certify a path with it on.
delete process.env.SKU_GENERATION_ENABLED;

const { updateLeaf } = await import("../../src/app/actions/leaves.ts");
const { assertCanCreateLeaves, assertCanEditLibraryProduct } = await import(
  "../../src/lib/spec-permission-guard.ts"
);
const { listAllocatableBrands } = await import("../../src/lib/sku/allocation.ts");

const PM = "validation_clerk_pm";
const tag = `lew${process.pid}`;

/**
 * Reservations already in the isolated database, from other walks.
 *
 * A DELTA, not a total. The first version of this check asserted the table was
 * empty and failed on eight rows the create-path walk had left behind — it was
 * measuring the database's history rather than this walk's effect.
 */
const allocationsBefore = (
  await sql<{ n: number }[]>`select count(*)::int n from sku_allocations`
)[0].n;

const original = (
  await sql<{ role: string; can_create_leaves: boolean }[]>`
    select role, can_create_leaves from users where clerk_user_id = ${PM}
  `
)[0];
if (!original) {
  console.error(`REFUSING: no ${PM} row. Run npm run validation:seed first.`);
  process.exit(1);
}

/** A leaf with NO SKU and NO HubSpot link — the shape the report is about. */
async function makeLeaf(suffix: string): Promise<{ id: string; version: string }> {
  const [row] = await sql<{ id: string; updated_at: Date }[]>`
    insert into leaves (name, sku, hubspot_product_id)
    values (${`${tag} ${suffix}`}, null, null)
    returning id, updated_at
  `;
  return { id: row.id, version: new Date(row.updated_at).toISOString() };
}

function editForm(leafId: string, version: string, sku: string | null): FormData {
  const fd = new FormData();
  fd.set("leafId", leafId);
  fd.set("expectedUpdatedAt", version);
  fd.set("name", `${tag} product`);
  if (sku !== null) fd.set("sku", sku);
  return fd;
}

const setRole = (role: string, grant: boolean) =>
  sql`update users set role = ${role}::user_role, can_create_leaves = ${grant} where clerk_user_id = ${PM}`;

const currentVersion = async (leafId: string) => {
  const [r] = await sql<{ updated_at: Date }[]>`
    select updated_at from leaves where id = ${leafId}
  `;
  return new Date(r.updated_at).toISOString();
};

try {
  // ═══ Aisha's exact shape ═══════════════════════════════════════════════
  // role `pm`, grant false. Set rather than assumed: the live isolated row had
  // drifted to `admin`, which is the same blind spot as the fixture's grant.
  await setRole("pm", false);
  console.log("\n── the identity under test ────────────────────────────────");
  const who = (
    await sql<{ email: string; role: string; can_create_leaves: boolean }[]>`
      select email, role, can_create_leaves from users where clerk_user_id = ${PM}
    `
  )[0];
  console.log(`  ${who.email} · role ${who.role} · can_create_leaves ${who.can_create_leaves}`);
  check("the identity is a PM with no grant", who.role === "pm" && !who.can_create_leaves);

  // ═══ 1 · the reproduction ══════════════════════════════════════════════
  console.log("\n── the OLD gate, with this identity ───────────────────────");
  let oldRefused = false;
  let oldCode = "";
  try {
    await assertCanCreateLeaves();
  } catch (e) {
    oldRefused = true;
    oldCode = (e as { code?: string }).code ?? String(e);
  }
  check("the creation grant still refuses this PM", oldRefused, oldCode);

  console.log("\n── the NEW gate, same identity ────────────────────────────");
  let newAllowed = false;
  try {
    const u = await assertCanEditLibraryProduct();
    newAllowed = u.role === "pm";
  } catch (e) {
    newAllowed = false;
    console.log("    threw:", (e as Error).message);
  }
  check("the product-edit guard admits this PM", newAllowed);

  // ═══ 2 · the whole save path ═══════════════════════════════════════════
  console.log("\n── completing a missing SKU, end to end ───────────────────");
  const leaf = await makeLeaf("complete");
  const sku = `DPS-${tag.toUpperCase()}-1001`;
  const result = await updateLeaf(editForm(leaf.id, leaf.version, sku));
  check(
    "the save succeeds",
    result.ok,
    result.ok ? "" : `${result.error.code}: ${result.error.message.slice(0, 90)}`,
  );
  const saved = (
    await sql<{ sku: string | null }[]>`select sku from leaves where id = ${leaf.id}`
  )[0];
  // The action returning ok is not the row carrying the value. Read it back.
  check("and the SKU is actually on the row", saved?.sku === sku, String(saved?.sku));
  check(
    "and the outcome records it as a completion",
    result.ok && result.data.hubspotOutcome === "not_linked",
    result.ok ? String(result.data.hubspotOutcome) : "",
  );

  // ═══ 3 · what must STILL be refused ════════════════════════════════════
  console.log("\n── replacing an ESTABLISHED SKU ───────────────────────────");
  const v2 = await currentVersion(leaf.id);
  const replace = await updateLeaf(editForm(leaf.id, v2, `DPS-${tag.toUpperCase()}-9999`));
  check("the replacement is refused", !replace.ok, replace.ok ? "SUCCEEDED" : replace.error.code);
  check(
    "and refused for being established, not for permission",
    !replace.ok && /already established/.test(replace.error.message),
    replace.ok ? "" : replace.error.message.slice(0, 70),
  );
  const unchanged = (
    await sql<{ sku: string | null }[]>`select sku from leaves where id = ${leaf.id}`
  )[0];
  check("and the established SKU is untouched", unchanged?.sku === sku, String(unchanged?.sku));

  // ═══ 4 · the grant was not broadly widened ═════════════════════════════
  console.log("\n── the same edit as a non-PM role ─────────────────────────");
  await setRole("logistics", false);
  const other = await makeLeaf("logistics");
  const denied = await updateLeaf(editForm(other.id, other.version, `DPS-${tag.toUpperCase()}-1002`));
  check("logistics is refused", !denied.ok, denied.ok ? "SUCCEEDED" : denied.error.code);
  check(
    "and refused as FORBIDDEN",
    !denied.ok && denied.error.code === "FORBIDDEN",
    denied.ok ? "" : denied.error.code,
  );
  const untouched = (
    await sql<{ sku: string | null }[]>`select sku from leaves where id = ${other.id}`
  )[0];
  check("and wrote nothing", untouched?.sku === null, String(untouched?.sku));

  // An explicit grant still works for a non-PM role — the one production row
  // that carries it must not have regressed to refused.
  await setRole("logistics", true);
  const granted = await updateLeaf(
    editForm(other.id, await currentVersion(other.id), `DPS-${tag.toUpperCase()}-1003`),
  );
  check(
    "but an explicit grant still passes",
    granted.ok,
    granted.ok ? "" : `${granted.error.code}: ${granted.error.message.slice(0, 60)}`,
  );

  // ═══ 5 · generation stays off ══════════════════════════════════════════
  console.log("\n── auto-generation ────────────────────────────────────────");
  const brands = await listAllocatableBrands();
  check("no brand can allocate", brands.length === 0, `${brands.length} brand(s)`);
  check("the flag is unset", process.env.SKU_GENERATION_ENABLED !== "1");
  // The SKUs above were typed, not issued. Nothing should have been reserved.
  const allocationsAfter = (
    await sql<{ n: number }[]>`select count(*)::int n from sku_allocations`
  )[0].n;
  check(
    "manual completion reserved nothing",
    allocationsAfter === allocationsBefore,
    `${allocationsBefore} -> ${allocationsAfter}`,
  );
} finally {
  await setRole(original.role, original.can_create_leaves);
  await sql`delete from leaves where name like ${`${tag}%`}`;
  console.log(`\n  restored ${PM} to role ${original.role}, grant ${original.can_create_leaves}`);
}

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED\n"
    : `\n${failures} CHECK(S) FAILED\n`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);

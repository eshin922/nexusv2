/**
 * Customer SKU codes in Settings — ISOLATED ENVIRONMENT ONLY.
 *
 *   npm run validation:sku-codes-walk
 *
 * Drives the REAL Settings actions against the isolated database, with the
 * fake HubSpot. What is under test is the set of REFUSALS, and a refusal is
 * only established by attempting the thing it forbids.
 *
 * The one that matters most is the quiet one: a code saved here must NOT be
 * able to issue a SKU. Not because the UI says "awaiting setup" -- because
 * the allocator refuses it. The label and the behaviour are checked
 * separately, since a label is what would still be right if the behaviour
 * were wrong.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55432|localhost:55432/.test(url)) {
  console.error("REFUSING: this walk runs only against the isolated database.");
  process.exit(1);
}

// Admin, because Settings is admin-only. Set before the modules load, since
// the composition layer reads the identity at import time.
process.env.NEXUS_VALIDATION_IDENTITY = "admin";
process.env.SKU_GENERATION_ENABLED = "1";

const sql = postgres(url, { max: 4, prepare: false });
let failures = 0;
const check = (name: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const {
  listCustomerSkuCodes,
  removeCustomerSkuCode,
  saveCustomerSkuCode,
  searchSkuCustomers,
} = await import("../../src/app/actions/sku-registry.ts");
const { allocateSku, customerBrandState } = await import("../../src/lib/sku/allocation.ts");

// Tokens unique per run, so a re-run is not a clash with its own leftovers.
const n = process.pid % 900;
const CODE_A = `WA${n}`;
const CODE_B = `WB${n}`;
const ALPHA = "800000000000001"; // Validation Customer Alpha, from the fake
const BETA = "800000000000002"; // Validation Customer Beta

// A REAL user, because `allocateSku` attributes every reservation to one.
const [{ id: walkUserId }] = await sql<{ id: string }[]>`
  select id from users where clerk_user_id = 'validation_clerk_admin' limit 1
`;

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const save = (companyId: string, customerLabel: string, token: string) =>
  saveCustomerSkuCode(form({ hubspotCompanyId: companyId, customerLabel, token }));

const cleanup = async () => {
  await sql`delete from sku_allocations where token in (${CODE_A}, ${CODE_B})`;
  await sql`delete from sku_counters where token in (${CODE_A}, ${CODE_B})`;
  await sql`delete from sku_brand_registry where token in (${CODE_A}, ${CODE_B})`;
};

// A code is only meaningful against products that do not move. Captured
// before anything runs and compared at the end.
const leavesBefore = (
  await sql<{ n: number; sig: string }[]>`
    select count(*)::int as n, coalesce(md5(string_agg(coalesce(sku,''), '|' order by id)), '') as sig
      from leaves
  `
)[0];

try {
  await cleanup();

  // ═══ 1 · the search ════════════════════════════════════════════════════
  console.log("\n── finding a customer ─────────────────────────────────────");
  const tooShort = await searchSkuCustomers("a");
  check("a one-character query searches nothing", tooShort.ok && tooShort.data.length === 0);

  const found = await searchSkuCustomers("Validation Customer");
  check("the customer directory is searchable", found.ok && found.data.length >= 2,
    found.ok ? `${found.data.length} result(s)` : "failed");
  check(
    "and it is the CUSTOMER list, not the vendor list",
    found.ok && found.data.every((c) => c.companyId.startsWith("8")),
    found.ok ? found.data.map((c) => c.companyId).join(",") : "",
  );

  // ═══ 2 · saving a code ═════════════════════════════════════════════════
  console.log("\n── saving a code ──────────────────────────────────────────");
  const saved = await save(ALPHA, "Validation Customer Alpha", CODE_A.toLowerCase());
  check("a code saves", saved.ok, saved.ok ? "" : saved.error.message.slice(0, 80));
  check(
    "and normalizes to upper case",
    saved.ok && saved.data.token === CODE_A,
    saved.ok ? saved.data.token : "",
  );

  const row = (
    await sql<{ status: string; hubspot_company_id: string; approved_by_user_id: string | null }[]>`
      select status, hubspot_company_id, approved_by_user_id
        from sku_brand_registry where token = ${CODE_A}
    `
  )[0];
  check("it is approved", row?.status === "approved", String(row?.status));
  check("bound to the company RECORD", row?.hubspot_company_id === ALPHA, String(row?.hubspot_company_id));
  check("and records who approved it", row?.approved_by_user_id !== null);

  const counters = (
    await sql<{ n: number }[]>`select count(*)::int n from sku_counters where token = ${CODE_A}`
  )[0].n;
  check("NO counter was created", counters === 0, `${counters} counter row(s)`);

  // ═══ 3 · awaiting setup is a BEHAVIOUR, not a label ════════════════════
  console.log("\n── it cannot issue yet ────────────────────────────────────");
  const state = await customerBrandState(ALPHA);
  check("the customer reads as awaiting setup", state.kind === "awaiting_setup", state.kind);

  const blocked = await allocateSku({
    token: CODE_A,
    attemptKey: `codes-walk:${n}:blocked`,
    userId: walkUserId,
  });
  check("the allocator REFUSES it", !blocked.ok, blocked.ok ? "ISSUED " + blocked.sku : blocked.refusal.kind);
  check(
    "and refuses for the counter, not for approval",
    !blocked.ok && blocked.refusal.kind === "counter_not_seeded",
    blocked.ok ? "" : blocked.refusal.kind,
  );

  const listed = await listCustomerSkuCodes();
  const mine = listed.ok ? listed.data.find((c) => c.token === CODE_A) : undefined;
  check("Settings shows it as awaiting setup", mine?.readiness === "awaiting_setup", String(mine?.readiness));
  check("with nothing issued", mine?.issuedCount === 0, String(mine?.issuedCount));

  // ═══ 4 · the refusals ══════════════════════════════════════════════════
  console.log("\n── what it will not accept ────────────────────────────────");
  const dupToken = await save(BETA, "Validation Customer Beta", CODE_A);
  check("the same code for a second customer is refused", !dupToken.ok);
  check(
    "and names who holds it",
    !dupToken.ok && dupToken.error.message.includes("Validation Customer Alpha"),
    dupToken.ok ? "" : dupToken.error.message.slice(0, 80),
  );

  const secondCode = await save(ALPHA, "Validation Customer Alpha", CODE_B);
  check("a second code for the same customer is refused", !secondCode.ok);
  check(
    "and names the code they already have",
    !secondCode.ok && secondCode.error.message.includes(CODE_A),
    secondCode.ok ? "" : secondCode.error.message.slice(0, 80),
  );

  for (const [label, bad] of [
    ["a digit first", "1ABC"],
    ["punctuation", "AB-CD"],
    ["a single character", "A"],
    ["too long", "ABCDEFGHIJKLM"],
    ["empty", ""],
  ] as const) {
    const r = await save(BETA, "Validation Customer Beta", bad);
    check(`refuses ${label}`, !r.ok, r.ok ? "ACCEPTED " + r.data.token : "");
  }

  const noCustomer = await saveCustomerSkuCode(form({ token: CODE_B, customerLabel: "x" }));
  check("refuses a code with no customer", !noCustomer.ok);

  // The search marks a company that already has one, so the UI can stop the
  // operator before the refusal rather than after.
  const again = await searchSkuCustomers("Validation Customer Alpha");
  const alpha = again.ok ? again.data.find((c) => c.companyId === ALPHA) : undefined;
  check("the search reports the existing code", alpha?.existingToken === CODE_A, String(alpha?.existingToken));

  // ═══ 5 · removal, and what protects it ═════════════════════════════════
  console.log("\n── removing ──────────────────────────────────────────────");
  const removable = await removeCustomerSkuCode(form({ token: CODE_A }));
  check("an unused code can be removed", removable.ok, removable.ok ? "" : removable.error.message.slice(0, 70));
  const goneCount = (
    await sql<{ n: number }[]>`select count(*)::int n from sku_brand_registry where token = ${CODE_A}`
  )[0].n;
  check("and is gone", goneCount === 0);

  // Re-save, then seed it, and removal must stop.
  await save(ALPHA, "Validation Customer Alpha", CODE_A);
  await sql`
    insert into sku_counters (token, next_number, seed_basis, seeded_at)
    values (${CODE_A}, 1001, ${sql.json({ walk: true })}, now())
  `;
  const seededRemove = await removeCustomerSkuCode(form({ token: CODE_A }));
  check("a SEEDED code cannot be removed", !seededRemove.ok,
    seededRemove.ok ? "REMOVED" : seededRemove.error.message.slice(0, 60));

  const ready = await customerBrandState(ALPHA);
  check("and now reads as ready", ready.kind === "ready", ready.kind);

  const issued = await allocateSku({
    token: CODE_A,
    attemptKey: `codes-walk:${n}:issue`,
    userId: walkUserId,
  });
  check("a seeded code issues", issued.ok, issued.ok ? issued.sku : issued.refusal.kind);

  const usedRemove = await removeCustomerSkuCode(form({ token: CODE_A }));
  check("a code that has ISSUED cannot be removed", !usedRemove.ok,
    usedRemove.ok ? "REMOVED" : usedRemove.error.message.slice(0, 60));

  const after = await listCustomerSkuCodes();
  const nowRow = after.ok ? after.data.find((c) => c.token === CODE_A) : undefined;
  check("Settings shows it ready", nowRow?.readiness === "ready", String(nowRow?.readiness));
  check("and counts what it issued", nowRow?.issuedCount === 1, String(nowRow?.issuedCount));

  // ═══ 5b · who may do any of this ═══════════════════════════════════════
  //
  // The guard is one line in `requireAdminAction`, and one line is exactly the
  // kind of thing that gets removed by a refactor without anything failing.
  // Every action is asked AS A NON-ADMIN here, because a guard that has only
  // ever been called by someone who passes it has not been shown to refuse.
  //
  // The identity provider reads the environment per call, so flipping it mid
  // walk changes who is asking without rebuilding the composition.
  console.log("\n── as a PM, not an admin ─────────────────────────────────");
  process.env.NEXUS_VALIDATION_IDENTITY = "pm";

  const whoami = (
    await sql<{ role: string }[]>`
      select role from users where clerk_user_id = 'validation_clerk_pm'
    `
  )[0];
  check("the second identity really is a non-admin", whoami?.role === "pm", String(whoami?.role));

  const asPm: [string, Promise<{ ok: boolean; error?: { code: string } }>][] = [
    ["list", listCustomerSkuCodes()],
    ["search", searchSkuCustomers("Validation Customer")],
    ["save", save(BETA, "Validation Customer Beta", CODE_B)],
    ["remove", removeCustomerSkuCode(form({ token: CODE_A }))],
  ];
  for (const [name, call] of asPm) {
    const r = await call;
    check(`a PM cannot ${name}`, !r.ok, r.ok ? "ALLOWED" : (r.error?.code ?? ""));
    check(
      `  and is refused as FORBIDDEN, not as a validation slip`,
      !r.ok && r.error?.code === "FORBIDDEN",
      r.ok ? "" : (r.error?.code ?? ""),
    );
  }

  // The refused save must have written NOTHING -- a refusal that still left a
  // row would be the worst version of this.
  const leaked = (
    await sql<{ n: number }[]>`select count(*)::int n from sku_brand_registry where token = ${CODE_B}`
  )[0].n;
  check("and the refused save left no row behind", leaked === 0, `${leaked} row(s)`);

  process.env.NEXUS_VALIDATION_IDENTITY = "admin";

  // ═══ 6 · products never moved ══════════════════════════════════════════
  console.log("\n── products ──────────────────────────────────────────────");
  const leavesAfter = (
    await sql<{ n: number; sig: string }[]>`
      select count(*)::int as n, coalesce(md5(string_agg(coalesce(sku,''), '|' order by id)), '') as sig
        from leaves
    `
  )[0];
  check("no product was added or removed", leavesAfter.n === leavesBefore.n,
    `${leavesBefore.n} -> ${leavesAfter.n}`);
  check("and not one existing SKU changed", leavesAfter.sig === leavesBefore.sig);
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);

/**
 * Create-path walk — ISOLATED ENVIRONMENT ONLY.
 *
 * Drives the REAL `createLeaf` through real failures. The allocator and the
 * binder each have their own coverage, and neither establishes this: what is
 * being tested here is the ORDER of a sequence that spans two systems, and the
 * only thing that exercises an ordering is running it.
 *
 *   npm run validation:sku-create-walk
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

process.env.SKU_GENERATION_ENABLED = "1";
const { allocateSku } = await import("../../src/lib/sku/allocation.ts");
const { createLeaf } = await import("../../src/app/actions/leaves.ts");
const { setFakeHubSpotScenario, resetFakeHubSpot, setFakeHubSpotProductSequence } =
  await import("../../tests/harness/providers/fake-hubspot.ts");

// The seeded fixtures were created through this same fake, so its ids from
// zero are already taken. Start well above them.
const SEQ_BASE = 900000 + (process.pid % 1000) * 100;
setFakeHubSpotProductSequence(SEQ_BASE);

const userId = (await sql`select id from users limit 1`)[0]?.id ?? null;
const tag = `cw${process.pid}`;
const key = (s: string) => `create-walk:${s}:${process.pid}`;

const form = (over: Record<string, string>) => {
  const fd = new FormData();
  fd.set("name", `create walk ${tag}`);
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
};

const allocFor = async (k: string) => {
  const a = await allocateSku({ token: "TEST", attemptKey: key(k), userId });
  if (!a.ok) throw new Error(`could not allocate for ${k}: ${a.refusal.kind}`);
  return a;
};
const row = async (id: string) =>
  (await sql`select state, sku, hubspot_product_id, note, leaf_id from sku_allocations where id = ${id}`)[0];

// ═══ 1 · uncertain create ════════════════════════════════════════════════
console.log("\n── HubSpot never answers ──────────────────────────────────");
const a1 = await allocFor("uncertain");
setFakeHubSpotScenario("timeout");
const r1 = await createLeaf(form({ sku: a1.sku, skuAllocationId: a1.allocationId }));
setFakeHubSpotScenario(null);

check("the create is refused", !r1.ok, r1.ok ? "SUCCEEDED" : r1.error.code);
const s1 = await row(a1.allocationId);
check("the reservation is HELD, not released", s1.state === "conflicted", String(s1.state));
check("and it records why", /outcome unknown/.test(String(s1.note ?? "")), String(s1.note).slice(0, 60));
check(
  "no product was written locally",
  (await sql`select count(*)::int n from leaves where sku = ${a1.sku}`)[0].n === 0,
);

console.log("\n── the blind retry is blocked ─────────────────────────────");
const r1b = await createLeaf(form({ sku: a1.sku, skuAllocationId: a1.allocationId }));
check("a second create on the held reservation is refused", !r1b.ok, r1b.ok ? "SUCCEEDED" : r1b.error.code);
check(
  "and says so rather than failing obscurely",
  !r1b.ok && /unresolved/i.test(r1b.error.message),
  r1b.ok ? "" : r1b.error.message.slice(0, 70),
);
const reAlloc = await allocateSku({ token: "TEST", attemptKey: key("uncertain"), userId });
check(
  "re-generating for the same intent refuses too",
  !reAlloc.ok && reAlloc.refusal.kind === "unresolved",
  reAlloc.ok ? "REISSUED" : reAlloc.refusal.kind,
);

// ═══ 2 · rejected create ═════════════════════════════════════════════════
console.log("\n── HubSpot answers and refuses ────────────────────────────");
const a2 = await allocFor("rejected");
setFakeHubSpotScenario("product-create-rejected");
const r2 = await createLeaf(form({ sku: a2.sku, skuAllocationId: a2.allocationId }));
setFakeHubSpotScenario(null);
check("the create is refused", !r2.ok, r2.ok ? "SUCCEEDED" : r2.error.code);
const s2 = await row(a2.allocationId);
check(
  "an ANSWERED refusal leaves the reservation usable",
  s2.state === "allocated",
  String(s2.state),
);
check("and clears the dispatch mark", s2.note === null, String(s2.note));

console.log("\n── and the corrected retry then works ─────────────────────");
const r2b = await createLeaf(form({ sku: a2.sku, skuAllocationId: a2.allocationId }));
check("the retry succeeds", r2b.ok, r2b.ok ? "" : r2b.error.message.slice(0, 60));
const s2b = await row(a2.allocationId);
check("the reservation is applied", s2b.state === "applied", String(s2b.state));
check("and bound to the product", s2b.leaf_id !== null);

// ═══ 3 · collisions on Create ════════════════════════════════════════════
console.log("\n── a typed SKU that is already taken ──────────────────────");
const dupe = await createLeaf(form({ sku: String(s2b.sku) }));
check(
  "a manual SKU matching a saved product is refused",
  !dupe.ok && /already belongs/.test(dupe.error.message),
  dupe.ok ? "ACCEPTED" : dupe.error.message.slice(0, 50),
);
const lower = await createLeaf(form({ sku: String(s2b.sku).toLowerCase() }));
check(
  "and the check is normalized, not case-sensitive",
  !lower.ok && /already belongs/.test(lower.error.message),
  lower.ok ? "ACCEPTED" : lower.error.message.slice(0, 50),
);

console.log("\n── a typed SKU that is merely RESERVED ────────────────────");
const a3 = await allocFor("reserved-typed");
const typedOverReserved = await createLeaf(form({ sku: a3.sku }));
check(
  "a manual SKU matching another intent's reservation is refused",
  !typedOverReserved.ok && /reserved/i.test(typedOverReserved.error.message),
  typedOverReserved.ok ? "ACCEPTED" : typedOverReserved.error.message.slice(0, 60),
);
check(
  "and no product was created for it",
  (await sql`select count(*)::int n from leaves where sku = ${a3.sku}`)[0].n === 0,
);

// ═══ 4 · HubSpot succeeded, the local save failed ════════════════════════
console.log("\n── the product exists there and not here ──────────────────");
// Forced deterministically: the fake mints ids from a sequence that
// `resetFakeHubSpot` returns to zero, so pre-inserting a leaf carrying the id
// it is about to mint makes the local insert collide on
// `leaves_hubspot_product_id_idx` AFTER HubSpot has already created.
// Next id the fake will mint, computed rather than assumed.
setFakeHubSpotProductSequence(SEQ_BASE + 500);
const collidingId = `998${String(SEQ_BASE + 501).padStart(12, "0")}`;
await sql`
  insert into leaves (name, sku, archived, hubspot_product_id)
  values (${"create walk decoy"}, ${`DECOY-${tag}`}, false, ${collidingId})`;

const a4 = await allocFor("local-fail");
let threw = false;
try {
  await createLeaf(form({ sku: a4.sku, skuAllocationId: a4.allocationId }));
} catch {
  // A constraint violation is a genuine fault and propagates, by the action
  // layer's own rule. What matters here is what it left behind.
  threw = true;
}
const s4 = await row(a4.allocationId);
check("the local save failed", threw);
check("the reservation is HELD", s4.state === "conflicted", String(s4.state));
check(
  "and records the HubSpot product that DOES exist",
  s4.hubspot_product_id === collidingId,
  String(s4.hubspot_product_id),
);
check(
  "it says the product was created but not saved",
  /local save failed/.test(String(s4.note ?? "")),
  String(s4.note).slice(0, 60),
);
check(
  "nothing adopted it — no local product carries the reserved SKU",
  (await sql`select count(*)::int n from leaves where sku = ${a4.sku}`)[0].n === 0,
);

// ═══ 5 · the support listing sees them ═══════════════════════════════════
console.log("\n── the support listing ────────────────────────────────────");
const unresolved = await sql`
  select sku, state, hubspot_product_id, note from sku_allocations
  where state = 'conflicted' or (state = 'allocated' and note like 'dispatched:%')`;
check(
  "both held reservations appear in the unresolved set",
  unresolved.some((u) => u.sku === a1.sku) && unresolved.some((u) => u.sku === a4.sku),
  `${unresolved.length} unresolved`,
);
check(
  "and the one with a known product id carries it",
  unresolved.find((u) => u.sku === a4.sku)?.hubspot_product_id === collidingId,
);

console.log("\n── cleanup ────────────────────────────────────────────────");
// Pid-independent: an aborted run must not leave state that poisons the next
// one, and the fake mints the same product ids from zero in every process.
await sql`delete from sku_allocations where attempt_key like ${"create-walk:%"}`;
await sql`delete from leaves where name like ${"create walk %"}`;
await sql`update sku_counters set next_number = 1001 where token = 'TEST'`;
resetFakeHubSpot();
console.log("  isolated fixtures reset");

console.log(`\n${failures === 0 ? "CREATE WALK PASSED" : `CREATE WALK FAILED — ${failures} check(s)`}\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);

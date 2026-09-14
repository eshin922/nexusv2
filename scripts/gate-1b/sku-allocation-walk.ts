/**
 * Allocation walk — ISOLATED ENVIRONMENT ONLY.
 *
 * Exercises the database-bound half of allocation against real Postgres,
 * because its behaviour IS the constraints: two unique indexes and a row lock.
 * Asserting those against a mock would only prove the mock.
 *
 *   npm run validation:sku-walk
 *
 * Refuses to run against anything but the local Docker validation database.
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

// The walk drives the real module. Importing it pulls `server-only`, so the
// allocation logic is re-expressed here against the same tables ONLY where the
// module cannot be imported; everything else calls through.
process.env.SKU_GENERATION_ENABLED = "1";
const { allocateSku, generationFlagEnabled } = await import("../../src/lib/sku/allocation.ts");

const userId = (await sql`select id from users limit 1`)[0]?.id ?? null;
const key = (s: string) => `walk:${s}:${process.pid}`;

console.log("\n── the gate ───────────────────────────────────────────────");
check("flag reads enabled when set", generationFlagEnabled());

process.env.SKU_GENERATION_ENABLED = "";
const offOutcome = await allocateSku({ token: "TEST", attemptKey: key("off"), userId });
check(
  "refuses with the flag unset, even for an approved seeded brand",
  !offOutcome.ok && offOutcome.refusal.kind === "disabled",
  offOutcome.ok ? "ALLOCATED ANYWAY" : offOutcome.refusal.kind,
);
process.env.SKU_GENERATION_ENABLED = "1";

console.log("\n── refusals that are not the flag ─────────────────────────");
const unknown = await allocateSku({ token: "NOPE", attemptKey: key("unknown"), userId });
check(
  "refuses an unregistered token",
  !unknown.ok && unknown.refusal.kind === "brand_not_registered",
  unknown.ok ? "allocated" : unknown.refusal.kind,
);

const proposed = await allocateSku({ token: "PROP", attemptKey: key("proposed"), userId });
check(
  "refuses a proposed-but-unapproved brand",
  !proposed.ok && proposed.refusal.kind === "brand_not_approved",
  proposed.ok ? "allocated" : proposed.refusal.kind,
);

const unseeded = await allocateSku({ token: "UNSD", attemptKey: key("unseeded"), userId });
check(
  "refuses an approved brand whose counter was never seeded",
  !unseeded.ok && unseeded.refusal.kind === "counter_not_seeded",
  unseeded.ok ? "allocated" : unseeded.refusal.kind,
);

const noBrand = await allocateSku({ token: "", attemptKey: key("nobrand"), userId });
check(
  "refuses with no brand rather than picking a default",
  !noBrand.ok && noBrand.refusal.kind === "brand_required",
  noBrand.ok ? "allocated" : noBrand.refusal.kind,
);

console.log("\n── allocation ─────────────────────────────────────────────");
const first = await allocateSku({ token: "TEST", attemptKey: key("first"), userId });
check("allocates for an approved, seeded brand", first.ok, first.ok ? first.sku : "refused");
const firstSku = first.ok ? first.sku : "";
check("the SKU is the catalog shape", /^DPS-TEST-\d{4,}$/.test(firstSku), firstSku);

const second = await allocateSku({ token: "TEST", attemptKey: key("second"), userId });
check(
  "a different intent gets a different number",
  second.ok && second.sku !== firstSku,
  second.ok ? second.sku : "refused",
);

console.log("\n── idempotence: the property that survives a retry ────────");
const retry = await allocateSku({ token: "TEST", attemptKey: key("first"), userId });
check(
  "the SAME attempt key returns the SAME allocation, not a second number",
  retry.ok && first.ok && retry.sku === first.sku && retry.allocationId === first.allocationId,
  retry.ok ? retry.sku : "refused",
);

console.log("\n── concurrency ────────────────────────────────────────────");
const raceKeys = [1, 2, 3, 4, 5].map((i) => key("race" + i));
const raced = await Promise.all(
  raceKeys.map((k) => allocateSku({ token: "TEST", attemptKey: k, userId })),
);
const racedSkus = raced.filter((r) => r.ok).map((r) => (r as { sku: string }).sku);
check(
  "five concurrent DIFFERENT intents get five distinct SKUs",
  new Set(racedSkus).size === 5,
  `${new Set(racedSkus).size} distinct of ${racedSkus.length}`,
);

const oneKey = key("one-intent-many-retries");
const sameKeyRace = await Promise.all(
  [1, 2, 3, 4, 5].map(() => allocateSku({ token: "TEST", attemptKey: oneKey, userId })),
);
const sameSkus = new Set(sameKeyRace.filter((r) => r.ok).map((r) => (r as { sku: string }).sku));
const allocRows = await sql`
  select count(*)::int n from sku_allocations where attempt_key = ${oneKey}`;
check(
  "five CONCURRENT retries of ONE intent yield exactly one allocation",
  sameSkus.size === 1 && allocRows[0].n === 1,
  `${sameSkus.size} distinct sku, ${allocRows[0].n} rows`,
);

console.log("\n── the catalog cannot be collided with ────────────────────");
const counterNow = (await sql`select next_number from sku_counters where token='TEST'`)[0]
  .next_number as number;
const blocker = `DPS-TEST-${String(counterNow).padStart(4, "0")}`;
await sql`
  insert into leaves (name, sku, archived)
  values (${"walk blocker"}, ${blocker}, false)
  on conflict do nothing`;
const skipped = await allocateSku({ token: "TEST", attemptKey: key("skip"), userId });
check(
  "advances past a number already taken in the catalog",
  skipped.ok && skipped.sku !== blocker,
  skipped.ok ? `${blocker} taken -> issued ${skipped.sku}` : "refused",
);

console.log("\n── cleanup ────────────────────────────────────────────────");
await sql`delete from sku_allocations where attempt_key like ${"walk:%:" + process.pid}`;
await sql`delete from leaves where sku = ${blocker}`;
await sql`update sku_counters set next_number = 1001 where token = 'TEST'`;
console.log("  isolated fixtures reset");

console.log(`\n${failures === 0 ? "WALK PASSED" : `WALK FAILED — ${failures} check(s)`}\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);

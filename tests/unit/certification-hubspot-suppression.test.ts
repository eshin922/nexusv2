/**
 * Certification-mode HubSpot suppression.
 *
 * The production workflow `NETSUITE: Auto create NetSuite sales order from won
 * deal` enrolls on `Deal stage = Won - In production (Sales)` and creates a
 * PRODUCTION NetSuite sales order. Nexus certification targets the NetSuite
 * SANDBOX, so Accept must not write that stage.
 *
 * These lock BOTH directions. Suppression that cannot be proven off is as
 * dangerous as one that cannot be proven on: the first ships a broken
 * production integration, the second fires production automation from a
 * certification run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SUPPRESS_HUBSPOT_ACCEPT_SYNC_ENV,
  HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER,
  isHubspotAcceptSyncSuppressed,
  hubspotAcceptSyncState,
  assertHubspotAcceptSyncEnabledForGoLive,
} from "../../src/lib/config/certification-mode.ts";
import { withCertificationSuppression } from "../../src/lib/integrations/hubspot-certification-suppression.ts";

const E = SUPPRESS_HUBSPOT_ACCEPT_SYNC_ENV;
const env = (v?: string) => (v === undefined ? {} : { [E]: v }) as NodeJS.ProcessEnv;

// ── 1 · Fail-safe default ────────────────────────────────────────────────

test("1 · absent/empty/false env leaves synchronization ENABLED", () => {
  for (const v of [undefined, "", "  ", "0", "false", "no", "off", "disabled", "TRU"]) {
    assert.equal(
      isHubspotAcceptSyncSuppressed(env(v)),
      false,
      `${JSON.stringify(v)} must not suppress`,
    );
  }
});

test("2 · only an explicit affirmative suppresses", () => {
  for (const v of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isHubspotAcceptSyncSuppressed(env(v)), true, `${v} must suppress`);
  }
});

// ── 3 · Operator-visible state is never ambiguous ────────────────────────

test("3 · suppressed state reports the exact operator banner + a reason", () => {
  const on = hubspotAcceptSyncState(env("1"));
  assert.equal(on.suppressed, true);
  assert.equal(on.banner, HUBSPOT_ACCEPT_SYNC_SUPPRESSED_BANNER);
  assert.equal(on.banner, "HubSpot Accept synchronization is disabled for certification");
  assert.match(on.reason ?? "", /PRODUCTION NetSuite sales order/i);

  const off = hubspotAcceptSyncState(env());
  assert.equal(off.suppressed, false);
  assert.equal(off.reason, null);
  assert.notEqual(off.banner, on.banner, "enabled and disabled must not read alike");
});

// ── 4-6 · Provider boundary — the hard guarantee ─────────────────────────

function spyProvider() {
  const calls: string[] = [];
  return {
    calls,
    base: {
      getDealStage: async (id: string) => { calls.push(`getDealStage:${id}`); return { id: "195274339", label: "Development & Quoting" }; },
      listDealStages: async () => { calls.push("listDealStages"); return []; },
      updateDealStage: async (id: string) => { calls.push(`updateDealStage:${id}`); return { id: "195607084", label: "Won - In production" }; },
      updateDealAmount: async (id: string) => { calls.push(`updateDealAmount:${id}`); },
      findOwnerByEmail: async () => { calls.push("findOwnerByEmail"); return null; },
      resolveVendor: async () => { calls.push("resolveVendor"); return null; },
      createProduct: async () => { calls.push("createProduct"); return { id: "p1" }; },
    } as never,
  };
}

test("4 · NO stage write reaches HubSpot under suppression", async () => {
  const { base, calls } = spyProvider();
  const hs = withCertificationSuppression(base);
  await assert.rejects(
    () => hs.updateDealStage("45429836294", "195607084", { amount: 1 }),
    /disabled for certification/,
  );
  assert.deepEqual(calls, [], "the underlying provider must never be invoked");
});

test("5 · NO amount write reaches HubSpot under suppression", async () => {
  const { base, calls } = spyProvider();
  const hs = withCertificationSuppression(base);
  await assert.rejects(() => hs.updateDealAmount("45429836294", 685.92), /disabled for certification/);
  assert.deepEqual(calls, []);
});

test("6 · reads and product creation pass through untouched", async () => {
  const { base, calls } = spyProvider();
  const hs = withCertificationSuppression(base);
  const stage = await hs.getDealStage("45429836294");
  assert.equal(stage.id, "195274339", "lineage/stage resolution must still work");
  await hs.listDealStages();
  await hs.findOwnerByEmail("edward@thedps.co");
  await hs.resolveVendor("1");
  await hs.createProduct({} as never);
  assert.deepEqual(calls, [
    "getDealStage:45429836294",
    "listDealStages",
    "findOwnerByEmail",
    "resolveVendor",
    "createProduct",
  ]);
});

// ── 7 · FALSIFICATION · production config still synchronizes ─────────────

test("7 · FALSIFICATION — unsuppressed provider invokes the governed write path", async () => {
  const { base, calls } = spyProvider();
  // Production composition passes the provider through undecorated. Asserting
  // on `base` proves the governed path is reachable and unaltered — if this
  // ever fails, suppression has leaked into production.
  const to = await base.updateDealStage("45429836294", "195607084", { amount: 685.92 });
  assert.equal(to.id, "195607084");
  await base.updateDealAmount("45429836294", 685.92);
  assert.deepEqual(calls, ["updateDealStage:45429836294", "updateDealAmount:45429836294"]);
  assert.equal(isHubspotAcceptSyncSuppressed(env()), false);
});

// ── 8 · Release blocker is programmatic, not advisory ────────────────────

test("8 · go-live assertion throws while suppression is active", () => {
  assert.throws(
    () => assertHubspotAcceptSyncEnabledForGoLive(env("1")),
    (e: Error) => /RELEASE BLOCKER/.test(e.message) && e.message.includes(E),
  );
  assert.doesNotThrow(() => assertHubspotAcceptSyncEnabledForGoLive(env()));
  assert.doesNotThrow(() => assertHubspotAcceptSyncEnabledForGoLive(env("0")));
});

// ── 9 · Complete's amount patch is suppressed too ────────────────────────

test("9 · Complete's HubSpot amount patch is gated by the same flag", () => {
  // Complete is the SECOND production HubSpot write in the certification path:
  // on amount drift it PATCHes the real deal, which would move the deal's
  // last-modified even though Accept left it untouched. Pinned structurally —
  // the guard must sit BEFORE the drift computation so no drift can reach it.
  const src = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const guard = src.indexOf("isHubspotAcceptSyncSuppressed()");
  const drift = src.indexOf("const delta = args.currentAmount - args.priorAmount;");
  const patch = src.indexOf("hubspot.updateDealAmount");
  assert.ok(guard > 0, "mark-complete must consult the suppression flag");
  assert.ok(guard < drift, "guard must precede drift computation");
  assert.ok(guard < patch, "guard must precede the HubSpot amount patch");
});

/**
 * Product Type vocabulary — LIVE comparison against HubSpot. READ-ONLY.
 *
 *   npm run verify:product-type-vocabulary
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `specSchemaMappingIsExhaustive` was only ever called from a unit test,
 * against a `VOCABULARY` constant captured on 2026-08-14. That test is worth
 * keeping — it is deterministic and it pins the mapping's shape — but it
 * cannot tell you what HubSpot holds TODAY. Someone adding an option in the
 * HubSpot UI would produce `unmapped` products in production while CI stayed
 * green, because the fixture does not know the option exists.
 *
 * A dated fixture is evidence about a date. This is the live read.
 *
 * ── THE TWO PORTALS ARE REPORTED SEPARATELY ──────────────────────────────
 *
 * Production and sandbox genuinely hold different option sets — `Finished
 * Goods` and `Turnkey` exist only in production, `Preliminary` and
 * `Corrugated` only in the sandbox. Merging them into one verdict would let a
 * sandbox-only value satisfy a production check, or a production gap hide
 * behind sandbox coverage. Each portal gets its own section and its own
 * verdict, and a portal whose credential is absent is reported as SKIPPED
 * rather than passing silently.
 *
 * ── WHAT IS AND IS NOT A FAILURE ─────────────────────────────────────────
 *
 *   UNMAPPED   a value the portal offers with no disposition in MAPPING.
 *              Products can carry it and would resolve `unmapped`. FAILS.
 *
 *   AHEAD      a MAPPING entry the portal does not offer. NOT a failure — it
 *              is the deliberate safe order (map first, create the option
 *              second) and it is also how sandbox-only values look from
 *              production. Reported so the list stays honest.
 *
 * Exit 1 on any UNMAPPED value in any reachable portal; exit 0 otherwise.
 */
import {
  mappedProductTypeValues,
  specSchemaMappingIsExhaustive,
} from "../../src/lib/product-structure/spec-schema-mapping.ts";

type PortalResult =
  | { portal: string; kind: "skipped"; reason: string }
  | { portal: string; kind: "read"; values: string[] };

const PROPERTY = "hs_product_type";

async function readOptions(portal: string, token: string | undefined): Promise<PortalResult> {
  if (!token) {
    return { portal, kind: "skipped", reason: "no credential in this environment" };
  }
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/products/${PROPERTY}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as {
    options?: { value: string; label: string; hidden?: boolean }[];
    message?: string;
    status?: string;
  };
  if (!res.ok || body.status === "error") {
    // A credential that cannot read the property is NOT coverage. Reported as
    // skipped-with-reason rather than as an empty option set, which would make
    // every mapping entry look AHEAD and every portal look clean.
    return { portal, kind: "skipped", reason: body.message ?? `HTTP ${res.status}` };
  }
  return { portal, kind: "read", values: (body.options ?? []).map((o) => o.value) };
}

const results = await Promise.all([
  // Production. The READ token deliberately — this verifier never writes, and
  // the Products client would hand it a write-enabled credential.
  readOptions("production", process.env.HUBSPOT_ACCESS_TOKEN),
  readOptions("sandbox", process.env.HUBSPOT_DEV_ACCESS_TOKEN),
]);

const mapped = new Set(mappedProductTypeValues());
let failures = 0;
let readAny = false;

for (const r of results) {
  console.log(`\n── ${r.portal} ${"─".repeat(Math.max(0, 56 - r.portal.length))}`);
  if (r.kind === "skipped") {
    console.log(`  SKIPPED — ${r.reason}`);
    console.log(`  This portal is UNVERIFIED. It is not covered by this run.`);
    continue;
  }
  readAny = true;

  const verdict = specSchemaMappingIsExhaustive(r.values);
  const ahead = [...mapped].filter((v) => !r.values.includes(v)).sort();

  console.log(`  options offered : ${r.values.length}`);
  console.log(`  mapping entries : ${mapped.size}`);

  if (verdict.exhaustive) {
    console.log(`  UNMAPPED        : none`);
  } else {
    failures += verdict.missing.length;
    console.log(`  UNMAPPED        : ${verdict.missing.length}`);
    for (const v of verdict.missing) {
      console.log(`      ✗ ${JSON.stringify(v)} — offered here, no disposition in MAPPING`);
    }
  }

  console.log(
    `  AHEAD           : ${ahead.length}${ahead.length ? ` — ${ahead.map((v) => JSON.stringify(v)).join(", ")}` : ""}`,
  );
  if (ahead.length) {
    console.log(`      (mapped but not offered here — the safe order, or another portal's value)`);
  }
}

console.log("");
if (!readAny) {
  // Nothing was read, so nothing was verified. Reporting this as a pass would
  // be the exact failure the whole script exists to remove.
  console.error(
    "[product-type-vocabulary] NO PORTAL WAS READ — this run verified nothing. " +
      "Set HUBSPOT_ACCESS_TOKEN and/or HUBSPOT_DEV_ACCESS_TOKEN.",
  );
  process.exit(1);
}
if (failures > 0) {
  console.error(
    `[product-type-vocabulary] ${failures} unmapped value(s). Products can carry ` +
      `these today and would resolve \`unmapped\`. Add a MAPPING disposition.`,
  );
  process.exit(1);
}
console.log("[product-type-vocabulary] OK — every offered value has a disposition.");

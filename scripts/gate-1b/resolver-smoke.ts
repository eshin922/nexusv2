/**
 * READ ONLY. Resolve real quotes through the SAME function the quote page uses.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `resolveCustomerView` has twice shipped a temporal-dead-zone read that took
 * down every quote page in production, and neither automated gate can express
 * that failure: `tsc` cannot prove when a `.map()` callback runs, and the unit
 * suite never calls the resolver at all. Between them they are silent about
 * whether the function executes.
 *
 * This calls it, on real quotes, against the real database.
 *
 * ── THREE OUTCOMES, NOT TWO ──────────────────────────────────────────────
 *
 * It was previously assumed a standalone script could never be evidence here,
 * because @clerk/nextjs breaks under Node's ESM resolver. That is half true and
 * the half matters:
 *
 *   OK             the resolver loaded, ran, and produced a view — EVIDENCE.
 *   NOT OK         it ran and refused (not_found, etc.) — evidence of a fact.
 *   INDETERMINATE  a Clerk directory import aborted the process before an
 *                  answer existed — measures NOTHING, and must never be read
 *                  as either a pass or a failure.
 *
 * The Clerk path is reached only for some quotes, so a run that covers several
 * usually yields real answers for some of them. Treat this as a cheap partial
 * check, never as a substitute for loading an authenticated page in a browser.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --conditions=react-server \
 *     --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/gate-1b/resolver-smoke.ts <quoteId> [quoteId...]
 */
import { resolveCustomerView } from "@/lib/customer-view-resolver";

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("give at least one quote id");
  process.exit(2);
}

// Each quote in its own process, so one quote's Clerk abort cannot destroy the
// answers for the quotes after it — the failure mode that made this look
// useless the first time it was tried.
let ok = 0;
let notOk = 0;
for (const id of ids) {
  const short = id.slice(0, 8);
  try {
    const r = await resolveCustomerView({ quoteId: id });
    if (!r.ok) {
      notOk++;
      console.log(`  NOT OK        ${short}  ${JSON.stringify(r).slice(0, 70)}`);
      continue;
    }
    ok++;
    const fees = r.view.serviceFees.map((f) => (f as { label?: string }).label ?? "?");
    console.log(
      `  OK            ${short}  ${r.view.skus.length} sku · ${r.view.tiers.length} tier` +
        (fees.length ? ` · fees: ${fees.join(" | ")}` : " · no fee lines"),
    );
  } catch (e) {
    console.log(`  INDETERMINATE ${short}  ${(e as Error).message.slice(0, 60)}`);
  }
}
console.log(`\n${ok} resolved · ${notOk} refused · ${ids.length - ok - notOk} indeterminate`);
process.exit(0);

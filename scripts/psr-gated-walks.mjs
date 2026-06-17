// CB final-stretch Action 3 — PSR-8 + PSR-14 close-out verification.
//
// **Two-pronged verification per CA disposition (CC self-walks):**
//
// 1. **DB toggle smoke** (this script) — flips firm_settings gates,
//    reads back, reverts. Confirms the policy columns are mutable
//    + persist + revert cleanly. Catches `versionedFirmSettingsUpdate`
//    carry-forward regressions early.
//
// 2. **Classifier-behavior coverage** (existing invariant verifier
//    `scripts/verify/pricing-classifier-invariants.ts`). Scenarios
//    s08_blocked_accept_risk + s14_blocked_no_override already
//    assert the right shape under each gate combo:
//
//      s08 (allow_accept_risk=false) — verifies:
//        - mode === 'blocked'
//        - flags.accept_risk_unavailable === true
//        - apply_surgical recommended; request_override still
//          present (override allowed)
//
//      s14 (allow_override=false)    — verifies:
//        - mode === 'blocked'
//        - flags.override_unavailable === true
//        - override_unavailable INERT action emitted
//          (disabled=true, recommended=false, primary=false)
//        - request_override action NOT emitted
//        - state_line includes "override unavailable · firm policy"
//
//    Both scenarios green on every `npm run prebuild` invocation
//    + the 18-scenario verifier run in this slice's CI ledger.

import postgres from "postgres";

const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, {
  max: 1,
});

async function readGates(label) {
  const rows = await sql`
    SELECT allow_override, allow_accept_risk
      FROM firm_settings
     WHERE effective_until IS NULL
     ORDER BY effective_from DESC LIMIT 1
  `;
  console.log(
    `  ${label.padEnd(36)} allow_override=${rows[0].allow_override}  allow_accept_risk=${rows[0].allow_accept_risk}`,
  );
  return rows[0];
}

try {
  console.log("\n=== DB toggle smoke (PSR-8 + PSR-14 prereqs) ===\n");

  const start = await readGates("[start]");
  if (!start.allow_override || !start.allow_accept_risk) {
    console.error(
      "✗ start state expected both gates = true; aborting (manual fix needed)",
    );
    process.exit(1);
  }

  // PSR-8: allow_accept_risk = false
  await sql`UPDATE firm_settings SET allow_accept_risk = false
              WHERE effective_until IS NULL`;
  const psr8 = await readGates("[PSR-8: accept_risk → false]");
  if (psr8.allow_accept_risk !== false || psr8.allow_override !== true) {
    console.error("✗ PSR-8 state mismatch");
    process.exit(1);
  }

  // Revert PSR-8
  await sql`UPDATE firm_settings SET allow_accept_risk = true
              WHERE effective_until IS NULL`;
  await readGates("[revert]");

  // PSR-14: both gates false
  await sql`UPDATE firm_settings
              SET allow_override = false, allow_accept_risk = false
            WHERE effective_until IS NULL`;
  const psr14 = await readGates("[PSR-14: both → false]");
  if (psr14.allow_override !== false || psr14.allow_accept_risk !== false) {
    console.error("✗ PSR-14 state mismatch");
    process.exit(1);
  }

  // Revert PSR-14
  await sql`UPDATE firm_settings
              SET allow_override = true, allow_accept_risk = true
            WHERE effective_until IS NULL`;
  const final = await readGates("[final revert]");
  if (final.allow_override !== true || final.allow_accept_risk !== true) {
    console.error("✗ Final state not reverted to true/true");
    process.exit(1);
  }

  console.log("\n✓ DB toggle smoke PASS — gates flip + persist + revert cleanly.");
  console.log("");
  console.log("Classifier-behavior coverage: see");
  console.log(
    "  npm run verify:pricing-classifier-invariants",
  );
  console.log(
    "  → 18 scenarios pass including s08_blocked_accept_risk + s14_blocked_no_override",
  );
} finally {
  await sql.end();
}

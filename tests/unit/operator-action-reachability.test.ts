/**
 * An operator action nobody calls is a capability nobody has.
 *
 * ── WHAT THIS WOULD HAVE CAUGHT ─────────────────────────────────────────
 *
 * `updateComponentChargeAsk` shipped as a real server action, wrapping a real
 * library writer, IMPORTED BY the Costs drilldown — and never invoked. So a
 * component charge could be created, costed and elected, and never priced.
 *
 * Measured on Production 2026-08-28: two charges costing $2,700, both elected
 * to bill SEPARATELY, produced a customer document reading "One-time fees
 * $0.00" on a quote whose Finalize button reported `ready`.
 *
 * Every check in the repository passed. TypeScript is satisfied by an unused
 * import. The gate scripts were green because they call the LIBRARY writer
 * (`updateComponentChargeAskAs`) directly, which is the right thing for a gate
 * and is exactly what made the missing UI invisible — the tests proved the
 * write works, and nothing asked whether an operator could reach it.
 *
 * So this asserts the two halves of that failure, and neither alone is enough:
 *
 *   1. an operator action imported by a component must be CALLED there;
 *   2. a library writer whose action wrapper exists must have that action
 *      reachable from the UI — a gate script calling the library is not a
 *      substitute for an operator path.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
// CRLF-normalised at the read. Two source-reading tests in this repo have
// already reported a defect that was really a checkout artefact.
const read = (p: string) =>
  readFileSync(path.join(root, p), "utf8").split(String.fromCharCode(13)).join("");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(root, dir))) {
    const rel = path.posix.join(dir, e);
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
  }
  return out;
}

const UI_FILES = [...walk("src/components"), ...walk("src/app/projects")];

/** Every `export async function NAME` in an action module. */
function exportedActions(file: string): string[] {
  const src = read(file);
  return [...src.matchAll(/export async function ([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
}

test("an operator action imported by the UI is actually invoked there", () => {
  // Scoped to the action modules this repair touches plus its closest
  // siblings. Widening it to every action file at once would turn a guard into
  // a migration; the shape is here and can be extended file by file.
  const actionModules = [
    "src/app/actions/component-charges.ts",
    "src/app/actions/commercial-recovery-persist.ts",
  ];

  const orphans: string[] = [];
  for (const mod of actionModules) {
    const names = exportedActions(mod);
    assert.ok(names.length > 0, `${mod} exports no actions — the parser is broken`);
    for (const name of names) {
      for (const ui of UI_FILES) {
        const src = read(ui);
        // Imported here?
        const imported = new RegExp(`[{,]\\s*${name}\\s*[,}]`).test(src);
        if (!imported) continue;
        // Then it must be CALLED here. `name(` anywhere other than the import.
        const called = new RegExp(`\\b${name}\\s*\\(`).test(src);
        if (!called) orphans.push(`${ui} imports ${name} but never calls it`);
      }
    }
  }
  assert.deepEqual(
    orphans,
    [],
    `An imported operator action is never invoked. That is how ` +
      `updateComponentChargeAsk shipped unreachable:\n  ${orphans.join("\n  ")}`,
  );
});

test("the cost writer is reachable from the Costs surface", () => {
  // The specific path the original defect broke, asserted end to end rather
  // than by the general rule alone — the general rule passes the moment someone
  // deletes the unused import, which would "fix" the lint and leave operators
  // with no way to enter a charge's economics at all.
  //
  // The SUBJECT changed with the charge-type pricing-authority disposition:
  // "Costs owns governed cost; Pricing derives recovery from charge-type
  // authority." There is one economics writer on this surface now, not two, so
  // the guard follows the surviving one rather than being deleted with the
  // other.
  const lib = read("src/lib/component-charges/update.ts");
  assert.match(lib, /export async function updateComponentChargeCostAs\(/);

  const action = read("src/app/actions/component-charges.ts");
  assert.match(action, /export async function updateComponentChargeCost\(/);
  assert.match(action, /updateComponentChargeCostAs\(/);

  const ui = read("src/components/costs/packaging-drilldown.tsx");
  assert.match(ui, /updateComponentChargeCost\(\{/, "Costs must CALL the cost action");
  // Bound explicitly to the grain. Positional inference is the one mistake that
  // silently writes one charge's number onto its same-type sibling.
  assert.match(ui, /field="cost"/);
  assert.match(ui, /chargeInstanceId=\{charge\.chargeInstanceId\}/);
});

test("Costs offers no recovery input, and no door to one", () => {
  // The inverse of the guard above, and the reason it is a test rather than a
  // comment: a recovery field on Costs would take a number from the operator
  // that the engine does not read, which reads as their decision and is not.
  // That is worse than the original defect — the original was a capability the
  // product claimed and could not perform; this would be one it performs
  // visibly and ignores.
  const action = read("src/app/actions/component-charges.ts");
  assert.doesNotMatch(
    action,
    /export async function updateComponentChargeAsk\(/,
    "the ask server action was removed by disposition",
  );

  const ui = read("src/components/costs/packaging-drilldown.tsx");
  assert.doesNotMatch(ui, /updateComponentChargeAsk/, "Costs must not write a recovery ask");
  assert.doesNotMatch(ui, /field="ask"/);
});

test("a gate script calling the library writer does not stand in for the UI", () => {
  // The bypass that hid this. Gate scripts SHOULD call the `*As` writers — they
  // have no session — but that must not be the only caller of a capability the
  // product claims to offer.
  //
  // WHAT THE PRODUCT CLAIMS is read from the action layer rather than listed
  // here. A `*As` writer exercised only by scripts is a defect when a server
  // action exposes it and no UI calls it; it is not a defect when no action
  // exposes it, because then the product is not offering it at all.
  //
  // That distinction is now load-bearing. `updateComponentChargeAskAs` survives
  // as a gate-fixture tool after the charge-type pricing-authority disposition
  // deleted its action and its Costs field, and the OD-032 gate scripts that
  // call it are certification evidence for closed phases — rewriting them to
  // suit a later change would falsify the record. Deriving the rule keeps the
  // guard honest without an exemption list that would go stale.
  const actions = read("src/app/actions/component-charges.ts");

  for (const writer of ["updateComponentChargeCost", "updateComponentChargeAsk"]) {
    const gateUsers = walk("scripts").filter((f) =>
      new RegExp(`${writer}As`).test(read(f)),
    );
    if (gateUsers.length === 0) continue;

    const offered = new RegExp(`export async function ${writer}\\(`).test(actions);
    const uiCallers = UI_FILES.filter((f) =>
      new RegExp(`${writer}\\s*\\(\\{`).test(read(f)),
    );

    if (offered) {
      assert.ok(
        uiCallers.length > 0,
        `${gateUsers.length} script(s) exercise ${writer}As and the product ` +
          `exposes ${writer}, but NO UI calls it. The write is proven and ` +
          `unreachable — which is the state that shipped: ${gateUsers.join(", ")}`,
      );
    } else {
      // Not offered, so nothing may reach it. Catches the half-revival where a
      // UI starts calling a writer whose door was deliberately removed.
      assert.equal(
        uiCallers.length,
        0,
        `${writer} has no server action, so no UI may call it: ${uiCallers.join(", ")}`,
      );
    }
  }
});

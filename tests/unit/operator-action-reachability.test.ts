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

test("the recovery-ask writer is reachable from the Costs surface", () => {
  // The specific path the defect broke, asserted end to end rather than by the
  // general rule alone — the general rule passes the moment someone deletes the
  // unused import, which would "fix" the lint and leave operators with no way
  // to price a charge.
  const lib = read("src/lib/component-charges/update.ts");
  assert.match(lib, /export async function updateComponentChargeAskAs\(/);

  const action = read("src/app/actions/component-charges.ts");
  assert.match(action, /export async function updateComponentChargeAsk\(/);
  assert.match(action, /updateComponentChargeAskAs\(/);

  const ui = read("src/components/costs/packaging-drilldown.tsx");
  assert.match(ui, /updateComponentChargeAsk\(\{/, "Costs must CALL the ask action");
  // Bound explicitly to the grain. Positional inference is the one mistake that
  // silently writes one charge's number onto its same-type sibling.
  assert.match(ui, /field="ask"/);
  assert.match(ui, /chargeInstanceId=\{charge\.chargeInstanceId\}/);
});

test("a gate script calling the library writer does not stand in for the UI", () => {
  // The bypass that hid this. Gate scripts SHOULD call the `*As` writers — they
  // have no session — but that must not be the only caller of a capability the
  // product claims to offer.
  const gateUsers = walk("scripts")
    .filter((f) => /updateComponentChargeAskAs/.test(read(f)));
  const uiCallers = UI_FILES.filter((f) => /updateComponentChargeAsk\s*\(\{/.test(read(f)));

  if (gateUsers.length > 0) {
    assert.ok(
      uiCallers.length > 0,
      `${gateUsers.length} script(s) exercise updateComponentChargeAskAs while NO UI ` +
        `calls updateComponentChargeAsk. The write is proven and unreachable — ` +
        `which is the state that shipped: ${gateUsers.join(", ")}`,
    );
  }
});

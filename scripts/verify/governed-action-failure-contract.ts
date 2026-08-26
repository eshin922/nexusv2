// Governed-action failure contract verifier.
//
// Asserts that no client component awaits a server action inside a
// `startTransition` without routing it through `runGoverned` /
// `runGovernedRaw` (see `src/lib/governed-action.ts`).
//
// WHAT IT PREVENTS. A server action can fail at the transport or runtime layer
// — a 503, a crashed function, a dropped connection — and then the promise
// REJECTS rather than resolving to `{ok: false}`. A call site written as
//
//     const r = await someAction(fd);
//     if (!r.ok) setError(r.error.message);
//
// reaches neither branch: nothing sets an error, `pending` clears, and the
// control returns to looking exactly as it did before the click. Soak run 5
// measured this on Finalize — `POST .../quote 503`, quote left in `draft`,
// nothing whatsoever on screen. `docs/validation/soak/run-05.md`.
//
// Six call sites in the quote tree shared the shape, and three of them did not
// read the result at all, so a structured refusal was silent too and two of
// them actively cleared their own "unsaved" indicator on failure.
//
// WHY A GREP AND NOT A TYPE. The hole is the ABSENCE of a call, and absence is
// not expressible in the type system: every one of the six call sites
// compiled. Same escalation ladder as the Pattern 47 autosave verifier — a
// text rule now, a native AST-level eslint rule if a bypass shape appears that
// this cannot see.
//
// Run via `node --experimental-strip-types
// scripts/verify/governed-action-failure-contract.ts`. Wired into prebuild and
// verify:ci alongside verify:autosave-focus-stability.
//
// Failure mode: process.exit(1) naming file:line and the offending await.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");

/**
 * Awaits that are NOT governed server actions, and never will be.
 *
 * Kept deliberately short. A long allowlist would mean the rule is the wrong
 * shape, not that the exceptions are legitimate.
 */
const BENIGN_AWAIT =
  /await\s+(runGoverned|runGovernedRaw|new\s+Promise|Promise\.(all|race|allSettled|resolve)|sleep|import\()/;

/**
 * Awaits whose rejection is ALREADY caught one layer down, named individually
 * with the layer that catches it. Not a general escape hatch: each entry is a
 * claim that some other file makes this call unable to reject, and that claim
 * is checkable by reading the named file.
 */
const HANDLED_ELSEWHERE: { call: RegExp; caughtIn: string }[] = [
  {
    // `propose` runs its own runGoverned so that it can ROLL BACK the recorded
    // election set before reporting — a rollback the caller must not duplicate.
    // It resolves to a RecoveryProposalFailure instead of rejecting.
    call: /await\s+onPropose\(/,
    caughtIn: "src/components/quote/use-recovery-draft.ts",
  },
];

/**
 * The region this verifier VETOES a build over.
 *
 * The contract is correct everywhere and the sweep below counts every site,
 * but the repair that established it was scoped to the quote tree, where soak
 * run 5 measured the failure. Failing the build on ~55 further pre-existing
 * sites would not repair them — it would force an unscoped sweep, which is a
 * different decision and Edward's to make. So: enforced here, REPORTED
 * everywhere, and never silently narrowed. A verifier that quietly scopes
 * itself to what already passes is an instrument that cannot express the
 * failure it exists to find.
 */
const ENFORCED = ["src/components/quote/", "src/lib/"];

type Violation = { file: string; line: number; fragment: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Find each `startTransition(async` block and return its source span.
 *
 * Brace-matched rather than regex-bounded, because these bodies routinely
 * contain nested braces, JSX and object literals, and a non-greedy `.*?` would
 * stop at the first `}` and read only the opening lines of the block — a
 * filter that cannot see most of what it is meant to check.
 */
function transitionBodies(src: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const re = /startTransition\(\s*async/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf("{", m.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push({ start: m.index, end: i });
  }
  return spans;
}

const violations: Violation[] = [];

for (const file of walk(SRC_DIR)) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("startTransition")) continue;

  for (const span of transitionBodies(src)) {
    const body = src.slice(span.start, span.end);
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line.includes("await ")) continue;
      if (BENIGN_AWAIT.test(line)) continue;
      if (HANDLED_ELSEWHERE.some((h) => h.call.test(line))) continue;
      // Anything else awaited in a transition is presumed to be a server
      // action. If that presumption is ever wrong, the fix is to route it
      // through the helper anyway — the helper is correct for any promise
      // whose rejection would otherwise be silent.
      const offset = span.start + body.indexOf(raw);
      const lineNo = src.slice(0, offset).split("\n").length;
      violations.push({
        file: relative(ROOT, file),
        line: lineNo,
        fragment: line.slice(0, 100),
      });
    }
  }
}

const norm = (f: string) => f.split("\\").join("/");
const enforced = violations.filter((v) => ENFORCED.some((p) => norm(v.file).startsWith(p)));
const reported = violations.filter((v) => !enforced.includes(v));

if (reported.length > 0) {
  // Counted and named, deliberately, on every run. This is the size of the
  // defect class outside the repaired region — not noise to be suppressed.
  const files = new Set(reported.map((v) => norm(v.file)));
  console.warn(
    `\ngoverned-action failure contract: ${reported.length} site(s) across ` +
      `${files.size} file(s) OUTSIDE the enforced region still await a server ` +
      `action whose rejection would be invisible. Reported, not vetoed — see ` +
      `the header of this file for why.`,
  );
  for (const f of [...files].sort()) {
    const n = reported.filter((v) => norm(v.file) === f).length;
    console.warn(`    ${f}  (${n})`);
  }
  console.warn("");
}

if (enforced.length > 0) {
  console.error(
    "\nGoverned-action failure contract violated — an awaited action inside a\n" +
      "transition whose REJECTION would be invisible to the operator.\n" +
      "Route it through runGoverned/runGovernedRaw (src/lib/governed-action.ts).\n",
  );
  for (const v of enforced) {
    console.error(`  ${v.file}:${v.line}\n      ${v.fragment}`);
  }
  console.error(`\n${enforced.length} violation(s) in the enforced region.\n`);
  process.exit(1);
}

console.log(
  `governed-action failure contract: clean in the enforced region ` +
    `(${ENFORCED.join(", ")})`,
);

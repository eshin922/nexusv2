import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertDraft, ActionGuardError, ERR } from "../../src/lib/action-result.ts";
import { codeOnly } from "../support/code-only.ts";

/**
 * Production / Direct Service cost writes are DRAFT-ONLY, server-side.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The Costs surface disables its inputs when `quote.status !== "draft"`. That
 * is an affordance, not a boundary: a direct action POST — a stale tab, a
 * replayed form, anything holding a saved action id — reached the writers
 * regardless, and could rewrite a live cost on a sent, accepted or completed
 * quote.
 *
 * It went unnoticed because the code SAID it was guarded.
 * `requireDirectServiceLeaf` carried the comment "Draft-state and ownership
 * come from the governed guard, not re-derived" while `quoteForQuoteLeaf`
 * asserted only ownership. A comment claiming a guard is the reason nobody
 * looks for one (Pattern 54).
 *
 * V1 cost timing is UNCHANGED by this: cost is still read live at SO push.
 * The guard only makes "live" mean the latest legitimately authored DRAFT
 * cost, rather than whatever a post-send mutation left behind.
 */

// ── the guard itself, over the whole lifecycle ───────────────────────────

test("assertDraft refuses every non-draft status, not just the frozen ones", () => {
  // `assertNotFrozen` would let `sent` through, and a sent quote's economics
  // are already the customer's. Draft is the only authoring state.
  for (const status of ["sent", "accepted", "complete", "superseded", "lost"]) {
    assert.throws(
      () => assertDraft({ status }),
      (e: unknown) =>
        e instanceof ActionGuardError && e.code === ERR.QUOTE_NOT_DRAFT,
      `status "${status}" was allowed to author cost`,
    );
  }
  assert.doesNotThrow(() => assertDraft({ status: "draft" }));
});

// ── every cost mutator is guarded, and stays guarded ─────────────────────

/**
 * The registry. A new writer of production cost must appear here WITH its
 * guard — the list is what stops the next one being added unguarded, which is
 * exactly how this defect arrived.
 */
const COST_MUTATORS: Array<{ file: string; fns: string[] }> = [
  {
    file: "src/app/actions/direct-service-production.ts",
    fns: ["updateDirectServiceProduction"],
  },
  {
    file: "src/app/actions/assembly-production-inputs.ts",
    fns: ["upsertAssemblyProductionInputs", "updateAssemblyProductionPolicy"],
  },
];

test("every production-cost mutator asserts draft server-side", async () => {
  for (const { file, fns } of COST_MUTATORS) {
    const src = codeOnly(await readFile(file, "utf8"));
    assert.match(src, /assertDraft\(/, `${file} does not call assertDraft at all`);
    for (const fn of fns) {
      assert.match(
        src,
        new RegExp(`export async function ${fn}\\b`),
        `${file} no longer exports ${fn} — update the registry deliberately`,
      );
    }
    // One assertion per exported mutator, at minimum. A single guard covering
    // two entry points would leave the second reachable if they ever diverge.
    const guards = src.match(/assertDraft\(/g) ?? [];
    assert.ok(
      guards.length >= fns.length,
      `${file} has ${guards.length} assertDraft call(s) for ${fns.length} ` +
        `exported cost mutator(s)`,
    );
  }
});

test("the UI's editable flag is NOT the authority", async () => {
  // The surface may still disable the control — that is good UX. What must not
  // happen is the server trusting it.
  for (const { file } of COST_MUTATORS) {
    const src = codeOnly(await readFile(file, "utf8"));
    assert.doesNotMatch(
      src,
      /quote\.status === "draft"/,
      `${file} re-derives draft-ness instead of using the governed guard`,
    );
  }
});

test("the comment that hid this is gone", async () => {
  const src = await readFile("src/app/actions/direct-service-production.ts", "utf8");
  // The old comment asserted a guarantee the code did not provide. Its
  // replacement describes what the code actually does.
  assert.doesNotMatch(
    src,
    /Draft-state and ownership come from the governed guard, not re-derived\./,
  );
  assert.match(src, /assertDraft\(quote\);/);
});

// ── the ownership guards still assert only ownership ─────────────────────

test("quoteForAssembly and quoteForQuoteLeaf remain lifecycle-agnostic", async () => {
  // Deliberate. They are used by readers too, so pushing the lifecycle
  // assertion into them would refuse legitimate reads on sent quotes. The
  // guard belongs at the WRITE, which is what the registry above pins.
  const src = codeOnly(await readFile("src/lib/quote-guards.ts", "utf8"));
  const forAssembly = src.slice(
    src.indexOf("export async function quoteForAssembly"),
    src.indexOf("export async function quoteForQuoteLeaf"),
  );
  assert.ok(forAssembly.length > 0, "quoteForAssembly not found");
  assert.doesNotMatch(forAssembly, /assertDraft\(/);
});

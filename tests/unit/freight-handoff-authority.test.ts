import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

// ═══════════════════════════════════════════════════════════════════════
// The freight handoff's action-layer authority.
//
// The strip hides `Freight complete` from anyone who is not the assignee
// and hides request/withdraw on a non-draft quote. Both are AFFORDANCES.
// A hidden control is not an absent endpoint, and these assert the
// boundary that actually refuses.
//
// Source-shape assertions, because the actions reach `ensureUser` and the
// database on their first line and the properties under test are which
// guard runs and what the UPDATE is conditioned on -- both of which are
// statements about the code, not about a returned value.
// ═══════════════════════════════════════════════════════════════════════

const read = async (rel: string) =>
  stripComments(await readFile(path.join(process.cwd(), "src", rel), "utf8"));

const actionBody = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport async function ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
};

test("completion refuses a caller who is neither the assignee nor an admin", async () => {
  const src = await read("app/actions/freight-handoff.ts");
  const body = actionBody(src, "completeFreightHandoff");

  // The check is on the SNAPSHOTTED assignee, not on a role lookup: the task
  // belongs to the person it was handed to, and holding the logistics role is
  // not the same as holding this request.
  assert.match(
    body,
    /handoff\.assignedToUserId !== user\.id && user\.role !== "admin"/,
    "completion does not compare the caller against the assignee",
  );
  assert.match(body, /ERR\.FORBIDDEN/, "an unauthorized caller is not refused as FORBIDDEN");

  // And it refuses BEFORE writing.
  const guardAt = body.indexOf("ERR.FORBIDDEN");
  const updateAt = body.indexOf(".update(freightHandoffs)");
  assert.ok(guardAt >= 0 && updateAt >= 0);
  assert.ok(guardAt < updateAt, "the write happens before the authority check");
});

test("the quote side's actions carry the quote's own edit permission", async () => {
  const src = await read("app/actions/freight-handoff.ts");

  // `withdrawFreightRequest` is now one branch of `markPackagingIncomplete`,
  // which decides between withdrawing an outstanding request and pulling the
  // packaging end back from a finished one. Same act, same permission.
  for (const name of ["markReadyForFreight", "markPackagingIncomplete"]) {
    assert.match(
      actionBody(src, name),
      /quoteByIdDraft\(/,
      `${name} does not enforce the quote's edit permission`,
    );
  }

  // The HOLDER's actions deliberately do NOT. Freight work continues after a
  // quote is sent, and draft-gating either would make the task uncompletable —
  // and now unreopenable — in the state it is most often worked in.
  for (const name of ["completeFreightHandoff", "markFreightIncomplete"]) {
    assert.doesNotMatch(
      actionBody(src, name),
      /quoteByIdDraft\(/,
      `${name} is draft-gated, which would strand freight work after send`,
    );
  }
});

test("reopening the freight task carries the same authority as completing it", async () => {
  // Added with Mark incomplete. Reversing a completion is the same decision as
  // making it, so it is the same boundary — and a boundary is only established
  // by an action that can refuse.
  const body = actionBody(await read("app/actions/freight-handoff.ts"), "markFreightIncomplete");

  assert.match(
    body,
    /handoff\.assignedToUserId !== user\.id && user\.role !== "admin"/,
    "reopening does not compare the caller against the assignee",
  );
  assert.match(body, /ERR\.FORBIDDEN/, "an unauthorized caller is not refused as FORBIDDEN");

  const guardAt = body.indexOf("ERR.FORBIDDEN");
  const updateAt = body.indexOf(".update(freightHandoffs)");
  assert.ok(guardAt >= 0 && updateAt >= 0);
  assert.ok(guardAt < updateAt, "the write happens before the authority check");
});

test("every state change names the handoff, and conditions on it", async () => {
  const src = await read("app/actions/freight-handoff.ts");

  // Widened when Mark incomplete landed. There are now three actions and four
  // updates between them, and the property is asserted per UPDATE rather than
  // against one literal WHERE clause — the two reopens condition on
  // `completed`, not on `open`, so a test pinned to the old literal would have
  // passed them by saying nothing about them.
  for (const name of [
    "completeFreightHandoff",
    "markPackagingIncomplete",
    "markFreightIncomplete",
  ]) {
    const body = actionBody(src, name);

    assert.match(
      body,
      /formData\.get\("handoffId"\)/,
      `${name} does not take a handoff id`,
    );

    const updates = body.split(".update(freightHandoffs)").slice(1);
    assert.ok(updates.length > 0, `${name} changes no handoff state`);

    for (const [index, tail] of updates.entries()) {
      // Everything up to the end of the WHERE clause. `.returning(` terminates
      // every one of these chains.
      const where = tail.slice(0, tail.indexOf(".returning("));

      // Keyed on the id AND on the status it was chosen for. "Whatever is open
      // on this quote" would let a screen opened before a
      // withdraw-and-re-request act on the request it never displayed.
      assert.match(
        where,
        /eq\(freightHandoffs\.id, handoffId\)/,
        `${name} update ${index} is not conditioned on that exact handoff`,
      );
      assert.match(
        where,
        /eq\(freightHandoffs\.status, "(open|completed)"\)/,
        `${name} update ${index} is not conditioned on the status it was chosen for`,
      );
      assert.doesNotMatch(
        where,
        /eq\(freightHandoffs\.quoteId, quoteId\)/,
        `${name} update ${index} acts on whatever the quote happens to have`,
      );

      // And on the revision the SCREEN was showing. Completion and reopening
      // move this row between `open` and `completed`, so two different states
      // answer to the same id and status — the behavioural proof is §7 of the
      // walk, and this keeps a refactor from dropping the clause silently.
      assert.match(
        where,
        /eq\(freightHandoffs\.revision, revision\)/,
        `${name} update ${index} is not fenced on the displayed revision`,
      );
    }

    // A no-match is a STALE write, not a missing one: the row exists, it is
    // simply not the one this screen was holding.
    assert.match(
      body,
      /ERR\.STALE_WRITE/,
      `${name} reports a replaced handoff as something other than a stale write`,
    );
  }
});

test("a replaced handoff is refused rather than silently closed", async () => {
  const src = await read("app/actions/freight-handoff.ts");
  for (const name of [
    "completeFreightHandoff",
    "markPackagingIncomplete",
    "markFreightIncomplete",
  ]) {
    const body = actionBody(src, name);

    // Zero rows updated must refuse. Returning success on a no-op would tell
    // an operator their stale screen had acted when nothing moved.
    //
    // Asserted as the PROPERTY rather than one spelling of it. These writes now
    // run inside `db.transaction`, so the zero-row branch returns `null` out of
    // the callback and the throw happens at the call site -- the previous
    // regex pinned `length === 0) { throw`, which the transactional shape no
    // longer contains even though it refuses exactly as before.
    assert.match(
      body,
      /\.length === 0\)/,
      `${name} does not check whether any row was updated`,
    );
    assert.match(
      body,
      /=== null\)\s*(\{\s*)?throw new ActionGuardError\(\s*ERR\.STALE_WRITE/,
      `${name} does not refuse when no row matched`,
    );

    // And it must not reach its success return on the empty path: every
    // zero-row branch leaves the transaction with `null`.
    const zeroRowBranches = body.match(/\.length === 0\) return [^;]+;/g) ?? [];
    for (const branch of zeroRowBranches) {
      assert.match(
        branch,
        /return null;/,
        `${name} returns something other than null from a zero-row update`,
      );
    }
  }
});

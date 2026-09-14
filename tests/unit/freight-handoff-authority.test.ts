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

test("request and withdrawal carry the quote's own edit permission", async () => {
  const src = await read("app/actions/freight-handoff.ts");

  for (const name of ["markReadyForFreight", "withdrawFreightRequest"]) {
    assert.match(
      actionBody(src, name),
      /quoteByIdDraft\(/,
      `${name} does not enforce the quote's edit permission`,
    );
  }

  // Completion deliberately does NOT. Freight work continues after a quote is
  // sent, and draft-gating it would make the task uncompletable in the state
  // it is most often worked in.
  assert.doesNotMatch(
    actionBody(src, "completeFreightHandoff"),
    /quoteByIdDraft\(/,
    "completion is draft-gated, which would strand freight work after send",
  );
});

test("completion and withdrawal name the handoff, and condition on it", async () => {
  const src = await read("app/actions/freight-handoff.ts");

  for (const name of ["completeFreightHandoff", "withdrawFreightRequest"]) {
    const body = actionBody(src, name);

    assert.match(
      body,
      /formData\.get\("handoffId"\)/,
      `${name} does not take a handoff id`,
    );

    // The condition is what stops a stale screen closing a replacement. Keyed
    // on the id AND still-open: "whatever is open on this quote" would let a
    // screen opened before a withdraw-and-re-request act on the request it
    // never displayed.
    assert.match(
      body,
      /eq\(freightHandoffs\.id, handoffId\), eq\(freightHandoffs\.status, "open"\)/,
      `${name} is not conditioned on that exact open handoff`,
    );
    assert.doesNotMatch(
      body,
      /\.update\(freightHandoffs\)[\s\S]*?eq\(freightHandoffs\.quoteId, quoteId\), eq\(freightHandoffs\.status, "open"\)/,
      `${name} still closes whatever is open on the quote`,
    );

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
  for (const name of ["completeFreightHandoff", "withdrawFreightRequest"]) {
    const body = actionBody(src, name);
    // Zero rows updated must throw. Returning success on a no-op would tell an
    // operator their stale screen had acted when nothing moved.
    assert.match(
      body,
      /\.length === 0\)\s*\{\s*throw new ActionGuardError\(/,
      `${name} does not refuse when no open handoff matched`,
    );
  }
});

/**
 * MERGE BLOCKER — `slack_approval_channel_id` must survive an unrelated
 * firm-settings update.
 *
 * `firm_settings` is versioned: every edit INSERTS a new row and closes the
 * prior one. A column omitted from `versionedFirmSettingsUpdate`'s
 * carry-forward is therefore not "left alone" — it is silently NULLED on the
 * next margin edit.
 *
 * The failure that makes this a blocker rather than a tidiness check: the
 * channel goes NULL, approval requests stop being delivered, delivery is
 * recorded as failed, and **nothing about the quote looks wrong**. The floor
 * gate still blocks correctly, so the only symptom is approvals that never
 * arrive — attributed to Slack, not to a margin edit made days earlier.
 *
 * This is the same class as the RI.7 catch that established the standing
 * "Versioned-table carry-forward audit" rule.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(p, import.meta.url), "utf8");

test("slackApprovalChannelId participates in versionedFirmSettingsUpdate carry-forward", async () => {
  const src = await read("../../src/app/actions/firm-settings.ts");

  const helper = src.slice(src.indexOf("async function versionedFirmSettingsUpdate"));
  assert.ok(
    helper.length > 0,
    "versionedFirmSettingsUpdate must exist — it is the only sanctioned writer",
  );

  // Carried forward from the prior row, not defaulted to a literal.
  assert.match(
    helper,
    /slackApprovalChannelId:\s*prior\?\.slackApprovalChannelId/,
    "slackApprovalChannelId must be read from the PRIOR row, or a margin-only edit clears it",
  );

  // …and before the caller's overrides, so an explicit edit still wins.
  const carryIdx = helper.indexOf("slackApprovalChannelId: prior?.slackApprovalChannelId");
  const spreadIdx = helper.indexOf("...overrides");
  assert.ok(carryIdx !== -1 && spreadIdx !== -1);
  assert.ok(
    carryIdx < spreadIdx,
    "carry-forward must precede ...overrides so an explicit channel edit still wins",
  );
});

test("the column exists on the schema and in a migration", async () => {
  const schema = await read("../../src/db/schema.ts");
  assert.match(schema, /slackApprovalChannelId:\s*text\("slack_approval_channel_id"\)/);

  const migration = await read("../../drizzle/0069_below_floor_approval_requests.sql");
  assert.match(migration, /firm_settings.*slack_approval_channel_id/s);
});

test("FALSIFICATION — removing the carry-forward line is what this test catches", async () => {
  // Reconstructs the defect: the helper builds `newRow` from the prior row, so
  // any governed column NOT named there is absent from the insert and lands as
  // NULL. Asserting the mechanism keeps this test meaningful if the helper is
  // ever rewritten.
  const src = await read("../../src/app/actions/firm-settings.ts");
  const helper = src.slice(src.indexOf("async function versionedFirmSettingsUpdate"));

  assert.match(
    helper,
    /const newRow: typeof firmSettings\.\$inferInsert = \{/,
    "the helper still constructs a fresh row — omission means NULL, not 'unchanged'",
  );

  // Every governed default that must survive an unrelated edit. If a future
  // column is added without carry-forward, add it here and watch this fail.
  for (const column of [
    "targetMarginPct",
    "floorMarginPct",
    "hubspotDealStageOnAccept",
    "netsuiteSoStatusOnCreate",
    "slackApprovalChannelId",
  ]) {
    assert.match(
      helper,
      new RegExp(`${column}:\\s*prior\\?\\.${column}`),
      `${column} must carry forward`,
    );
  }
});

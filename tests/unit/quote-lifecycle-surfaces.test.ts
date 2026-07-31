import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  organizerStatusPresentation,
  QUOTE_STATUS_PRESENTATION,
  selectLatestOrganizerQuote,
} from "../../src/lib/quote-lifecycle.ts";

const canonicalStatuses = [
  "draft",
  "sent",
  "accepted",
  "superseded",
  "lost",
  "complete",
] as const;

test("every canonical quote lifecycle status has explicit organizer presentation", () => {
  assert.deepEqual(Object.keys(QUOTE_STATUS_PRESENTATION), canonicalStatuses);
  for (const status of canonicalStatuses) {
    assert.notEqual(organizerStatusPresentation(status).label, "UNKNOWN");
  }
  assert.equal(organizerStatusPresentation("complete").label, "COMPLETE · LOCKED");
  assert.equal(organizerStatusPresentation("complete").editable, false);
  assert.equal(organizerStatusPresentation("sent").editable, false);
  assert.equal(organizerStatusPresentation("draft").editable, true);
  assert.equal(organizerStatusPresentation("superseded").active, false);
  assert.equal(organizerStatusPresentation("lost").active, false);
});

test("an unknown future status fails visibly instead of falling back to draft", () => {
  assert.deepEqual(organizerStatusPresentation("future_status"), {
    label: "UNKNOWN",
    editable: false,
    active: false,
  });
});

test("organizer selects the latest revision without status precedence", () => {
  const at = (iso: string) => new Date(iso);
  const olderComplete = {
    id: "complete-old",
    scenarioLabel: "Primary",
    versionNumber: 1,
    status: "complete" as const,
    createdAt: at("2026-01-01T00:00:00Z"),
  };
  const newerDraft = {
    id: "draft-new",
    scenarioLabel: "Alternative",
    versionNumber: 1,
    status: "draft" as const,
    createdAt: at("2026-01-02T00:00:00Z"),
  };
  assert.equal(
    selectLatestOrganizerQuote([olderComplete, newerDraft])?.id,
    "draft-new",
  );

  const olderDraft = { ...olderComplete, id: "draft-old", status: "draft" as const };
  const newerSent = { ...newerDraft, id: "sent-new", status: "sent" as const };
  assert.equal(
    selectLatestOrganizerQuote([olderDraft, newerSent])?.id,
    "sent-new",
  );
  assert.equal(selectLatestOrganizerQuote([olderComplete])?.id, "complete-old");
});

test("organizer selects latest version inside a scenario and version breaks equal timestamps", () => {
  const sameTime = new Date("2026-01-01T00:00:00Z");
  const selected = selectLatestOrganizerQuote([
    {
      id: "primary-v1",
      scenarioLabel: "Primary",
      versionNumber: 1,
      status: "complete",
      createdAt: sameTime,
    },
    {
      id: "primary-v2",
      scenarioLabel: "Primary",
      versionNumber: 2,
      status: "draft",
      createdAt: sameTime,
    },
    {
      id: "alternative-v1",
      scenarioLabel: "Alternative",
      versionNumber: 1,
      status: "sent",
      createdAt: sameTime,
    },
  ]);
  assert.equal(selected?.id, "primary-v2");
  assert.equal(selected?.versionNumber, 2);
  assert.equal(selected?.status, "draft");
});

test("organizer rejects an exact cross-scenario chronology tie", () => {
  const sameTime = new Date("2026-01-01T00:00:00Z");
  assert.throws(
    () =>
      selectLatestOrganizerQuote([
        {
          id: "one",
          scenarioLabel: "One",
          versionNumber: 1,
          status: "draft",
          createdAt: sameTime,
        },
        {
          id: "two",
          scenarioLabel: "Two",
          versionNumber: 1,
          status: "complete",
          createdAt: sameTime,
        },
      ]),
    /chronology is ambiguous/,
  );
});

test("organizer latest-quote SQL follows scenario version then creation chronology", async () => {
  const source = await readFile(
    new URL("../../src/lib/workspace-queries.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /DISTINCT ON \(q\.scenario_label\)[\s\S]*ORDER BY q\.scenario_label, q\.version_number DESC, q\.created_at DESC/,
  );
  assert.match(
    source,
    /dense_rank\(\) OVER \([\s\S]*scenario_latest\.created_at DESC,[\s\S]*scenario_latest\.version_number DESC/,
  );
  assert.match(source, /latest_quote_chronology_tie_count[\s\S]*> 1/);
  assert.doesNotMatch(source, /ORDER BY q\.updated_at DESC/);
});

test("lifecycle invalidation is page-scoped and costing autosave remains quote-only", async () => {
  const revalidation = await readFile(
    new URL("../../src/lib/revalidate.ts", import.meta.url),
    "utf8",
  );
  const costing = await readFile(
    new URL("../../src/app/actions/costing.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    revalidation,
    /revalidateQuoteLifecycleSurfaces[\s\S]*revalidatePath\(`\/projects\/\$\{projectId\}`\)[\s\S]*revalidatePath\("\/"\)/,
  );
  assert.doesNotMatch(costing, /revalidateQuoteLifecycleSurfaces/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  organizerStatusPresentation,
  QUOTE_STATUS_PRESENTATION,
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

// The two organizer tests that stood here asserted against
// `getDealOrganizerProjects` and `deal-organizer/project-list.tsx`, both removed
// with the R14 rewrite. Their SUBJECT survives and moved to
// `organizer-tasks.test.ts`: dropped scenarios must not surface, and a project
// whose scenarios were all dropped must read differently from one with no quote.
//
// Worth recording that they FAILED on deletion rather than passing vacuously —
// which is how the dropped-scenario exclusion was found missing from the new
// loader before it shipped.

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

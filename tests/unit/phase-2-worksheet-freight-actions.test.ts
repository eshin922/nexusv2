import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url), "utf8");

test("manual worksheet actions preserve provenance and draft commercial authority", () => {
  assert.match(source, /fieldProvenance: provenance/);
  assert.match(source, /quoteByIdDraft/);
  assert.match(source, /corrected_after_import/);
});

test("selection is same-subcategory and tracking stays with its recorded destination", () => {
  assert.match(source, /eq\(freightDestinations\.freightSubcategoryId, subcategoryId\)/);
  assert.match(source, /selectedDestinationId !== destinationId/);
  assert.match(source, /row\.tracking/);
  assert.match(source, /Tracking belongs only to the selected destination/);
  assert.match(source, /selectedDestinationId !== destinationId && !row\.tracking/);
});

test("deleting the selected destination clears authority without auto-promotion", () => {
  const start = source.indexOf("export async function deleteFreightDestination");
  const end = source.indexOf("export async function", start + 30);
  const deletion = source.slice(start, end);
  assert.match(deletion, /selectedDestinationId: null, selectionReason: null/);
  assert.match(deletion, /selectionCleared/);
  assert.doesNotMatch(deletion, /selectedDestinationId: destinationCount|selectedDestinationId: .*\[0\]/);
});

// The former assertion here required `const key = flat ? sourceTierId :
// row.tierId` — one key for every field — which made flat mode copy mode and
// description across all breaks. Disposition F-E overturned that: "one value,
// all breaks" governs the freight AMOUNT only, because the same shipment
// family may be LTL at one break and FTL at another under one negotiated
// amount.
//
// Field-source resolution is now a pure contract with behavioural coverage in
// phase-2-freight-break-write.test.ts, which asserts outcomes rather than
// source text. What remains here is the write target and the audit shape.
test("one-value entry writes each owned break and records the break mode", () => {
  const start = source.indexOf("export async function updateFreightDestinationBreakGroup");
  const end = source.indexOf("export async function", start + 30);
  const group = source.slice(start, end);
  assert.match(group, /resolveBreakFieldSources/);
  assert.match(group, /where\(eq\(freightDestinationBreaks\.id, row\.id\)\)/);
  assert.match(group, /one_value_all_breaks/);
});

test("post-creation commercial edits remain draft-only and preserve correction evidence", () => {
  for (const action of ["updateFreightSubcategory", "updateFreightDestination", "updateFreightDestinationBreak", "updateFreightCustomsEntry", "updateFreightCustomsBreak"]) {
    const start = source.indexOf(`export async function ${action}`);
    const end = source.indexOf("export async function", start + 30);
    const body = source.slice(start, end < 0 ? undefined : end);
    assert.match(body, /quoteByIdDraft|draftSubcategory/, `${action} must reject sent commercial edits`);
  }
  assert.match(source, /mergeProvenance/);
  assert.match(source, /freight_subcategory_updated/);
  assert.match(source, /freight_destination_updated/);
  assert.match(source, /membership: \{ from: beforeMembers.*to: memberIds/s);
});

test("shipment facts and customs evidence retain explicit authority and provenance", () => {
  assert.match(source, /journeyLabel: nullable\(fd, "journeyLabel"\)/);
  assert.match(source, /treatment: \(nullable\(fd, "treatment"\)/);
  const start = source.indexOf("export async function updateFreightCustomsEntry");
  const end = source.indexOf("export async function updateFreightCustomsBreak", start);
  const entry = source.slice(start, end);
  assert.match(entry, /invoiceReference/);
  assert.match(entry, /entryDescription/);
  assert.match(entry, /mergeProvenance/);
});

test("tracking is the only post-send editable worksheet fact", () => {
  const start = source.indexOf("export async function updateFreightTracking");
  const tracking = source.slice(start);
  assert.doesNotMatch(tracking, /quoteByIdDraft|draftSubcategory/);
  assert.match(tracking, /operational: true/);
  assert.match(tracking, /mergeProvenance/);
});

test("creation inherits membership from the owning Setup assembly and stores no allocation", () => {
  const start = source.indexOf("createFreightSubcategory");
  const end = source.indexOf("async function draftSubcategory", start);
  const create = source.slice(start, end);
  assert.match(create, /quote\.id !== quoteId/);
  assert.match(create, /const memberIds = members\.map\(\(member\) => member\.id\)/);
  assert.doesNotMatch(create, /fd\.getAll\("assemblyLeafId"\)/);
  assert.doesNotMatch(create, /allocation|share|weight|cbm/i);
});

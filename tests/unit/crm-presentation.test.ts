import assert from "node:assert/strict";
import test from "node:test";
import {
  presentHubspotStage,
  UNKNOWN_HUBSPOT_STAGE_LABEL,
} from "../../src/lib/crm-presentation.ts";
import { presentSalesOwner } from "../../src/lib/sales-owner-presentation.ts";

const stages = [
  { id: "195274338", label: "New (Acquiring Info)" },
  { id: "195274339", label: "Development & Quoting" },
  { id: "195274340", label: "Quote Request" },
  { id: "195274342", label: "Purchase Order" },
  { id: "195607084", label: "Won - In production" },
  { id: "999313804", label: "In Transit" },
  { id: "195274343", label: "Delivered" },
  { id: "195274344", label: "Closed lost" },
];

test("stage presentation resolves current metadata and never leaks internal ids", () => {
  assert.equal(presentHubspotStage("195274340", stages), "Quote Request");
  for (const stage of stages) {
    assert.equal(presentHubspotStage(stage.id, stages), stage.label);
  }
  assert.equal(presentHubspotStage("Purchase Order", stages), "Purchase Order");
  assert.equal(
    presentHubspotStage("999999999", stages),
    UNKNOWN_HUBSPOT_STAGE_LABEL,
  );
});

test("HubSpot cached owner is authoritative without a Nexus account", () => {
  assert.equal(
    presentSalesOwner(
      "owner-1",
      { id: "owner-1", name: "HubSpot Owner" },
      null,
    ),
    "HubSpot Owner",
  );
});

test("matching Nexus identity is a fallback and mismatches fail visibly", () => {
  assert.equal(
    presentSalesOwner(
      "owner-1",
      null,
      { id: "owner-1", name: "Nexus User" },
    ),
    "Nexus User",
  );
  assert.equal(
    presentSalesOwner(
      "owner-1",
      { id: "owner-2", name: "Wrong Owner" },
      { id: "owner-3", name: "Wrong User" },
    ),
    null,
  );
});

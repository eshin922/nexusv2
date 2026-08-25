import assert from "node:assert/strict";
import test from "node:test";

import {
  OTC_COLUMN_TO_CHARGE,
  RECOVERY_CHARGES,
  chargePolicy,
} from "../../src/lib/commercial-recovery/registry.ts";
import { OTC_FEES } from "../../src/lib/commercial-projection.ts";

/**
 * One name per governed charge identity, everywhere it is shown.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The same charge carried a different name depending on which surface an
 * operator was looking at. `project_setup` was "Project setup" on the recovery
 * control and "Setup" on the customer's quote; `artwork_plate` was "Artwork &
 * plate" and "Artwork"; `tooling_artwork_legacy` was "Tooling / artwork
 * (legacy)" and "Tooling & artwork"; `rd_formulation` was "R&D / Formulation"
 * and "R&D"; `other_service` was "Other service" and "Other services".
 *
 * The reported symptom was an operator electing In unit price for a charge and
 * then finding it apparently still listed under One-time fees. Nothing was
 * wrong with the election. The name had changed between the control and the
 * document, so the line they were reading was not the one they thought.
 *
 * Two independent authorings of the same fact is the whole problem, and it is
 * why this test derives BOTH sides rather than restating a list of six
 * strings — a third pinned copy would be one more thing to drift.
 */

test("a charge's fee line carries exactly the charge's own label", () => {
  const labelForColumn = new Map(OTC_FEES.map((f) => [f.field, f.label] as const));

  for (const [column, chargeKey] of Object.entries(OTC_COLUMN_TO_CHARGE)) {
    const quoteLabel = labelForColumn.get(column as never);
    if (quoteLabel === undefined) continue; // no fee line for this charge
    assert.equal(
      quoteLabel,
      chargePolicy(chargeKey).label,
      `${chargeKey}: the quote calls it "${quoteLabel}", the charge registry ` +
        `calls it "${chargePolicy(chargeKey).label}". An operator reading both ` +
        `surfaces cannot tell they are the same charge.`,
    );
  }
});

test("no two charge identities share a label", () => {
  // The inverse failure: aligning names by collapsing two governed identities
  // into one word would make them indistinguishable in the opposite direction,
  // and their BV-011 destinations differ.
  const seen = new Map<string, string>();
  for (const c of RECOVERY_CHARGES) {
    const prior = seen.get(c.label);
    assert.equal(
      prior,
      undefined,
      `"${c.label}" names both ${prior} and ${c.key}; distinct governed ` +
        `charges must remain distinguishable.`,
    );
    seen.set(c.label, c.key);
  }
});

test("the canon is the approved vocabulary, not merely self-consistent", () => {
  // Both sides could agree on a name nobody approved. These six were settled by
  // the business; this asserts the agreed word, and is the one place a label
  // change has to be made deliberately.
  const approved: Record<string, string> = {
    tooling: "Tooling",
    artwork_plate: "Artwork & plate",
    tooling_artwork_legacy: "Tooling & artwork (legacy)",
    project_setup: "Project setup",
    rd_formulation: "R&D",
    other_service: "Other service",
  };
  for (const [key, label] of Object.entries(approved)) {
    assert.equal(chargePolicy(key as never).label, label);
  }
});

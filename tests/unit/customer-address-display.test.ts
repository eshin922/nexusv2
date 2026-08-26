import assert from "node:assert/strict";
import test from "node:test";

import { composeAddress } from "../../src/lib/customer-address-display.ts";

/**
 * Address composition for the customer document.
 *
 * Split out of the HubSpot identity tests when composeAddress moved to its own
 * presentation module, so the NetSuite projection graph reaches selection logic
 * without reaching a customer-document formatter. Behaviour is unchanged.
 */

test("address composes for a reader, and collapses when empty", () => {
  assert.equal(
    composeAddress({
      line1: "15615 ALTON PRKWY",
      line2: null,
      city: "Irvine",
      state: "CA",
      postalCode: "92618",
      country: "United States",
    }),
    "15615 ALTON PRKWY\nIrvine, CA 92618\nUnited States",
  );

  // Nothing to show renders as nothing, not as stray punctuation.
  assert.equal(
    composeAddress({ line1: null, line2: null, city: null, state: null, postalCode: null, country: null }),
    null,
  );
  assert.equal(
    composeAddress({ line1: "  ", line2: "", city: null, state: null, postalCode: null, country: null }),
    null,
  );

  // Partial data still reads correctly rather than emitting empty segments.
  assert.equal(
    composeAddress({ line1: "1 Main St", line2: null, city: "Irvine", state: null, postalCode: null, country: null }),
    "1 Main St\nIrvine",
  );
});

test("a suspicious source value is passed through, never corrected", () => {
  // Smart Pressed Juice's HubSpot record genuinely holds zip "15615", which
  // duplicates the street number. It is reported as a source-data issue and
  // rendered verbatim: substituting a plausible postcode would put a value in
  // front of the customer that exists nowhere in the CRM.
  assert.equal(
    composeAddress({
      line1: "15615 ALTON PRKWY",
      line2: null,
      city: "Irvine",
      state: "CA",
      postalCode: "15615",
      country: "United States",
    }),
    "15615 ALTON PRKWY\nIrvine, CA 15615\nUnited States",
  );
});


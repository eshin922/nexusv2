import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url), "utf8");
const canonicalCss = await readFile(new URL("../../src/styles/freight-1a.css", import.meta.url), "utf8");

test("Freight implements every approved worksheet screen and interaction state", () => {
  const required = [
    "Nothing ships yet",
    "+ What ships",
    "What shipment am I recording?",
    "Record shipment",
    "Another destination",
    "in the price",
    "one value, all breaks",
    "differs by break",
    "type + description",
    "Customs entry",
    "Duty",
    "Tariff",
    "Supporting detail",
    "comparison",
    "these dates were entered for a different endpoint",
    "Freight sell per unit",
  ];
  for (const label of required) assert.match(source, new RegExp(label.replace(/[+?]/g, "\\$&")), label);
});

test("worksheet columns follow the Quote tier set rather than a fixed three-break design", () => {
  assert.match(source, /repeat\(\$\{tiers\.length\}/);
  assert.match(source, /tiers\.map/);
  assert.doesNotMatch(source, /repeat\(3,/);
});

test("customs exposes invoice-entered Duty and Tariff only", () => {
  assert.match(source, /\(\["duty", "tariff"\] as const\)/);
  assert.doesNotMatch(source, /rateBase|ratePct|MPF|HMF|entry fee/i);
});

test("shipment and customs evidence remain editable through business-language controls", () => {
  for (const field of ["journeyLabel", "treatment", "invoiceReference", "entryDescription"]) {
    assert.match(source, new RegExp(`name=\\"${field}\\"`));
  }
  assert.match(source, /Bundled · amortised across units/);
  assert.match(source, /Pass-through/);
});

test("Freight inherits commercial-product ownership from its product-group entry point", () => {
  assert.match(source, /products\.map\(\(product\)/);
  assert.match(source, /setCreateProductId\(product\.id\)/);
  assert.match(source, /type="hidden" name="assemblyId" value=\{product\?\.id/);
  // SUPERSEDED 2026-08-05: the create modal listed contents read-only under
  // "Shipment contents from Setup". It now carries the Design Authority's own
  // interactive assignment control (`SkuChips`, 1a.jsx:114), whose label is
  // "this freight is for". Ownership scoping — the assertions above — is
  // unchanged; only the read-only treatment was superseded.
  assert.match(source, /this shipment is for/);
  assert.match(source, /ShipmentContentsPicker/);
  assert.doesNotMatch(source, /<select required name="assemblyId"/);
  assert.doesNotMatch(source, /name="assemblyLeafId"[^>]*type="checkbox"[^>]*defaultChecked/);
});

test("operator surface contains no fixture or persistence language", () => {
  for (const forbidden of ["Validation", "fixture", "regression", "quote_leaf", "foreign key", "junction", "commercial product"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"), forbidden);
  }
});

test("selection changes retain endpoint-bound tracking and surface stale evidence", () => {
  assert.match(source, /freightDestinationId \?\? selected\.id/);
  assert.match(source, /an ETA for one destination is not an ETA for another/);
  assert.doesNotMatch(source, /clearFreightTracking/);
});

test("source-authoritative DOM removes the approximated worksheet chrome", () => {
  assert.match(source, /Carried to every destination/);
  assert.match(source, /className="fr-cgrid fr-crow tot"/);
  assert.match(source, /className="fr-grid"><div className="fr-elab">freight type/);
  assert.match(source, /data-break-field/);
  assert.match(source, /data-customs-amount/);
  assert.match(source, /data-customs-markup/);
  assert.doesNotMatch(source, /className="cw-shead"/);
  assert.doesNotMatch(source, /className="fr1-/);
  assert.doesNotMatch(source, /<button form=\{formId\}/);
  assert.doesNotMatch(source, /className="fr-edit"[^>]*>Save/);
  assert.doesNotMatch(source, /<b className="fr-vs/);
  assert.doesNotMatch(source, /<i className="(?:x|arr)"/);
});

// Pattern 30 byte-faithfulness guard.
//
// Previously this pinned a SHA-256 constant. It now diffs production against
// the TRACKED bundle source, so the guarantee is live: if the bundle is
// refreshed, this fails until production is re-adopted, and it can no longer
// be satisfied by updating a magic constant.
//
// Two transforms are applied, each a recorded deviation:
//   1. dynamic tier count  — approved deviation D4
//   2. 1b / 1c variant rules removed — row 13 cleanup. Option A references
//      neither prefix; the rules had zero production consumers. Recoverable
//      from docs/design-authority/_intake/freight-1a.zip.
const stripVariantRules = (css: string): string => {
  const lines = css.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\.(fr1b|fr1c)-/.test(line) && line.includes("{")) {
      let depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      i += 1;
      while (depth > 0 && i < lines.length) {
        depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
};

// Header comments differ by design: production carries the Nexus adoption
// note. Compare rules only.
const rulesOnly = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();

test("canonical Freight CSS matches the tracked bundle, modulo recorded deviations", async () => {
  const bundleCss = await readFile(
    new URL("../../docs/design-authority/freight-1a/app/freight/styles.css", import.meta.url),
    "utf8",
  );

  const production = rulesOnly(
    canonicalCss
      .split("/* Approved source deviations:")[0]
      .replaceAll("repeat(var(--freight-tier-count, 3),", "repeat(3,"),
  );
  const expected = rulesOnly(stripVariantRules(bundleCss));

  assert.equal(production, expected);
});

test("the tracked bundle source is itself unmodified", async () => {
  const bundleCss = await readFile(
    new URL("../../docs/design-authority/freight-1a/app/freight/styles.css", import.meta.url),
    "utf8",
  );
  // Checksum from docs/design-authority/freight-1a/SHA256SUMS. The bundle is
  // authority; editing it in place is prohibited, and this proves it hasn't
  // happened.
  assert.equal(
    createHash("sha256").update(bundleCss).digest("hex"),
    "68d341bf37af7bf4b662653f5209ee36bd815cea05cf90418e207f5782931713",
  );
});

// Product Type → suggested charges.
//
// Every requirement the Settings design was given is pinned here as a test,
// because each one is the kind that stays true only while somebody remembers
// it:
//
//   * a missing rule is NOT "no charges expected"
//   * a suggestion is an offer, never a decision
//   * a default never carries a tooling classification or a NetSuite item
//   * applicability is not posting readiness
//   * a quote's existing charges are unaffected by a later change to defaults
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  resolveChargeDefaults,
  describeEmptyResolution,
  type ChargeDefaultRow,
  type ChargeProfileRow,
} from "../../src/lib/commercial-recovery/charge-defaults.ts";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const profile = (over: Partial<ChargeProfileRow> = {}): ChargeProfileRow => ({
  productTypeValue: "Primary",
  verdict: "defaults",
  reviewedByEmail: "admin@thedps.co",
  reviewedAt: new Date("2026-09-15T00:00:00Z"),
  note: null,
  ...over,
});

const rule = (over: Partial<ChargeDefaultRow> = {}): ChargeDefaultRow => ({
  productTypeValue: "Primary",
  chargeKey: "tooling",
  preselected: false,
  note: null,
  ...over,
});

/* ── a missing rule is not a finished answer ───────────────────────────── */

test("no profile is `needs_review`, not `none_expected`", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: null,
    rules: [],
  });
  assert.equal(r.kind, "needs_review");

  // The two empty states must not reach an operator as the same sentence.
  const reviewed = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ verdict: "none_expected" }),
    rules: [],
  });
  assert.equal(reviewed.kind, "none_expected");
  assert.notEqual(
    describeEmptyResolution(r),
    describeEmptyResolution(reviewed),
    "an unreviewed type and a reviewed-none type read identically",
  );
  assert.match(describeEmptyResolution(r)!, /not been reviewed|yet/i);
  assert.match(describeEmptyResolution(reviewed)!, /Reviewed/);
});

test("a reviewed `none_expected` carries who decided and when", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Freight",
    profile: profile({
      productTypeValue: "Freight",
      verdict: "none_expected",
      note: "freight is a landed charge",
    }),
    rules: [],
  });
  assert.equal(r.kind, "none_expected");
  if (r.kind !== "none_expected") return;
  // Without these the finished answer is indistinguishable from an assertion
  // nobody owns.
  assert.equal(r.reviewedByEmail, "admin@thedps.co");
  assert.ok(r.reviewedAt instanceof Date);
  assert.equal(r.note, "freight is a landed charge");
});

test("an unclassified product needs review under its own name", () => {
  const r = resolveChargeDefaults({ productTypeValue: null, profile: null, rules: [] });
  assert.equal(r.kind, "needs_review", "an unclassified product should not be an error");
});

/* ── contradictions are reported, never resolved by preference ─────────── */

test("`none_expected` with rules is a named contradiction", () => {
  // The DB cannot enforce this — it spans two tables — so the resolver must
  // not quietly prefer one side. Preferring either hides a state that should
  // never occur, which is how it would persist.
  const r = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ verdict: "none_expected" }),
    rules: [rule()],
  });
  assert.equal(r.kind, "contradiction");
  if (r.kind !== "contradiction") return;
  assert.match(r.detail, /none_expected/);
});

test("`defaults` with no rules is a contradiction, not an empty answer", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ verdict: "defaults" }),
    rules: [],
  });
  assert.equal(r.kind, "contradiction", "an empty defaults verdict invented a finished answer");
});

test("rules with no profile are a contradiction", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: null,
    rules: [rule()],
  });
  assert.equal(r.kind, "contradiction");
});

test("rules for another product type are not borrowed", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ productTypeValue: "Primary" }),
    rules: [rule({ productTypeValue: "Secondary", chargeKey: "print_plates" })],
  });
  // Primary has a `defaults` verdict and no rules OF ITS OWN.
  assert.equal(r.kind, "contradiction", "a rule for Secondary was offered against Primary");
});

/* ── a suggestion is an offer ──────────────────────────────────────────── */

test("suggestions carry preselection and nothing that decides", () => {
  const r = resolveChargeDefaults({
    productTypeValue: "Secondary",
    profile: profile({ productTypeValue: "Secondary" }),
    rules: [
      rule({ productTypeValue: "Secondary", chargeKey: "print_plates", preselected: true }),
      rule({ productTypeValue: "Secondary", chargeKey: "tooling", preselected: false }),
      rule({ productTypeValue: "Secondary", chargeKey: "artwork_plate", preselected: true }),
    ],
  });
  assert.equal(r.kind, "suggestions");
  if (r.kind !== "suggestions") return;

  // Stable order, so two operators adding the same component see the same list.
  assert.deepEqual(
    r.suggestions.map((s) => s.chargeKey),
    ["artwork_plate", "print_plates", "tooling"],
  );
  assert.deepEqual(r.suggestions.map((s) => s.preselected), [true, true, false]);

  // THE CONTRACT: a suggestion carries no accounting decision.
  for (const s of r.suggestions) {
    assert.deepEqual(
      Object.keys(s).sort(),
      ["chargeKey", "note", "preselected"],
      "a suggestion grew a field that decides something",
    );
  }
  assert.equal(describeEmptyResolution(r), null, "a populated resolution claimed to be empty");
});

/* ── the structural prohibitions ───────────────────────────────────────── */

test("nothing in the module can carry a tooling classification or an item", () => {
  // Suggesting `tooling` is allowed; classifying it is not. Mould/collar vs
  // cutting die selects a different NetSuite destination, and the destination
  // resolver REFUSES an unclassified tooling charge rather than defaulting --
  // a default here would make that accounting choice from a product category.
  const src = read("src/lib/commercial-recovery/charge-defaults.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const banned of [
    "toolingClassification",
    "tooling_classification",
    "mould_collar",
    "cutting_die",
    "netsuiteItem",
    "netsuite_item",
    "netsuiteInternalId",
  ]) {
    assert.doesNotMatch(
      code,
      new RegExp(banned),
      `charge-defaults references ${banned}; a default must not decide an accounting destination`,
    );
  }
});

test("the migration declares no item and no classification column", () => {
  const ddl = read("drizzle/0131_draft_product_type_charge_defaults.sql");
  const statements = ddl.replace(/^--.*$/gm, "");
  for (const banned of ["tooling_classification", "netsuite_item", "netsuite_internal_id", "destination"]) {
    assert.doesNotMatch(
      statements,
      new RegExp(banned),
      `the table declares a ${banned} column`,
    );
  }
  // And the rule table cannot invent a charge.
  assert.match(statements, /charge_key.*IN \('print_plates', 'tooling', 'artwork_plate', 'samples', 'other_service'\)/s);
  // A rule cannot exist without a reviewed verdict.
  assert.match(statements, /REFERENCES "product_type_charge_profile"/);
  // No seeded business rule.
  assert.doesNotMatch(statements, /INSERT\s+INTO/i, "the migration seeds a rule");
});

test("applicability is not posting readiness", () => {
  // Two different questions with different owners. Nothing in a resolution may
  // report whether a destination is mapped and verified.
  const r = resolveChargeDefaults({
    productTypeValue: "Secondary",
    profile: profile({ productTypeValue: "Secondary" }),
    rules: [rule({ productTypeValue: "Secondary", chargeKey: "samples" })],
  });
  assert.equal(r.kind, "suggestions");
  if (r.kind !== "suggestions") return;
  const keys = Object.keys(r);
  for (const banned of ["ready", "readiness", "mapped", "postable"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(banned)), `resolution exposes ${banned}`);
  }
});

/* ── quote selections survive a change to defaults ─────────────────────── */

test("defaults are read at authoring time only, never at render", () => {
  // THE MECHANISM that makes an operator's charges permanent: their charges
  // are rows they authored, and nothing re-derives them from the defaults. If
  // a rendering path ever imports this module, a later edit to a default would
  // change what an existing quote displays.
  //
  // Asserted as an import boundary because that is where the guarantee lives.
  // When the authoring surface is wired, ONE module may import this; the
  // rendering paths must not.
  const importers: string[] = [];
  const roots = ["src/components", "src/app"];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  };
  for (const root of roots) {
    for (const file of walk(root)) {
      if (read(file).includes("commercial-recovery/charge-defaults")) importers.push(file);
    }
  }
  assert.deepEqual(
    importers,
    [],
    `charge-defaults is imported by a surface. Until the authoring surface is ` +
      `wired, nothing should import it; after that, only the authoring path may:\n${importers.join("\n")}`,
  );
});

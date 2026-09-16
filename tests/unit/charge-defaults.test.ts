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

/**
 * The ONE surface permitted to import the resolver today, and why.
 *
 * Settings is where an admin MAINTAINS the defaults, so it necessarily reads
 * them. It renders no quote and no charge an operator authored, so a later
 * edit to a default cannot reach a quote through it.
 *
 * When the authoring surface is wired, its single module joins this list.
 * Nothing else may: a RENDERING path importing this module is exactly how the
 * guarantee below would be lost.
 */
const PERMITTED_IMPORTERS = [
  // The admin read + write path. Resolves through the SAME function the
  // authoring path will, so a contradiction reads identically in both places.
  "src/app/actions/charge-defaults.ts",
  "src/app/admin/charge-defaults/charge-defaults-table.tsx",
];

test("defaults are read at authoring time only, never at render", () => {
  // THE MECHANISM that makes an operator's charges permanent: their charges
  // are rows they authored, and nothing re-derives them from the defaults. If
  // a rendering path ever imports this module, a later edit to a default would
  // change what an existing quote displays.
  //
  // Asserted as an import boundary because that is where the guarantee lives.
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

  const unexpected = importers.filter((f) => !PERMITTED_IMPORTERS.includes(f));
  assert.deepEqual(
    unexpected,
    [],
    `charge-defaults is imported by a surface that is not permitted to read it. ` +
      `Only maintenance and authoring paths may; a rendering path would make a ` +
      `later edit to a default change what an existing quote displays: ${unexpected.join(", ")}`,
  );

  // And the permitted list is not allowed to rot into a description of
  // whatever happens to import it: an entry that no longer exists must be
  // removed rather than left standing as permission for nothing.
  const missing = PERMITTED_IMPORTERS.filter((f) => !importers.includes(f));
  assert.deepEqual(missing, [], `permitted importer no longer imports it: ${missing.join(", ")}`);

  // The quote-rendering trees, named explicitly. These must never appear --
  // this is the assertion the allowlist could otherwise weaken by accident.
  for (const f of importers) {
    assert.ok(
      !f.startsWith("src/components/pdf/") &&
        !f.startsWith("src/components/quote/") &&
        !f.includes("/quotes/[quoteId]/quote/"),
      `${f} renders a quote and imports charge-defaults`,
    );
  }
});

/* ── the admin write path ──────────────────────────────────────────────── */

const ACTIONS = "src/app/actions/charge-defaults.ts";
const WRITERS = ["setNoneExpected", "upsertChargeDefault", "removeChargeDefault", "clearChargeProfile"];

/** One writer's body, bounded by the next export so a sibling cannot vouch for it. */
function writerBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} is not exported from ${ACTIONS}`);
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport ");
  return next === -1 ? rest : rest.slice(0, next);
}

test("every writer is admin-gated, transactional, and audits inside its transaction", () => {
  const src = read(ACTIONS);
  for (const name of WRITERS) {
    const body = writerBody(src, name);
    assert.match(body, /requireAdminAction\(\)/, `${name} does not require an admin`);
    assert.match(body, /db\.transaction\(/, `${name} does not run in a transaction`);
    // The audit must take the transaction handle. An audit that can commit
    // without its mutation, or the reverse, is not evidence of the mutation.
    assert.match(
      body,
      /writeAuditEntry\([\s\S]*?\n\s*tx,\r?\n\s*\);/,
      `${name} writes its audit outside the transaction`,
    );
  }
});

test("every writer serializes check-and-write on the product type", () => {
  // A transaction alone does NOT serialize check-then-write under READ
  // COMMITTED: two admins can both read a consistent state, both pass their own
  // check, and both commit. The invariant spans two tables, so no CHECK can
  // hold it either -- which is exactly why the lock is taken BEFORE the read.
  const src = read(ACTIONS);
  for (const name of WRITERS) {
    const body = writerBody(src, name);
    assert.match(body, /lockFor\(value\)/, `${name} does not take the per-type lock`);
    const lockAt = body.indexOf("lockFor(value)");
    const readAt = body.search(/tx\s*\n?\s*\.select\(/);
    if (readAt >= 0) {
      assert.ok(lockAt < readAt, `${name} reads before taking the lock, so the check is not serialized`);
    }
  }
  // Per product type, not global: two admins editing different types must not
  // queue behind each other.
  assert.match(src, /product_type_charge_defaults:\$\{value\}/);
  // Transaction-scoped, so it releases on rollback and on a crash.
  assert.match(src, /pg_advisory_xact_lock/);
});

test("recording `none expected` refuses rather than discarding rules", () => {
  // Silently deleting them would turn "I reviewed this" into "I discarded
  // somebody's rules" -- a different act, and not the one that was asked for.
  const body = writerBody(read(ACTIONS), "setNoneExpected");
  assert.match(body, /ERR\.VALIDATION/);
  assert.doesNotMatch(
    body,
    /\.delete\(productTypeChargeDefaults\)/,
    "setNoneExpected deletes the rules it should refuse over",
  );
});

test("the write path cannot store a classification, an item, or an unknown charge", () => {
  const src = read(ACTIONS);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const banned of ["toolingClassification", "mould_collar", "cutting_die", "netsuiteItem", "netsuite_item"]) {
    assert.doesNotMatch(code, new RegExp(banned), `the admin actions write ${banned}`);
  }
  // A charge identity is checked against the governed registry, not retyped.
  assert.match(code, /COMPONENT_CHARGE_KEYS/);
});

/* ── the last rule, and why removal is refused ─────────────────────────── */

test("each contradiction names the remedy that actually fixes IT", () => {
  // The two contradictions are repaired by OPPOSITE actions. A surface that
  // composed one sentence for both would send an admin the wrong way half the
  // time, so the remedy travels with the state that needs it.
  const noneWithRules = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ verdict: "none_expected" }),
    rules: [rule()],
  });
  const defaultsWithNone = resolveChargeDefaults({
    productTypeValue: "Primary",
    profile: profile({ verdict: "defaults" }),
    rules: [],
  });
  assert.equal(noneWithRules.kind, "contradiction");
  assert.equal(defaultsWithNone.kind, "contradiction");
  if (noneWithRules.kind !== "contradiction" || defaultsWithNone.kind !== "contradiction") return;

  assert.match(noneWithRules.remedy, /Remove the rules/i);
  assert.match(defaultsWithNone.remedy, /Add a suggested charge|Clear review/i);
  assert.notEqual(noneWithRules.remedy, defaultsWithNone.remedy);
  // And neither may suggest reading the empty state as a finished answer.
  assert.match(defaultsWithNone.remedy, /not read this as/i);
});

test("removing the last rule is refused, and only under a `defaults` verdict", () => {
  // An ordinary supported action must not be able to leave a valid state
  // machine invalid. But the refusal must NOT extend to a stored
  // `none_expected` carrying rules: there, removing the last rule is the
  // repair, and refusing it would trap an admin in the invalid state.
  const body = writerBody(read(ACTIONS), "removeChargeDefault");
  assert.match(body, /lastOfDefaults/, "the last-rule refusal is absent");
  assert.match(
    body,
    /verdictRow\?\.verdict === "defaults"/,
    "the refusal is not conditioned on the verdict, so it would block the repair path",
  );
  // It names both ways forward rather than only forbidding.
  assert.match(body, /add the replacement first/i);
  assert.match(body, /Clear review/i);
  // And it never quietly withdraws the review instead.
  assert.doesNotMatch(
    body,
    /\.delete\(productTypeChargeProfile\)/,
    "removing a rule also deletes the profile — a larger act than the control names",
  );
});

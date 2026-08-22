import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const HEAD = () => read("src/components/pricing/pricing-page-head.tsx");
const SHELL = () => read("src/components/pricing-surface/pricing-surface-shell.tsx");
const CTX = () => read("src/components/pricing-surface/pricing-progression-context.tsx");
const SEND_GATE = () => read("src/lib/below-floor-send-gate.ts");
const QUOTES = () => read("src/app/actions/quotes.ts");
const CLASSIFIER = () => read("src/lib/pricing-classifier.ts");
const PAGE = () => read("src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx");

// ═══════════════════════════════════════════════════════════════════════
// PROGRESSION ON THE SURFACE, AND THE GATE IT PREDICTS
//
// `pricing-progression.test.ts` proves the RULES over a pure function. These
// prove the WIRING: that the surface reads that one verdict rather than
// deriving a second answer, and that the thing it predicts actually exists at
// the server — which, before this slice, it did not.
// ═══════════════════════════════════════════════════════════════════════

// ── the surface reads one verdict ─────────────────────────────────────────

test("the banner's CTA comes from the progression verdict, not the classifier mode", async () => {
  const src = codeOnly(await HEAD());
  const href = src.slice(src.indexOf("const bannerHref"), src.indexOf("const bannerHelp"));
  assert.match(href, /!progression\.allowed/);
  // The old predicate. `mode === "suggestion_led"` suppressing the href is
  // exactly the bug: below target is sendable by policy and had no way forward.
  assert.doesNotMatch(href, /mode ===/);
});

test("gated chrome follows progression, so below-target is not dressed as blocked", async () => {
  const src = codeOnly(await HEAD());
  const banner = src.slice(src.indexOf("const bannerState"), src.indexOf("const recommendedOrPrimary"));
  assert.match(banner, /progression\.allowed/);
  assert.doesNotMatch(banner, /mode === "blocked"/);
});

test("both consumers sit under one provider", async () => {
  const src = codeOnly(await PAGE());
  const open = src.indexOf("<PricingProgressionProvider");
  const close = src.indexOf("</PricingProgressionProvider>");
  assert.ok(open > -1 && close > open, "provider must be mounted");
  const inside = src.slice(open, close);
  assert.match(inside, /<PricingPageHead/);
  assert.match(inside, /<PricingSurfaceShell/);
});

test("the verdict is evaluated once, by the provider", async () => {
  // Any second call site is a second answer waiting to disagree with the first.
  for (const [name, src] of [
    ["head", codeOnly(await HEAD())],
    ["shell", codeOnly(await SHELL())],
  ] as const) {
    assert.doesNotMatch(
      src,
      /evaluateProgression\(/,
      `${name} must consume the verdict, never compute one`,
    );
  }
  assert.match(codeOnly(await CTX()), /evaluateProgression\(/);
});

test("progression reads the tier's blended status, which is the gate's basis", async () => {
  const src = codeOnly(await CTX());
  assert.match(src, /blendedStatus: toBlendedStatus\(t\.blended_status/);
  // `t.status` is the worst CELL's band. Using it here is the Pattern 50
  // defect: two bases for one question, which produced the dead Request card.
  assert.doesNotMatch(src, /blendedStatus:[^\n]*\bt\.status\b/);
});

test("a tier with no id mapping is omitted, never defaulted", async () => {
  const src = codeOnly(await CTX());
  assert.match(src, /if \(!uuid\) continue;/);
});

// ── the dead Request control ──────────────────────────────────────────────

test("the Request control renders only when there is a tier to request against", async () => {
  // RE-POINTED for R13. The ranked ActionCard list is gone; the request lives
  // in the verdict's second path, and the same condition holds — a request
  // needs a tier to be about, or it opens a modal mounted under a null.
  const shell = codeOnly(await SHELL());
  assert.match(shell, /requestTierLabel=\{requestTier\?\.label \?\? null\}/);

  const verdict = codeOnly(await read("src/components/pricing-surface/verdict-bar.tsx"));
  assert.match(verdict, /enabled=\{editable && requestTierLabel !== null\}/);
});

// ── the gate the surface predicts ─────────────────────────────────────────

test("sendQuote enforces the floor", async () => {
  const src = codeOnly(await QUOTES());
  assert.match(src, /await requireBelowFloorAuthorizedToSend\(/);
});

test("the send gate runs before any external artifact exists", async () => {
  // A refusal must leave no PDF, no snapshot, no pin, no audit, no status
  // change — which is why it sits beside the readiness gate rather than
  // wherever the floor number happens to be in scope.
  const src = codeOnly(await QUOTES());
  const readiness = src.indexOf("await requireResolvedQuoteCosts(quoteId);");
  const floor = src.indexOf("await requireBelowFloorAuthorizedToSend(");
  const pin = src.indexOf("await prepareQuoteCommercialPin(quoteId)");
  assert.ok(readiness > -1 && floor > readiness, "floor gate must follow readiness");
  assert.ok(floor < pin, "floor gate must precede the commercial pin");
});

test("the send gate re-uses the authorization core; it does not re-implement it", async () => {
  const src = codeOnly(await SEND_GATE());
  assert.match(src, /evaluateBelowFloorAuthorization\(/);
  assert.match(src, /fingerprintCommercialState\(/);
  // No local notion of who may approve, and no local floor comparison.
  assert.doesNotMatch(src, /commercialApprover/);
  assert.doesNotMatch(src, /floorMarginPct\s*[<>]/);
});

test("the send gate checks EVERY below-floor tier", async () => {
  const src = codeOnly(await SEND_GATE());
  assert.match(src, /for \(const tier of belowFloor\)/, "every tier, not the first");
  assert.match(src, /refusals\.join/, "report all failing tiers at once");
});

test("the send gate short-circuits when nothing is below floor", async () => {
  // The ordinary path must not pay for an authorization query.
  const src = codeOnly(await SEND_GATE());
  const idx = src.indexOf("if (belowFloor.length === 0) return;");
  assert.ok(idx > -1);
  // Anchored on the QUERY, not the symbol: the first `belowFloorAuthorizations`
  // in the file is the import, which is above everything and would make this
  // assertion impossible to satisfy no matter where the guard sat.
  assert.ok(
    idx < src.indexOf(".from(belowFloorAuthorizations)"),
    "the guard must return before the authorization query",
  );
});

// ── copy ──────────────────────────────────────────────────────────────────

test("the approval path names the authority, not the admin role", async () => {
  const files = [
    "src/lib/pricing-classifier.ts",
    "src/components/pricing/pricing-page-head.tsx",
    "src/components/pricing/verdict-band.tsx",
    "src/components/pricing/lines-requiring-review.tsx",
    "src/components/pricing-surface/state-zone.tsx",
    "src/components/pricing-surface/action-zone.tsx",
    "src/components/pricing-surface/request-override-modal.tsx",
  ];
  for (const f of files) {
    const src = codeOnly(await read(f));
    assert.doesNotMatch(src, /admin override/i, `${f} still says "admin override"`);
    assert.doesNotMatch(src, /firm admin/i, `${f} still says "firm admin"`);
  }
});

test("Request approval is the label, and it routes to a commercial approver", async () => {
  const src = codeOnly(await CLASSIFIER());
  assert.match(src, /label: "Request approval"/);
  assert.match(src, /authorized commercial approver/);
});

test("the workflow's identifiers are NOT renamed with the copy", async () => {
  // `request_override`, the tables and the audit actions are concept
  // references: renaming them would rewrite history to fix a label.
  const src = codeOnly(await CLASSIFIER());
  assert.match(src, /kind: "request_override"/);
  assert.match(src, /"override_unavailable"/);
});

// ── the vocabulary that must NOT move ─────────────────────────────────────

test("classifier override_applied still means a PM-set cell price", async () => {
  // A per-cell sell override. Nothing to do with below-floor authorization,
  // and the rename must not reach it — two different things sharing one word
  // is why the rename was needed, not a reason to collapse them.
  const ctx = codeOnly(await read("src/components/pricing-surface/pricing-classifier-context.tsx"));
  assert.match(ctx, /override_applied: pt\.sellSource === "cell_override"/);

  const grid = codeOnly(await read("src/components/pricing-surface/compliance-grid.tsx"));
  assert.match(grid, /cell\.override_applied && <span className="ov">PM-set<\/span>/);

  const cls = codeOnly(await CLASSIFIER());
  assert.match(cls, /override_applied: overrideApplied/);
});

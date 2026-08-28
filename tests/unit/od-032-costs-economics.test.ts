/**
 * OD-032 step B — Costs owns what DPS pays.
 *
 * ── THE BOUNDARY BEING ASSERTED ─────────────────────────────────────────
 *
 *   Setup    what does this component require?   identity + causal ownership
 *   Costs    what does DPS pay?                  ← this step
 *   Recovery how does DPS recover it?            customer treatment
 *
 * The sharpest assertions here are about what each surface CANNOT do. A
 * boundary held by convention is one an ordinary edit walks through, so the
 * Costs writer is asserted unable to create a charge, change its owner or elect
 * a mode — and the readiness reader is asserted not to consult the engine,
 * because that is the specific mistake that made an uncosted charge invisible.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const READINESS = "src/lib/component-charges/readiness.ts";
const UPDATE = "src/lib/component-charges/update.ts";
const DOOR = "src/app/actions/component-charges.ts";
const PKG = "src/components/costs/packaging-drilldown.tsx";
const PAGE = "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx";
const WORKSPACE = "src/lib/commercial-recovery/workspace-view.ts";
const RESOLVER = "src/lib/customer-view-resolver.ts";
const SEND = "src/app/actions/quotes.ts";
const CSS = "src/styles/od032-costs-charges.css";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments are prose, not behaviour. Matching one as a use has misled before. */
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

// ══════════════════════════════════════════════════════════════════════
// Readiness is structural state, not an engine output
// ══════════════════════════════════════════════════════════════════════

test("readiness reads the TABLES, never the costing output", () => {
  // ── THE DEFECT THIS PREVENTS ───────────────────────────────────────────
  //
  // An uncosted charge produces no economics by TWO independent paths:
  // `componentChargeEconomics` skips a zero-cost charge, and
  // `loadComponentCharges` inner-joins the tier table. So a charge with no cost
  // reached neither the recovery workspace nor the send gate, and an operator
  // could author one, have nothing price it, and send with nothing reporting
  // the omission.
  //
  // Asking the engine "is anything missing?" asks a layer that was never told
  // the charge existed. Readiness therefore reads the two tables that hold the
  // structural fact.
  const r = codeOnly(read(READINESS));
  assert.match(r, /from quoteChargeInstances|\.from\(quoteChargeInstances\)/);
  assert.match(r, /leftJoin\(\s*\n?\s*quoteChargeInstanceTiers/);
  assert.match(r, /\.from\(quoteTiers\)/);
  for (const forbidden of [
    "computeQuoteCosting",
    "getCostingBundle",
    "chargeEconomics",
    "componentChargeEconomics",
    "ConstructedRollups",
  ]) {
    assert.ok(
      !r.includes(forbidden),
      `readiness must not derive from ${forbidden} — an uncosted charge is not in it`,
    );
  }
});

test("the join is LEFT, which is the whole point", () => {
  // An inner join would drop exactly the charge the module exists to report.
  const r = codeOnly(read(READINESS));
  assert.ok(!/innerJoin/.test(r), "an inner join would hide the state being reported");
});

test("three states, and `partial` is one of them", () => {
  const r = read(READINESS);
  assert.match(r, /export type ChargeEconomicsState = "none" \| "partial" \| "complete"/);
  // Measured against the QUOTED tiers, not against whatever rows exist — a
  // charge costed at every tier it has rows for is complete only if those are
  // all the tiers the quote sells.
  assert.match(codeOnly(r), /e\.costed\.size === 0 \? "none" : missing\.length === 0 \? "complete" : "partial"/);
  assert.match(codeOnly(r), /tiers\.filter\(\(t\) => !e\.costed\.has\(t\.id\)\)/);
});

test("a legacy '@quote' charge is not reported as missing anything", () => {
  // Its amount lives on a production column, so it has no tier rows BY DESIGN.
  // Counting it as uncosted would block every send on a quote carrying one.
  const r = codeOnly(read(READINESS));
  assert.match(r, /isNotNull\(quoteChargeInstances\.ownerQuoteLeafId\)/);
});

// ══════════════════════════════════════════════════════════════════════
// Blank is absence — one representation, not two
// ══════════════════════════════════════════════════════════════════════

test("clearing a cost DELETES the row rather than storing a zero", () => {
  // ── WHY ABSENCE IS REPRESENTED BY ABSENCE ──────────────────────────────
  //
  // `cost_amount` is NOT NULL, so a blank cannot be stored as a value, and
  // writing 0 would state that DPS pays nothing — a cost fact nobody entered.
  //
  // The resulting invariant is exact: a tier row exists IF AND ONLY IF a
  // positive cost was stated. One representation of "no cost", so readiness can
  // answer by counting rows instead of interpreting values.
  const u = codeOnly(read(UPDATE));
  assert.match(u, /if \(next === null\) \{[\s\S]{0,400}?\.delete\(quoteChargeInstanceTiers\)/);
  assert.ok(
    !/costAmount: "0"/.test(u),
    "storing a zero would be the same defect from the other direction",
  );
});

test("an explicit 0.00 is refused — Option A, enforced at Costs", () => {
  const u = codeOnly(read(UPDATE));
  assert.match(u, /Number\(next\) === 0/);
  assert.match(read(UPDATE), /A cost of 0\.00 for \$\{tier\.label\} is not a cost/);
});

test("an unreadable amount is refused, never coerced", () => {
  // `Number("")` is 0 and `Number("abc")` is NaN. Both would enter the quote as
  // a cost fact nobody stated.
  const u = codeOnly(read(UPDATE));
  assert.match(u, /!\/\^\\d\+\(\\\.\\d\{1,2\}\)\?\$\/\.test\(t\)/);
  for (const raw of ["Number(input.cost)", "Number(raw)", "parseFloat"]) {
    assert.ok(!u.includes(raw), `${raw} would coerce rather than refuse`);
  }
});

test("clearing a cost clears its ask, and the record SAYS so", () => {
  // The ask rides on the same row, so it goes with it. That is a real
  // consequence of the operator's edit and it belongs in the audit trail —
  // otherwise the ask appears to have vanished on its own.
  const u = read(UPDATE);
  assert.match(u, /recovery_ask_cleared_with_cost/);
});

test("an ask cannot be entered before a cost", () => {
  // Creating the row here would mint economics whose cost nobody stated, which
  // the readiness invariant forbids — and commercially it is the wrong order.
  const u = codeOnly(read(UPDATE));
  assert.match(u, /if \(!existing\) \{/);
  assert.match(read(UPDATE), /Enter what DPS pays at \$\{tier\.label\} before what it recovers/);
});

// ══════════════════════════════════════════════════════════════════════
// The Costs writer cannot do Setup's job or Recovery's
// ══════════════════════════════════════════════════════════════════════

test("the Costs writer writes ECONOMICS and nothing else", () => {
  const u = codeOnly(read(UPDATE));
  // No insert into the instance table: it cannot create a charge or change one.
  assert.ok(
    !/insert\(quoteChargeInstances\)/.test(u) && !/update\(quoteChargeInstances\)/.test(u),
    "Costs must not create or alter a charge — Setup owns identity and ownership",
  );
  // No election: Recovery owns customer treatment.
  assert.ok(
    !/quoteChargeRecovery/.test(u),
    "Costs must not elect a recovery mode — Commercial Recovery owns that",
  );
  assert.ok(!/ensureChargeInstance/.test(u));
});

test("it refuses a legacy charge, whose amount lives on a production column", () => {
  const u = codeOnly(read(UPDATE));
  assert.match(u, /charge\.ownerQuoteLeafId === null/);
  assert.match(read(UPDATE), /not component-owned, so its cost is not entered here/);
});

test("it is scoped to the quote, not merely to the id", () => {
  // An instance id from another quote would satisfy the primary key and let
  // this surface reprice a different quote's charge.
  const u = codeOnly(read(UPDATE));
  assert.match(u, /eq\(quoteChargeInstances\.quoteId, quoteId\)/);
  assert.match(u, /eq\(quoteTiers\.quoteId, quoteId\)/);
});

test("Pattern 52 · charge economics are freeze-list state", () => {
  const u = codeOnly(read(UPDATE));
  assert.match(u, /assertNotFrozen\(quote\)/);
  assert.match(u, /quoteByIdDraft/);
});

test("every Costs door resolves the operator", () => {
  const door = codeOnly(read(DOOR));
  const exported = (door.match(/export async function \w+/g) ?? []).length;
  const guarded = (door.match(/await ensureUser\(\)/g) ?? []).length;
  assert.equal(guarded, exported, "a door without a guard is not a door");
  assert.match(door, /updateComponentChargeCostAs\(user\.id, input\)/);
  assert.match(door, /updateComponentChargeAskAs\(user\.id, input\)/);
});

// ══════════════════════════════════════════════════════════════════════
// The block reads as fixed totals, in the quote's tier order
// ══════════════════════════════════════════════════════════════════════

test("one cell per QUOTED TIER, not one per stored amount", () => {
  // ── THE ORDERING DEFECT THIS REMOVES ───────────────────────────────────
  //
  // Shape A mapped over `charge.amounts` and rendered them in whatever order
  // the reader returned — and the reader has no ORDER BY, so the sequence was
  // not guaranteed to match the tier columns above it. Four unlabelled figures
  // under a four-column grid read as if they line up with it.
  //
  // Iterating the quote's tiers and looking each amount up by id makes the
  // order correct by construction, and makes a missing tier an empty field
  // rather than a shorter row.
  const pkg = codeOnly(read(PKG));
  assert.match(pkg, /const byTier = new Map\(charge\.amounts\.map\(\(a\) => \[a\.tierId, a\]\)\)/);
  assert.match(pkg, /tiers\.map\(\(t\) => \([\s\S]{0,600}?byTier\.get\(t\.id\)\?\.cost \?\? null/);
  assert.ok(
    !/charge\.amounts\.map\(\(a\) => \(/.test(pkg),
    "rendering the stored amounts in stored order is the defect",
  );
});

test("every figure carries the name of the tier it belongs to", () => {
  const pkg = read(PKG);
  assert.match(pkg, /className="od032-costs-charge-tier-label">\{t\.label\}/);
  assert.match(pkg, /Cost for \$\{chargeLabel\} at \$\{t\.label\}/);
});

test("the block says these are FIXED TOTALS, not per-unit rates", () => {
  // The grid above is per-unit rates. Right-aligned currency under it does not
  // say which of the two it is, and the difference is the whole arithmetic the
  // engine's falsifications exist to protect.
  const pkg = read(PKG);
  assert.match(pkg, /fixed total per tier — not a per-unit rate/);
  const css = read(CSS);
  assert.match(css, /\.od032-costs-charges\s*\{[\s\S]*?grid-column: 1 \/ -1;/);
});

test("a blank field never suggests it holds zero", () => {
  const pkg = read(PKG);
  // "0.00" as a placeholder would read as the value an empty field holds — and
  // that is precisely the value Option A refuses.
  assert.match(pkg, /placeholder="—"/);
});

test("Pattern 47(e) · the amount input is never disabled by `pending`", () => {
  const pkg = codeOnly(read(PKG));
  assert.match(pkg, /\/\/ Pattern 47\(e\)|disabled=\{disabled\}/);
  const input = pkg.slice(pkg.indexOf("function ChargeAmountInput"));
  assert.ok(
    !/disabled=\{[^}]*pending/.test(input),
    "disabling an input mid-save drops focus — the defect Pattern 47 exists to prevent",
  );
  // Blur/Enter commit, because a currency amount is typed through states that
  // are not the operator's answer.
  assert.match(input, /onBlur=\{commitIfChanged\}/);
  assert.match(input, /e\.key === "Enter"/);
});

test("a rejected amount does not stay on screen looking saved", () => {
  const pkg = codeOnly(read(PKG));
  const input = pkg.slice(pkg.indexOf("function ChargeAmountInput"));
  assert.match(input, /if \(!res\.ok\) \{[\s\S]{0,200}?setDraft\(value \?\? ""\)/);
});

test("the CSS is tokenised, so the editor survives the other theme", () => {
  // Shape A shipped literal oklch values. Survivable for read-only text; not
  // for input fields, which render unreadable in the theme they were not
  // written for.
  const css = read(CSS);
  const literals = css.match(/oklch\(/g) ?? [];
  assert.equal(literals.length, 0, "every colour must come from a token");
  const selectors = css.match(/^\.[a-z0-9-]+/gm) ?? [];
  assert.ok(selectors.every((s) => s.startsWith(".od032-")), "must stay prefix-clean");
});

test("the page reads readiness from the tables, beside the charges", () => {
  const page = codeOnly(read(PAGE));
  assert.match(page, /const chargeReadiness = await readComponentChargeReadiness\(quoteId\)/);
  assert.match(page, /chargeReadiness=\{chargeReadiness\}/);
  assert.match(page, /quoteId=\{quoteId\}/);
});

// ══════════════════════════════════════════════════════════════════════
// Recovery shows an uncosted charge, and refuses to place it
// ══════════════════════════════════════════════════════════════════════

test("an uncosted charge gets a ROW, synthesized from the structural fact", () => {
  // It produces no `PlacedCharge`, so it has no row from the costing — which is
  // why it appeared nowhere at all before this.
  const w = codeOnly(read(WORKSPACE));
  assert.match(w, /const uncostedRows: RecoveryChargeRow\[\] = \[\]/);
  assert.match(w, /if \(e\.state !== "none" \|\| placedInstances\.has\(chargeInstanceId\)\) continue/);
  assert.match(w, /return \[\.\.\.legacyRows, \.\.\.componentRows, \.\.\.uncostedRows\]/);
});

test("its cost is EMPTY, never zero", () => {
  // Zero would be a claim: the cost is unknown, not nothing. The same
  // distinction BV-013 draws for recovery, applied to the other side of it.
  //
  // Made structurally by an EMPTY tier vector rather than a null total: an
  // empty vector has no scenario to be wrong about, whereas a vector of zeroes
  // would state that the charge costs nothing in every tier.
  const w = codeOnly(read(WORKSPACE));
  assert.match(w, /perTier: \[\],/);
  assert.match(read(WORKSPACE), /EMPTY, NOT ZERO/);
});

test("no mode is available on it, and each says why", () => {
  const w = read(WORKSPACE);
  assert.match(
    w,
    /This charge has no cost yet\. Enter what DPS pays on Costs before deciding how it is recovered\./,
  );
  assert.match(codeOnly(w), /options: RECOVERY_MODES\.map\(\(mode\) => \(\{\s*\n\s*mode,\s*\n\s*available: false,/);
});

test("a PARTIAL charge is refused placement too — BOTH incomplete states", () => {
  // ── THE MORE INTERESTING REFUSAL OF THE TWO ────────────────────────────
  //
  // A partial charge has a real amount, so a control over it looks perfectly
  // serviceable — and would take a commercial decision against economics that
  // are still moving. The operator would then have to come back and re-decide
  // once the missing tiers were costed, and nothing would tell them to.
  //
  // Disposition, Edward 2026-08-27. Setup defines it → Costs completes it →
  // Recovery decides it, with the surface enforcing the order rather than the
  // operator remembering it.
  const w = codeOnly(read(WORKSPACE));
  assert.match(w, /economics === "none"/);
  assert.match(w, /economics === "partial"/);
  // The refusal NAMES the tiers, so the operator knows what to go and finish.
  assert.match(read(WORKSPACE), /This charge has no cost at \$\{missingTierLabels\.join\(", "\)\}/);
  // `complete` is the only state that falls through to the policy rules.
  assert.match(w, /economics === "partial"[\s\S]{0,300}?:\s*null;/);
});

test("the surface SAYS why the controls are dead, in visible text", () => {
  // Every option is refused in both incomplete states, so the operator meets a
  // row of dead controls. Pattern 47(f) requires a disabled control to
  // communicate why, and hover-to-discover is a navigation pattern rather than
  // a presentation one — so the reason is on the surface, not only in `title`.
  const card = read("src/components/quote/card-commercial-recovery.tsx");
  assert.match(card, /no cost entered yet — enter it on Costs/);
  assert.match(card, /no cost at \$\{row\.missingTierLabels\.join\(", "\)\} — complete it on Costs/);
  // Read BEFORE the placement state: "not yet decided" would invite the
  // operator to decide it here rather than to go and finish the cost.
  const code = codeOnly(card);
  assert.ok(
    code.indexOf('row.economics === "none"') <
      code.indexOf("not yet decided — required before sending"),
    "the cost reason must precede the placement reason",
  );
});

test("a legacy row reports economics as NOT APPLICABLE, not as complete", () => {
  const w = codeOnly(read(WORKSPACE));
  assert.match(w, /economics: null,\s*\n\s*missingTierLabels: \[\],/);
});

test("the resolver supplies readiness the costing cannot", () => {
  const r = codeOnly(read(RESOLVER));
  assert.match(r, /const chargeReadiness = await readComponentChargeReadiness\(quoteId\)/);
  assert.match(r, /chargeEconomics: new Map\(/);
  // Sequential, not folded into a Promise.all around `getCostingBundle` — that
  // helper already fans out 8 queries and nesting adds to its peak.
  assert.ok(
    !/Promise\.all\(\[[\s\S]{0,300}?readComponentChargeReadiness/.test(r),
    "must not nest inside a Promise.all with the bundle",
  );
});

// ══════════════════════════════════════════════════════════════════════
// Send refuses an unpriced charge, and names it
// ══════════════════════════════════════════════════════════════════════

test("send refuses BOTH no-economics and partial-economics", () => {
  const send = codeOnly(read(SEND));
  assert.match(send, /const chargeReadiness = await readComponentChargeReadiness\(quoteId\)/);
  // `!== "complete"` covers both states. A check for "none" alone would let a
  // charge priced at one tier of four through.
  assert.match(send, /chargeReadiness\.filter\(\(r\) => r\.state !== "complete"\)/);
});

test("the refusal names the charge, its component label, and the tiers", () => {
  const readiness = read(READINESS);
  assert.match(readiness, /export function describeMissing/);
  assert.match(readiness, /no cost at any tier/);
  assert.match(readiness, /no cost at \$\{r\.missingTierLabels\.join\(", "\)\}/);
  // The operator's own label is what tells two charges of one type apart.
  assert.match(readiness, /r\.ownLabel \? `\$\{r\.label\} · \$\{r\.ownLabel\}` : r\.label/);
  assert.match(read(SEND), /unpriced\.map\(describeMissing\)\.join\("; "\)/);
});

test("the cost gate runs BEFORE the placement gate", () => {
  // A charge with no cost has nothing to place. Telling an operator to decide
  // its recovery first would send them to the wrong surface.
  const send = codeOnly(read(SEND));
  const cost = send.indexOf("readComponentChargeReadiness");
  const placement = send.indexOf("recoveryRows.filter((r) => r.unplaced)");
  assert.ok(cost > 0 && placement > 0, "both gates must exist");
  assert.ok(cost < placement, "the cost refusal must come first");
});

// ══════════════════════════════════════════════════════════════════════
// recoveryAsk moved, and moved UNCHANGED
// ══════════════════════════════════════════════════════════════════════

test("the ask is still nullable, still manual, still underived", () => {
  // Moving a field to the surface that owns economics is not the occasion to
  // decide what governs it. Whether it should derive from a markup category the
  // way every other charge's recovery does is a real question and a separate
  // one.
  const u = codeOnly(read(UPDATE));
  assert.match(u, /recoveryAsk: next/);
  for (const derivation of ["markup", "ratePct", "rateCategory", "1 + "]) {
    assert.ok(
      !u.includes(derivation),
      `${derivation} would be a new derivation rule this step does not make`,
    );
  }
  assert.match(read(UPDATE), /NULL is not zero/);
});

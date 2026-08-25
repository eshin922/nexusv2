import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";
import { refusalFor } from "../../src/lib/commercial-recovery/resolve.ts";
import {
  describeUnbillablePlacements,
  findUnbillablePlacements,
} from "../../src/lib/commercial-recovery/unbillable-placements.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * A Direct Service's recovery cannot be billed as its own one-time line.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The customer projection builds one-time lines per ASSEMBLY, keyed by the
 * assembly id. A Direct Service leaf has no parent assembly, so it has no such
 * key and cannot produce a fee line at all.
 *
 * The engine placed one there anyway, because a recovery election is per
 * (quote, charge) and therefore reaches every owner of that charge. It then
 * counted the recovery as tier revenue. On quote 4781e4bb:
 *
 *     tier        engine revenue   customer document        gap
 *     1,000 u        23,247.60          21,520.00       1,727.60
 *     5,000 u        52,520.60          49,237.60       3,283.00
 *    10,000 u        97,222.20          97,050.00         172.20
 *    20,000 u       109,327.60         107,600.00       1,727.60
 *
 * Revenue the margin math believed in and the customer was never asked to pay.
 * Both totals are internally consistent; only their disagreement is the defect.
 */

const cell = (charges: unknown[]) => ({ tierId: "t1", constructed: { charges } });
const svc = (placement: string, recoverableSell: number | null = 1727.6) => ({
  chargeKey: "rd_formulation",
  placement,
  ownerKind: "direct_service",
  recoverableSell,
});
const asm = (placement: string) => ({
  chargeKey: "rd_formulation",
  placement,
  ownerKind: "assembly",
  recoverableSell: 1400,
});
const find = (charges: unknown[]) =>
  findUnbillablePlacements({
    skuRollups: [{ skuId: "s1", skuLabel: "SVC-FORMULATION", perTier: [cell(charges)] }] as never,
    tierLabels: new Map([["t1", "Tier 1"]]),
  });

test("`separate` is refused when any part of the charge sits on a Direct Service", () => {
  const reason = refusalFor("rd_formulation", "separate", {
    hasDirectServiceContribution: true,
  });
  assert.ok(reason, "electing it must be refused, not merely hidden");
  assert.match(reason, /Direct Service/);
});

test("the refusal is conditional — it is not a ban on the charge", () => {
  // A quote whose R&D is entirely assembly-owned bills perfectly well on its
  // own line. Refusing it everywhere would remove a legitimate placement to fix
  // a case that does not apply.
  assert.equal(
    refusalFor("rd_formulation", "separate", { hasDirectServiceContribution: false }),
    null,
  );
});

test("In unit price stays available for a Direct Service charge", () => {
  // The business rule is that a Direct Service's recovery may live in the unit
  // price — it is already embodied in that service line's own pricing. Only
  // separate billing is prohibited.
  assert.equal(
    refusalFor("rd_formulation", "included", { hasDirectServiceContribution: true }),
    null,
  );
});

test("the writer refuses it too — the surface is not the boundary", async () => {
  // An election arriving by any other path (a replayed action id, a stale tab)
  // must be refused server-side. The control's refusal is a courtesy.
  const src = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  assert.match(src, /hasDirectServiceContribution: directService\.has\(chargeKey\)/);
  assert.match(src, /async function directServiceChargeKeys/);
});

test("a $0 column is not a contribution", async () => {
  // Refusing a placement on account of a charge that does not exist would deny
  // an operator a legitimate election over no money at all.
  const src = codeOnly(await read("src/app/actions/commercial-recovery.ts"));
  assert.match(src, /Math\.abs\(Number\(raw\)\) > 0/);
});

test("detection finds a Direct Service placed separately", () => {
  const rows = find([svc("separate_line")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.ownerLabel, "SVC-FORMULATION");
  assert.equal(rows[0]!.unbilledRevenue, 1727.6);
  assert.equal(rows[0]!.tierLabel, "Tier 1");
});

test("detection ignores the placements that are fine", () => {
  // An assembly billing separately is the ordinary case, and a Direct Service
  // inside the unit price is the permitted one. Flagging either would refuse
  // sends that are correct.
  assert.deepEqual(find([asm("separate_line")]), []);
  assert.deepEqual(find([svc("unit_price")]), []);
  assert.deepEqual(find([svc("absorbed")]), []);
});

test("an ungoverned amount is reported as unknown, never as zero", () => {
  // BV-013: no governed rate means no price. Printing $0.00 would tell an
  // operator the unbilled revenue is nothing, which is the opposite of true.
  const rows = find([svc("separate_line", null)]);
  assert.equal(rows[0]!.unbilledRevenue, null);
  assert.match(describeUnbillablePlacements(rows)[0]!, /nothing governs/);
  assert.doesNotMatch(describeUnbillablePlacements(rows)[0]!, /\$0\.00/);
});

test("every affected tier is reported, not the first", () => {
  // An operator who resolves one and is then refused for the next has been made
  // to discover the work one item at a time.
  const rows = findUnbillablePlacements({
    skuRollups: [
      {
        skuId: "s1",
        skuLabel: "SVC-FORMULATION",
        perTier: [
          { tierId: "t1", constructed: { charges: [svc("separate_line")] } },
          { tierId: "t2", constructed: { charges: [svc("separate_line", 3283)] } },
        ],
      },
    ] as never,
    tierLabels: new Map([
      ["t1", "Tier 1"],
      ["t2", "Tier 2"],
    ]),
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.tierLabel),
    ["Tier 1", "Tier 2"],
  );
});

test("the send gate refuses before any artifact exists", async () => {
  // A refusal must leave no PDF, no snapshot, no pin, no audit and no status
  // change — the same placement the below-floor gate earned.
  const src = codeOnly(await read("src/app/actions/quotes.ts"));
  const send = src.slice(src.indexOf("requireBelowFloorAuthorizedToSend({"));
  assert.match(send.slice(0, 400), /requireNoUnbillableRecoveryToSend\(\{ quoteId \}\)/);
});

test("the gate reports and does not repair", async () => {
  // Correcting one of these changes what a real customer owes. That is an
  // operator's decision, not a deployment's.
  const src = codeOnly(await read("src/lib/unbillable-recovery-send-gate.ts"));
  for (const forbidden of [/db\.update/, /db\.insert/, /db\.delete/]) {
    assert.doesNotMatch(src, forbidden, "the gate must not write");
  }
  const proj = codeOnly(await read("src/lib/commercial-recovery/unbillable-placements.ts"));
  assert.doesNotMatch(proj, /\bdb\./, "the projection must stay pure");
});

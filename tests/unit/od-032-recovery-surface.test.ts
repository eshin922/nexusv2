/**
 * OD-032 — the Recovery surface at instance grain.
 *
 * The engine half proved that two same-type charges CAN be placed
 * independently. This proves the surface offers that, records it per instance,
 * and refuses to send while any charge is undecided.
 *
 * Structural where the claim is about wiring — a control that writes the wrong
 * shape is a defect no rendering test would catch — and behavioural where the
 * claim is about projection.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildRecoveryWorkspace } from "../../src/lib/commercial-recovery/workspace-view.ts";
import type { ConstructedRollups } from "../../src/lib/commercial-recovery/construct.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

/**
 * The single tier's amounts, for fixtures that have exactly one.
 *
 * Asserting the count is part of the read: these fixtures are single-tier, and
 * a helper that silently took the first entry would hide the very multiplicity
 * this repair is about.
 */
function only(row: { perTier: { cost: number; recovery: number | null }[] }) {
  assert.equal(row.perTier.length, 1, "fixture is single-tier");
  return row.perTier[0];
}

const CARD = "src/components/quote/card-commercial-recovery.tsx";
const HOOK = "src/components/quote/use-recovery-draft.ts";
const PERSIST = "src/app/actions/commercial-recovery-persist.ts";
const SEND = "src/app/actions/quotes.ts";

const read = (p: string) => readFileSync(p, "utf8");
/** Comments are prose, not behaviour. Matching one as a use has misled before. */
const codeOnly = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), "");

const LEAF_A = "leaf-a";
const LEAF_B = "leaf-b";
const TIER = "tier-1";

/** A constructed state with the charges given, all owned by one rollup. */
function costing(
  charges: {
    instance?: string;
    key?: string;
    owner?: string;
    placement: string;
    source: string;
    cost: number;
    sell: number | null;
  }[],
): ConstructedRollups {
  return {
    skuRollups: [
      {
        skuId: "leaf",
        perTier: [
          {
            tierId: TIER,
            constructed: {
              charges: charges.map((c) => ({
                chargeKey: c.key ?? "print_plates",
                chargeInstanceId: c.instance,
                ownerKind: c.instance ? "component" : "assembly",
                ownerRef: c.owner,
                placement: c.placement,
                source: c.source,
                cost: c.cost,
                recoverableSell: c.sell,
                revenueContribution: c.placement === "unplaced" ? null : c.sell,
                separateInvoiceAmount: 0,
                amortization: null,
              })),
            },
          },
        ],
      },
    ],
  } as unknown as ConstructedRollups;
}

const build = (
  charges: Parameters<typeof costing>[0],
  elections: ChargeElection[] = [],
  names?: ReadonlyMap<string, string>,
) =>
  buildRecoveryWorkspace({
    costing: costing(charges),
    elections,
    allocationStates: [true],
    isLeaf: (id) => id === "leaf",
    ownerNames: names,
  });

const componentRows = (...args: Parameters<typeof build>) =>
  build(...args).filter((r) => r.chargeInstanceId);

// ══════════════════════════════════════════════════════════════════════
// One row per charge instance
// ══════════════════════════════════════════════════════════════════════

test("two same-type charges produce TWO rows, not one aggregate", () => {
  const rows = componentRows([
    { instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 },
    { instance: "i2", owner: LEAF_A, placement: "separate_line", source: "election", cost: 325, sell: 325 },
  ]);

  assert.equal(rows.length, 2);
  // Each carries its OWN amount. An aggregate row would carry 1775 and one
  // control, which is the collapse the grain removes.
  assert.deepEqual(rows.map((r) => only(r).cost ?? 0).sort((a, b) => a - b), [325, 1450]);
  // And neither is `mixed`: one charge has one placement, so the state that
  // used to mean "this row covers charges placed differently" cannot arise.
  assert.ok(rows.every((r) => !r.mixed));
});

test("a component row never merges into its type's legacy row", () => {
  const rows = build([
    { instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 },
  ]);
  const typeRow = rows.find(
    (r) => r.chargeKey === "print_plates" && !r.chargeInstanceId,
  );
  // The type row exists (every policy gets one) but must carry NOTHING of the
  // component charge — otherwise the amount is on screen twice and one of the
  // two controls moves nothing.
  assert.equal(typeRow?.present, false);
  // EMPTY, not a zero total. A vector of zeroes would claim the type row costs
  // nothing in every scenario; an empty one says it has no economics at all,
  // which is the truth — the component charge carries them.
  assert.deepEqual(typeRow?.perTier, []);
});

// ══════════════════════════════════════════════════════════════════════
// Collision-only owner naming
// ══════════════════════════════════════════════════════════════════════

test("ONE charge of a type gets no owner label", () => {
  const [row] = componentRows(
    [{ instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 }],
    [],
    new Map([[LEAF_A, "Kids' Cough carton"]]),
  );
  // Nature reads; lineage does not need to. Labelling an unambiguous row would
  // put provenance on a surface where the type already says everything.
  assert.equal(row.ownerLabel, null);
});

test("TWO charges of a type both get owner labels", () => {
  const rows = componentRows(
    [
      { instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 },
      { instance: "i2", owner: LEAF_B, placement: "unit_price", source: "election", cost: 600, sell: 600 },
    ],
    [],
    new Map([
      [LEAF_A, "Kids' Cough carton"],
      [LEAF_B, "Dropper sleeve"],
    ]),
  );
  assert.deepEqual(
    rows.map((r) => r.ownerLabel).sort(),
    ["Dropper sleeve", "Kids' Cough carton"],
  );
});

test("a missing name shows NO label rather than an id", () => {
  // An operator cannot act on a uuid, and printing one would be worse than the
  // ambiguity it was meant to resolve.
  const rows = componentRows(
    [
      { instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 },
      { instance: "i2", owner: LEAF_B, placement: "unit_price", source: "election", cost: 600, sell: 600 },
    ],
    [],
    new Map(),
  );
  assert.ok(rows.every((r) => r.ownerLabel === null));
});

test("a LEGACY row is never given an owner label", () => {
  // Its owner is the engagement, and its anchor must never be surfaced as a
  // cause — the OD-028 rule, held at the surface as well as in the record.
  const rows = build([
    { key: "project_setup", placement: "unit_price", source: "legacy", cost: 1200, sell: 1680 },
  ]);
  const legacy = rows.find((r) => r.chargeKey === "project_setup");
  assert.equal(legacy?.ownerLabel, undefined);
  assert.equal(legacy?.chargeInstanceId, undefined);
});

// ══════════════════════════════════════════════════════════════════════
// Unplaced, visible
// ══════════════════════════════════════════════════════════════════════

test("an unplaced charge is flagged and offers no treatment as in force", () => {
  const [row] = componentRows([
    { instance: "i1", owner: LEAF_A, placement: "unplaced", source: "unplaced", cost: 1450, sell: 1450 },
  ]);
  assert.equal(row.unplaced, true);
  // No mode is shown as selected, because none was chosen.
  assert.equal(row.effectiveMode, null);
  // Cost is still real — DPS paid it.
  assert.equal(only(row).cost, 1450);
});

test("a legacy row is never unplaced", () => {
  const rows = build([
    { key: "project_setup", placement: "unit_price", source: "legacy", cost: 1200, sell: 1680 },
  ]);
  assert.ok(rows.every((r) => r.unplaced === false));
});

test("the card SAYS unplaced rather than leaving it blank", () => {
  const card = codeOnly(read(CARD));
  assert.match(card, /row\.unplaced\s*\n?\s*\?\s*" · not yet decided/);
  // And offers no relinquish control on it — an undecided charge has no
  // election to give up.
  assert.match(card, /row\.source === "election" && !row\.unplaced && editable/);
});

// ══════════════════════════════════════════════════════════════════════
// The group action — N governed writes, never type-level state
// ══════════════════════════════════════════════════════════════════════

test("the group control writes every instance individually", () => {
  const card = codeOnly(read(CARD));
  // It passes the GROUP — an array of rows — to the same writer a single click
  // uses, so the two cannot diverge in what they store.
  assert.match(card, /onClick=\{\(\) => write\(group!, opt\.mode\)\}/);
  assert.match(card, /function write\(subjects: RecoveryChargeRow\[\]/);
  // Which becomes one pick per row, each carrying its own instance.
  assert.match(card, /subjects\.map\(\(r\) => \(\{/);
  assert.match(card, /chargeInstanceId: r\.chargeInstanceId/);
});

test("NON-VACUOUS · nothing in the write path can express a type-level election for a component charge", () => {
  // The claim the contract asks for, held where it can actually be broken.
  //
  // A group action is N per-instance writes. If any layer could store one
  // type-grained row for a component charge, the group would be indistinguish-
  // able from the grain it replaced — so each layer is checked for the shape
  // that would allow it.
  const hook = codeOnly(read(HOOK));
  // The hook composes N picks, each keyed by instance where one exists.
  assert.match(hook, /for \(const pick of picks\)/);
  assert.match(hook, /export function electionKey/);
  assert.match(hook, /e\.chargeInstanceId \?\? e\.chargeKey/);

  const persist = codeOnly(read(PERSIST));
  // The writer NEVER synthesises an instance for a proposal that names one —
  // synthesising would mint a '@quote' row and key the election to a charge
  // nobody caused, which is a type-level election wearing an instance id.
  assert.match(
    persist,
    /proposal\.chargeInstanceId \?\?\s*\n?\s*\(await ensureChargeInstance/,
  );
  // And the delete is keyed by instance, so clearing one cannot take a sibling.
  assert.match(persist, /inArray\(\s*\n?\s*quoteChargeRecovery\.chargeInstanceId/);
  assert.ok(
    !/inArray\(\s*\n?\s*quoteChargeRecovery\.chargeKey/.test(persist),
    "clearing by type would clear a sibling nobody named",
  );

  // And the ENGINE refuses to honour one: a component charge reads only the
  // instance map. Asserted in the engine suite too, restated here because it
  // is what makes every layer above it safe.
  const construct = codeOnly(read("src/lib/commercial-recovery/construct.ts"));
  assert.match(
    construct,
    /e\.chargeInstanceId\s*\n?\s*\?\s*\(byInstance\.get\(e\.chargeInstanceId\) \?\? null\)\s*\n?\s*:\s*\(byType\.get/,
  );
});

test("the group control appears only where there is a group", () => {
  const card = codeOnly(read(CARD));
  // "Set all" over a set of one is the row's own buttons wearing a hat.
  assert.match(card, /if \(list\.length < 2\) groupable\.delete\(k\)/);
  assert.match(card, /leadsGroup && editable/);
});

test("a group action waits for ALL of its rows", () => {
  const card = codeOnly(read(CARD));
  // Ending the wait on the first would clear "saving" while the rest were
  // still in flight.
  assert.match(card, /subjects\.length > 0 && subjects\.every\(answered\)/);
});

// ══════════════════════════════════════════════════════════════════════
// Readiness
// ══════════════════════════════════════════════════════════════════════

test("send refuses while any charge is unplaced, and names them", () => {
  const send = codeOnly(read(SEND));
  assert.match(send, /const unplaced = resolved\.recoveryRows\.filter\(\(r\) => r\.unplaced\)/);
  assert.match(send, /if \(unplaced\.length > 0\)/);
  // NAMED. A refusal that says only "something is undecided" leaves the
  // operator hunting a surface they have already looked at.
  assert.match(send, /Recovery is undecided for \$\{unplaced\.length\}/);
  assert.match(send, /r\.ownerLabel \? `\$\{r\.label\} · \$\{r\.ownerLabel\}` : r\.label/);
});

test("the refusal precedes the freeze, and the freeze refuses too", () => {
  const send = codeOnly(read(SEND));
  const frozen = codeOnly(read("src/lib/commercial-recovery/frozen-instruction.ts"));
  // Ordering: readiness refuses BEFORE the transaction, so the operator gets a
  // sentence instead of an unexplained throw from inside a freeze.
  // Compared against the INSERT, not the bare identifier: the import sits at
  // the top of the file and would make any ordering look wrong. An instrument
  // that cannot tell an import from a use answers a different question.
  const freezeWrite = send.indexOf(
    "tx.insert(quoteSnapshotRecoveryInstructions)",
  );
  const refusal = send.indexOf("Recovery is undecided");
  assert.ok(freezeWrite > 0, "the freeze write was not found");
  assert.ok(refusal > 0, "the readiness refusal was not found");
  assert.ok(
    refusal < freezeWrite,
    "the readiness refusal must precede the freeze write",
  );
  // Belt and braces, and not redundant: the freeze is reachable from paths
  // readiness does not gate, and freezing an undecided charge as `absorbed`
  // would record a margin decision nobody made.
  assert.match(frozen, /Cannot freeze an unplaced charge/);
});

// ══════════════════════════════════════════════════════════════════════
// A group action is all-or-nothing
// ══════════════════════════════════════════════════════════════════════

test("no charge is written unless the WHOLE proposal is allowed", () => {
  // ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────
  //
  // The writer refused mid-loop. A group action of three where the third was
  // refused left the FIRST TWO WRITTEN — an operator who set all three plate
  // sets to a mode one of them could not carry found two changed, one not, and
  // an error explaining none of it.
  //
  // It predates the group action: the loop was always per-charge. What the
  // group action changed is that one gesture can now reach it.
  const persist = codeOnly(read(PERSIST));

  // Every refusal is evaluated BEFORE the write loop begins.
  const refusalPass = persist.indexOf("for (const { chargeKey, mode } of changing)");
  const writeLoop = persist.indexOf("for (const proposal of changing)");
  assert.ok(refusalPass > 0, "the set-wide refusal pass was not found");
  assert.ok(writeLoop > 0, "the write loop was not found");
  assert.ok(
    refusalPass < writeLoop,
    "every refusal must be decided before the first write",
  );

  // And the refusal pass must contain the assertion, not merely precede it.
  const pass = persist.slice(refusalPass, writeLoop);
  assert.match(pass, /assertElectionAllowed\(chargeKey, mode, ctx\)/);
  // Which means the write loop no longer carries one — two refusal sites would
  // be two answers, and the second could still fire mid-write.
  const body = persist.slice(writeLoop);
  assert.ok(
    !/assertElectionAllowed/.test(body.slice(0, 1200)),
    "the write loop must not refuse — refusing there is what wrote two of three",
  );
});

test("the writes and their audit rows share ONE transaction", () => {
  // Refusals are decided up front, so nothing allowed is refused later. This
  // covers everything that can still fail AFTER the first statement lands: a
  // constraint, a lost connection, an instance that cannot be resolved.
  //
  // Two of three plate sets moved is not a partial success. It is a state
  // nobody chose, and the operator cannot tell which two.
  const persist = codeOnly(read(PERSIST));
  assert.match(persist, /await db\.transaction\(async \(tx\) => \{/);

  const tx = persist.slice(persist.indexOf("await db.transaction"));
  // Every write inside goes through the transaction handle.
  assert.match(tx, /await tx\s*\n?\s*\.insert\(quoteChargeRecovery\)/);
  assert.match(tx, /await tx\.delete\(quoteChargeRecovery\)/);
  assert.match(tx, /ensureChargeInstance\(tx, \{ quoteId, chargeKey \}\)/);
  // Including the audit, so the record cannot survive a rolled-back write.
  // COUNTED, not pattern-matched for absence. A lazy scan looking for a call's
  // closing brace finds the first `}` INSIDE the object instead, and reports a
  // bare call that is not there — an instrument that cannot express the thing
  // it is asked about.
  const auditCalls = (tx.match(/writeAuditEntry\(/g) ?? []).length;
  // Matched on the ARGUMENT, not on how the call happens to wrap. The previous
  // pattern pinned an exact newline-and-indent shape and reported zero the
  // first time the formatter moved a line — an instrument measuring layout
  // while claiming to measure an argument.
  const withTx = (tx.match(/\btx,\s*\n\s*\)/g) ?? []).length;
  assert.equal(auditCalls, 2, "both audit paths must be inside the transaction");
  assert.equal(
    withTx,
    auditCalls,
    "every audit call must pass the transaction, or its row outlives a rollback",
  );

  // NON-VACUOUS: no bare `db.` write may remain inside the transaction body.
  assert.ok(
    !/await db\.(insert|delete|update)\(/.test(tx),
    "a bare db write inside the transaction would not roll back with it",
  );
});

// ══════════════════════════════════════════════════════════════════════
// A RECORDED LIMIT — duplicate component display names
// ══════════════════════════════════════════════════════════════════════

test("BOUNDARY · two owners with the SAME display name still read alike", () => {
  // ── MEASURED, NOT ASSUMED ──────────────────────────────────────────────
  //
  // Collision-only labelling disambiguates by component NAME. Where two
  // components share a name — two cartons both called "Carton" — the labels
  // collide too and the rows read identically:
  //
  //   Print plates · Carton   (1450)
  //   Print plates · Carton   (600)
  //
  // The rows remain independently ADDRESSABLE — separate instances, separate
  // controls, separate writes — so nothing is mis-placed. What is degraded is
  // the operator's ability to tell which row is which by its label alone; the
  // amounts differ and are on screen beside them.
  //
  // NOT FIXED HERE, deliberately. The design's own second disambiguator is the
  // charge's operator LABEL ("Selecting a type the component already owns...
  // offers a second instance with a distinct label required"), and labels can
  // only be authored by the phase-4 sheet. Threading one through economics,
  // placement and the row today would carry nothing but nulls.
  //
  // TODO(od-032-phase-4): carry the instance label and use it as the second
  // disambiguator, then replace this with its inverse.
  const rows = componentRows(
    [
      { instance: "i1", owner: LEAF_A, placement: "unit_price", source: "election", cost: 1450, sell: 1450 },
      { instance: "i2", owner: LEAF_B, placement: "unit_price", source: "election", cost: 600, sell: 600 },
    ],
    [],
    new Map([
      [LEAF_A, "Carton"],
      [LEAF_B, "Carton"],
    ]),
  );

  const labels = rows.map((r) => `${r.label} · ${r.ownerLabel}`);
  assert.equal(
    new Set(labels).size,
    1,
    "the labels became distinguishable — if a second disambiguator now exists, " +
      "this test has done its job and should assert that instead",
  );

  // What must NOT degrade: the rows are still separate charges with separate
  // identities and separate amounts. Ambiguous to read is not ambiguous to act
  // on — each control still addresses exactly one charge.
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.chargeInstanceId)).size, 2);
  assert.deepEqual(rows.map((r) => only(r).cost ?? 0).sort((a, b) => a - b), [600, 1450]);
});


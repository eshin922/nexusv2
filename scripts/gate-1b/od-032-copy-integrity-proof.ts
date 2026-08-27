/**
 * OD-032 copy integrity — P-1 and P-2, proven by transaction.
 *
 * A structural claim is proven by a transaction that performs it, never by
 * reading the action layer. Every write here happens inside a transaction that
 * ALWAYS rolls back, and the final check asserts nothing persisted.
 *
 * ── WHAT IS BEING PROVEN ─────────────────────────────────────────────────
 *
 * P-1  `ensureChargeInstance` can create a component-owned instance at all.
 *      Before this change Phase 2's owner-agreement CHECK refused it, because
 *      the helper wrote `owner_ref` alone and satisfied neither branch.
 *
 * P-2  `cloneQuoteGraph` carries a component charge COMPLETELY: its causal
 *      owner remapped to the cloned component, its label, the separation
 *      between two same-type charges, and its per-tier money.
 *
 * ── THE FIXTURE IS BUILT SO EACH CHECK CAN FAIL ──────────────────────────
 *
 * Two charges of ONE type on ONE component, distinguished only by label, with
 * DIFFERENT amounts. If the copy collapsed them, or swapped them, or dropped
 * one, the amounts differ and the check says so. Equal amounts would make a
 * collapse and a correct copy indistinguishable — the same trap the phase 2
 * fixture avoids by using qtyPerParent 3 rather than 1.
 *
 *   usage: npm run gate1b:od-032-copy-integrity
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteChargeInstanceTiers,
  quoteChargeInstances,
  quoteChargeRecovery,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import { cloneQuoteGraph } from "@/app/actions/quotes";
import { ensureChargeInstance } from "@/lib/commercial-recovery/charge-instance";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

class Rollback extends Error {}

/** Two charges of one type on one carton, told apart only by label. */
const PLATES_A = { label: "First pass", cost: "1450.00", ask: "1740.00" };
const PLATES_B = { label: "Second pass", cost: "325.00", ask: "390.00" };

async function main() {
  // A draft quote with at least two leaves and at least one tier.
  const candidates = await db
    .select({ id: quotes.id, projectId: quotes.projectId, createdBy: quotes.createdByUserId })
    .from(quotes)
    .where(eq(quotes.status, "draft"))
    .limit(50);

  let source: (typeof candidates)[number] | null = null;
  let leaves: { id: string }[] = [];
  let tiers: { id: string }[] = [];
  for (const c of candidates) {
    const l = await db
      .select({ id: quoteLeaves.id })
      .from(quoteLeaves)
      .where(eq(quoteLeaves.quoteId, c.id));
    const t = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, c.id));
    if (l.length >= 2 && t.length >= 1 && c.createdBy) {
      source = c;
      leaves = l;
      tiers = t;
      break;
    }
  }
  if (!source) {
    console.error("no draft quote with 2+ leaves and 1+ tier — cannot prove");
    process.exit(1);
  }

  const [leafA, leafB] = leaves;
  const tier = tiers[0];
  console.log(`subject : ${source.id}`);
  console.log(`leaves  : ${leafA.id.slice(0, 8)} / ${leafB.id.slice(0, 8)}`);
  console.log(`tier    : ${tier.id.slice(0, 8)}\n`);

  try {
    await db.transaction(async (tx) => {
      // ── P-1 · the helper can create a component-owned instance ──────────
      const idA = await ensureChargeInstance(tx, {
        quoteId: source!.id,
        chargeKey: "print_plates",
        ownerRef: leafA.id,
        label: PLATES_A.label,
      });
      const [rowA] = await tx
        .select({
          ownerRef: quoteChargeInstances.ownerRef,
          ownerLeaf: quoteChargeInstances.ownerQuoteLeafId,
        })
        .from(quoteChargeInstances)
        .where(eq(quoteChargeInstances.id, idA));
      record(
        "P-1 · a component-owned instance is created",
        rowA?.ownerRef === leafA.id && rowA?.ownerLeaf === leafA.id,
        `owner_ref=${rowA?.ownerRef?.slice(0, 8)} owner_quote_leaf_id=${rowA?.ownerLeaf?.slice(0, 8)}`,
      );

      // Idempotence on the component path — the property phase 1 relies on,
      // now exercised where the owner is not the sentinel.
      const idAgain = await ensureChargeInstance(tx, {
        quoteId: source!.id,
        chargeKey: "print_plates",
        ownerRef: leafA.id,
        label: PLATES_A.label,
      });
      record("P-1 · a second call resolves rather than duplicates", idAgain === idA);

      // CONTROL: the branch that already worked must not have moved.
      const idQuote = await ensureChargeInstance(tx, {
        quoteId: source!.id,
        chargeKey: "project_setup",
      });
      const [rowQ] = await tx
        .select({
          ownerRef: quoteChargeInstances.ownerRef,
          ownerLeaf: quoteChargeInstances.ownerQuoteLeafId,
        })
        .from(quoteChargeInstances)
        .where(eq(quoteChargeInstances.id, idQuote));
      record(
        "P-1 · CONTROL · a quote-owned instance still writes a NULL leaf",
        rowQ?.ownerRef === "@quote" && rowQ?.ownerLeaf === null,
        `owner_ref=${rowQ?.ownerRef} owner_quote_leaf_id=${rowQ?.ownerLeaf}`,
      );

      // Second instance, same type, same component, different label.
      const idB = await ensureChargeInstance(tx, {
        quoteId: source!.id,
        chargeKey: "print_plates",
        ownerRef: leafA.id,
        label: PLATES_B.label,
      });
      record(
        "P-1 · one component owns two of one type, told apart by label",
        idB !== idA,
      );

      // Per-tier money, deliberately different per charge.
      await tx.insert(quoteChargeInstanceTiers).values([
        { chargeInstanceId: idA, tierId: tier.id, costAmount: PLATES_A.cost, recoveryAsk: PLATES_A.ask },
        { chargeInstanceId: idB, tierId: tier.id, costAmount: PLATES_B.cost, recoveryAsk: PLATES_B.ask },
        // A NULL ask, to prove NULL carries as NULL rather than becoming zero.
        { chargeInstanceId: idQuote, tierId: tier.id, costAmount: "900.00", recoveryAsk: null },
      ]);

      // One election, on charge A only — so the copy must also carry an
      // instance that has NO election, which an election-driven copy would drop.
      await tx.insert(quoteChargeRecovery).values({
        quoteId: source!.id,
        chargeKey: "print_plates",
        chargeInstanceId: idA,
        mode: "separate",
        electedByUserId: source!.createdBy!,
      });

      // ── P-2 · the copy ──────────────────────────────────────────────────
      const { newQuoteId } = await cloneQuoteGraph(tx, {
        sourceQuoteId: source!.id,
        targetProjectId: source!.projectId,
        newScenarioLabel: "ZZ-VALIDATION-copy-integrity",
        intentNote: null,
        customerTargetTierLabel: null,
        createdByUserId: source!.createdBy!,
      });

      const copied = await tx
        .select({
          id: quoteChargeInstances.id,
          chargeKey: quoteChargeInstances.chargeKey,
          ownerRef: quoteChargeInstances.ownerRef,
          ownerLeaf: quoteChargeInstances.ownerQuoteLeafId,
          label: quoteChargeInstances.label,
        })
        .from(quoteChargeInstances)
        .where(eq(quoteChargeInstances.quoteId, newQuoteId));

      const plates = copied.filter((c) => c.chargeKey === "print_plates");
      record(
        "P-2 · two same-type charges stay two on the copy",
        plates.length === 2,
        `${plates.length} print_plates instance(s) — a collapse would give 1`,
      );
      record(
        "P-2 · labels survive",
        [...plates.map((p) => p.label)].sort().join("|") ===
          [PLATES_A.label, PLATES_B.label].sort().join("|"),
        plates.map((p) => p.label).join(", "),
      );

      // The owner must be a leaf on the COPY, not the source's leaf.
      const copyLeafIds = new Set(
        (
          await tx
            .select({ id: quoteLeaves.id })
            .from(quoteLeaves)
            .where(eq(quoteLeaves.quoteId, newQuoteId))
        ).map((l) => l.id),
      );
      const remapped =
        plates.length === 2 &&
        plates.every(
          (p) =>
            p.ownerLeaf !== null &&
            p.ownerLeaf !== leafA.id &&
            copyLeafIds.has(p.ownerLeaf) &&
            p.ownerRef === p.ownerLeaf,
        );
      record(
        "P-2 · the causal owner is remapped to the cloned component",
        remapped,
        remapped
          ? "both owner columns agree and point at a leaf on the copy"
          : `owners=${plates.map((p) => p.ownerLeaf?.slice(0, 8)).join(",")} source leaf=${leafA.id.slice(0, 8)}`,
      );

      // The instances are the copy's own, never the source's.
      const sourceIds = new Set([idA, idB, idQuote]);
      record(
        "P-2 · the copy gets its own instance ids",
        copied.every((c) => !sourceIds.has(c.id)),
      );

      // Money, per (instance, tier). A total can agree while two charges swap.
      const copyTierRows = await tx
        .select({
          chargeInstanceId: quoteChargeInstanceTiers.chargeInstanceId,
          costAmount: quoteChargeInstanceTiers.costAmount,
          recoveryAsk: quoteChargeInstanceTiers.recoveryAsk,
        })
        .from(quoteChargeInstanceTiers)
        .where(
          inArray(
            quoteChargeInstanceTiers.chargeInstanceId,
            copied.map((c) => c.id),
          ),
        );
      const byLabel = new Map(plates.map((p) => [p.id, p.label]));
      const pairs = copyTierRows
        .filter((r) => byLabel.has(r.chargeInstanceId))
        .map((r) => `${byLabel.get(r.chargeInstanceId)}=${r.costAmount}/${r.recoveryAsk}`)
        .sort();
      record(
        "P-2 · per-tier money carries, matched to the right charge",
        pairs.join("|") ===
          [
            `${PLATES_A.label}=${PLATES_A.cost}/${PLATES_A.ask}`,
            `${PLATES_B.label}=${PLATES_B.cost}/${PLATES_B.ask}`,
          ].sort().join("|"),
        pairs.join(" · "),
      );

      // NULL is not zero. Coercing it would turn "nothing governs what this
      // recovers" into "this recovers nothing" — a different commercial claim.
      const quoteOwned = copied.find((c) => c.chargeKey === "project_setup");
      const quoteRow = copyTierRows.find((r) => r.chargeInstanceId === quoteOwned?.id);
      record(
        "P-2 · a NULL recovery ask carries as NULL, not as zero",
        quoteRow?.recoveryAsk === null && quoteRow?.costAmount === "900.00",
        `cost=${quoteRow?.costAmount} ask=${quoteRow?.recoveryAsk}`,
      );

      // CONTROL: the legacy path. A quote-owned charge copies exactly as it
      // always did — sentinel owner, NULL leaf.
      record(
        "P-2 · CONTROL · a quote-owned charge copies unchanged",
        quoteOwned?.ownerRef === "@quote" && quoteOwned?.ownerLeaf === null,
        `owner_ref=${quoteOwned?.ownerRef} leaf=${quoteOwned?.ownerLeaf}`,
      );

      // The unplaced charge survived. An election-driven copy would drop B,
      // because only A was elected.
      const copyElections = await tx
        .select({ chargeInstanceId: quoteChargeRecovery.chargeInstanceId })
        .from(quoteChargeRecovery)
        .where(eq(quoteChargeRecovery.quoteId, newQuoteId));
      const electedLabels = copyElections
        .map((e) => byLabel.get(e.chargeInstanceId))
        .filter(Boolean);
      record(
        "P-2 · an UNPLACED charge survives the copy",
        plates.length === 2 && electedLabels.length === 1 && electedLabels[0] === PLATES_A.label,
        `${plates.length} charge(s), ${copyElections.length} election(s) — B was never elected and must still exist`,
      );

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      console.error("\nUNEXPECTED:", (e as Error).message);
      process.exit(1);
    }
  }

  // ── nothing persisted ────────────────────────────────────────────────────
  const leftInstances = await db
    .select({ id: quoteChargeInstances.id })
    .from(quoteChargeInstances)
    .where(
      and(
        eq(quoteChargeInstances.quoteId, source.id),
        eq(quoteChargeInstances.chargeKey, "print_plates"),
      ),
    );
  const leftQuotes = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.scenarioLabel, "ZZ-VALIDATION-copy-integrity"));
  console.log("");
  record(
    "nothing persisted",
    leftInstances.length === 0 && leftQuotes.length === 0,
    `${leftInstances.length} instance(s), ${leftQuotes.length} copied quote(s) (expect 0 / 0)`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PROOF: PASS" : "PROOF: FAIL"} (${results.length - failed.length}/${results.length})`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();

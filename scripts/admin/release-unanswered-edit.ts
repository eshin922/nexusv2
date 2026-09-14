/**
 * SUPPORT PROCEDURE — release a product whose earlier HubSpot request was
 * never answered.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * A product edit failed without HubSpot answering. A retry has since brought
 * both catalogs to the saved values, so the product LOOKS correct — and it is,
 * right now. What is not known is whether the original request is still in
 * flight somewhere. If it is, and it lands after someone makes a DIFFERENT
 * edit, HubSpot silently reverts to the older values while Nexus keeps the
 * newer ones.
 *
 * Nexus blocks different edits for exactly that reason. This releases the
 * block.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * It does not establish that the original request has finished. Nothing
 * available establishes that: HubSpot CRM publishes no request-status API, no
 * conditional writes, and no maximum request lifetime, so neither another read
 * nor more waiting is evidence. This records a decision to proceed WITHOUT
 * that evidence, attributed to the person who made it.
 *
 * ── THE RESIDUAL RISK ─────────────────────────────────────────────────────
 *
 * After release, the next different edit to this product can be overwritten by
 * the original request landing late. The two catalogs would then disagree with
 * nothing reporting it.
 *
 * The probability is NOT QUANTIFIED, and cannot be from here: it depends on
 * HubSpot-side behaviour that is not published. Nothing in this file should be
 * read as a claim that the window is short, that the situation is rare, or
 * that the exposure is small. Those would be guesses wearing the clothes of
 * evidence.
 *
 * What is known: the values at stake are the ones already saved, and a
 * divergence is repairable by editing the product again once someone notices.
 *
 * ── WHEN TO USE IT ────────────────────────────────────────────────────────
 *
 * When a product is blocked on `converged_unknown` and the operator needs to
 * edit it. Using this is a conscious acceptance of unquantified risk, taken by
 * a named person for a recorded reason -- which is why it is an admin action
 * and not a button on the operator's screen.
 *
 *   npm run admin:release-unanswered -- --leaf <uuid> --user <uuid> \\
 *     --note "waited 24h, DPS ops confirmed the product looks correct"
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { leafEditAttempts, leaves, users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const leafId = arg("leaf");
  const userId = arg("user");
  const note = arg("note");

  if (!leafId || !userId || !note) {
    console.error(
      "usage: --leaf <uuid> --user <uuid> --note <why this is being released>\n\n" +
        "All three are required. The note is recorded against the product and " +
        "is the only account of why the block was lifted without evidence that " +
        "the original request finished.",
    );
    process.exit(2);
  }

  const [actor] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!actor) {
    console.error(`No user ${userId}.`);
    process.exit(2);
  }

  const [leaf] = await db.select().from(leaves).where(eq(leaves.id, leafId)).limit(1);
  if (!leaf) {
    console.error(`No product ${leafId}.`);
    process.exit(2);
  }

  const [open] = await db
    .select()
    .from(leafEditAttempts)
    .where(
      and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)),
    )
    .limit(1);
  if (!open) {
    console.error("This product has no saved edit outstanding. Nothing to release.");
    process.exit(2);
  }

  if (open.outcome !== "converged_unknown") {
    // Everything else has a working remedy that does not need this.
    console.error(
      `This product's saved edit is "${open.outcome}", not "converged_unknown".\n\n` +
        (open.outcome === "diverged"
          ? "HubSpot answered and applied that edit; only Nexus failed to record " +
            "it. Retry the saved edit from the Library instead — nothing is " +
            "outstanding and it releases normally."
          : open.outcome === "unconfirmed"
            ? "It has not been retried yet. Retry it from the Library first: the " +
              "retry re-sends exactly what was asked for and may settle this " +
              "without needing a decision."
            : "It is still in flight. Wait for it to finish."),
    );
    process.exit(2);
  }

  console.log(`Product   ${leaf.name}`);
  console.log(`SKU       ${leaf.sku ?? "(none)"}`);
  console.log(`Attempt   ${open.id} · outcome=${open.outcome}`);
  console.log(`Reason    ${open.reason ?? "(none recorded)"}`);
  console.log("");
  console.log("Releasing does NOT establish that the original request finished.");
  console.log("The next different edit to this product can be overwritten by it.");
  console.log("The risk is UNQUANTIFIED -- not small, not rare, not measured.");
  console.log("");

  // ── THE RELEASE IS CONDITIONAL ON WHAT WAS REVIEWED ───────────────────
  //
  // The row printed above is what the operator judged. Between that read and
  // this write it can move: a retry can claim it and bump the version, another
  // release can resolve it, its outcome can change. Releasing by id alone
  // would apply a decision to a state nobody looked at.
  //
  // So the update carries the version, the outcome and the open-ness that were
  // reviewed. Zero rows means the thing being released is not the thing that
  // was examined -- and then NOTHING is written, audit included. An audit row
  // for a release that did not happen is worse than no record: it is a false
  // one.
  const released = await db
    .update(leafEditAttempts)
    .set({
      resolvedAt: new Date(),
      resolution: "released_with_residual_risk",
      releasedWithRiskBy: userId,
      releasedWithRiskAt: new Date(),
      releasedWithRiskNote: note,
      version: open.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(leafEditAttempts.id, open.id),
        eq(leafEditAttempts.version, open.version),
        eq(leafEditAttempts.outcome, "converged_unknown"),
        isNull(leafEditAttempts.resolvedAt),
      ),
    )
    .returning({ id: leafEditAttempts.id });

  if (released.length === 0) {
    console.error(
      "\nThis saved edit moved while it was being reviewed -- it has been " +
        "retried, released, or has changed state since it was read.\n" +
        "NOTHING was released and nothing was recorded. Re-run to see where it " +
        "stands now.",
    );
    process.exit(1);
  }

  await writeAuditEntry({
    userId,
    entityType: "leaf",
    entityId: leafId,
    action: "leaf_edit_released_with_risk",
    diffJson: {
      attempt_id: open.id,
      attempt_version_reviewed: open.version,
      prior_outcome: open.outcome,
      dispatched_count: open.dispatchedCount,
      answered_count: open.answeredCount,
      note,
      establishes:
        "nothing about whether the original request finished; a decision to " +
        "proceed without that evidence",
    },
  });

  console.log(`Released by ${actor.email ?? userId}.`);
  console.log(`Recorded: ${note}`);
}

await main();
process.exit(0);

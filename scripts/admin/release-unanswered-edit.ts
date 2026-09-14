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
 * ── THE RESIDUAL RISK, STATED PLAINLY ─────────────────────────────────────
 *
 * After release, the next different edit to this product can be overwritten by
 * the original request landing late. The two catalogs would then disagree with
 * nothing reporting it. Probability is not quantified here because it cannot
 * be: it depends on HubSpot-side behaviour that is not published.
 *
 * What makes it tolerable in practice is the shape of the exposure:
 *
 *   - the window is bounded by whatever HubSpot's real request lifetime is,
 *     which is short in the ordinary case even though it is not documented;
 *   - the values at stake are the ones already saved, not arbitrary ones;
 *   - the divergence is repairable by editing the product again once noticed.
 *
 * ── WHEN TO USE IT ────────────────────────────────────────────────────────
 *
 * When a product is blocked on `converged_unknown`, the operator needs to edit
 * it, and enough time has passed that a still-in-flight request is implausible.
 * "Implausible" is a judgement, not a measurement — which is why this is a
 * deliberate admin action with a recorded reason rather than a button on the
 * operator's screen.
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
  console.log("");

  await db.transaction(async (tx) => {
    await tx
      .update(leafEditAttempts)
      .set({
        resolvedAt: new Date(),
        resolution: "released_with_residual_risk",
        releasedWithRiskBy: userId,
        releasedWithRiskAt: new Date(),
        releasedWithRiskNote: note,
        updatedAt: new Date(),
      })
      .where(eq(leafEditAttempts.id, open.id));

    await writeAuditEntry(
      {
        userId,
        entityType: "leaf",
        entityId: leafId,
        action: "leaf_edit_released_with_risk",
        diffJson: {
          attempt_id: open.id,
          prior_outcome: open.outcome,
          note,
          establishes:
            "nothing about whether the original request finished; a decision " +
            "to proceed without that evidence",
        },
      },
      tx,
    );
  });

  console.log(`Released by ${actor.email ?? userId}.`);
  console.log(`Recorded: ${note}`);
}

await main();
process.exit(0);

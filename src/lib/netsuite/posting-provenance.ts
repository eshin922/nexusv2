import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { quoteSnapshotLines } from "@/db/schema";

/**
 * Record which NetSuite item each frozen line was ACTUALLY posted to.
 *
 * ── WHY THIS IS NOT A BREACH OF THE FREEZE ───────────────────────────────
 *
 * Pattern 52 makes the frozen commercial columns immutable after send, and
 * they stay that way: nothing here touches an amount, a rate, a pricing state
 * or a total. `netsuite_item_id` is not a commercial term. It is POSTING
 * PROVENANCE — a record of what happened to a line after it was frozen, in the
 * same family as `pdf_url`, which is also written after the send it describes.
 *
 * Writing it is what makes the push auditable at all. Without it, "which item
 * did this line post to" is answerable only by reading NetSuite, and only for
 * as long as the mapping that produced it stays unchanged.
 *
 * ── INTENT AND ACTUAL STAY SEPARATE ──────────────────────────────────────
 *
 * `selected_netsuite_item_id` is what the operator CHOSE for an Other Service
 * line, frozen at send. This writes `netsuite_item_id`, what was POSTED. They
 * should agree, and for Other Service they had better — but they are recorded
 * separately so a disagreement is visible rather than absorbed by one field
 * overwriting the other.
 *
 * That is not hypothetical bookkeeping. If a future path ever resolved a
 * per-line destination at push instead of reading the frozen selection, the two
 * columns would diverge and say so; a single field would simply have changed.
 */

type Exec = Pick<typeof db, "update" | "select">;

export type PostedLine = {
  /** `quote_snapshot_lines.id`. */
  sourceLineId: string;
  /** The NetSuite internal id this line was actually posted to. */
  postedNetsuiteItemId: string;
};

export async function recordPostingProvenance(
  exec: Exec,
  posted: ReadonlyArray<PostedLine>,
): Promise<{ written: number }> {
  if (posted.length === 0) return { written: 0 };

  // One statement per line rather than a CASE fan-out: the set is small (a
  // handful of accounting lines), and a per-row update keeps a partial failure
  // legible instead of leaving one opaque statement half-applied.
  for (const line of posted) {
    await exec
      .update(quoteSnapshotLines)
      .set({ netsuiteItemId: line.postedNetsuiteItemId })
      .where(eq(quoteSnapshotLines.id, line.sourceLineId));
  }
  return { written: posted.length };
}

/**
 * Where a line's frozen INTENT and its posted ACTUAL disagree.
 *
 * Only meaningful for `OTC - Other Service`, the one destination whose item is
 * chosen per line and frozen. Everywhere else `selected_netsuite_item_id` is
 * null by design and there is no intent to compare against — so a null there is
 * not a disagreement, and reporting it as one would produce noise on every push.
 */
export async function findProvenanceDisagreements(
  exec: Exec,
  sourceLineIds: ReadonlyArray<string>,
): Promise<
  Array<{ lineId: string; displayName: string; selected: string; posted: string }>
> {
  if (sourceLineIds.length === 0) return [];
  const rows = await exec
    .select({
      id: quoteSnapshotLines.id,
      displayName: quoteSnapshotLines.displayName,
      selected: quoteSnapshotLines.selectedNetsuiteItemId,
      posted: quoteSnapshotLines.netsuiteItemId,
    })
    .from(quoteSnapshotLines)
    .where(inArray(quoteSnapshotLines.id, [...sourceLineIds]));

  return rows
    .filter(
      (r) =>
        (r.selected ?? "").trim() !== "" &&
        (r.posted ?? "").trim() !== "" &&
        r.selected !== r.posted,
    )
    .map((r) => ({
      lineId: r.id,
      displayName: r.displayName,
      selected: r.selected!,
      posted: r.posted!,
    }));
}

/**
 * Backfill commercial-policy pins for non-draft quotes that predate the pin
 * mechanism. ONE-TIME. Idempotent: skips any quote that already has an active
 * pin, so a re-run is a no-op rather than a duplicate.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 *
 * `resolveCommercialSettingsForLifecycle` resolves non-draft quotes through
 * their pin and falls through to `legacy_live` when none exists. A quote in
 * that state reprices whenever Firm Settings change. This closes the
 * population so `legacy_live` can be retired as a runtime path.
 *
 * ── WHAT IT FREEZES ───────────────────────────────────────────────────────
 *
 * Today's resolved policy, via `prepareQuoteCommercialPin` — the SAME function
 * the live send path uses. Not a reimplementation: a second copy of the
 * resolution rules is a second thing that can disagree with the first, and the
 * whole point of a pin is that it records what the resolver actually resolved.
 *
 * That carries `chosenRung` through unchanged, so a `Raw ingredients` category
 * that resolves via the `Other` rung is pinned at 0.30 WITH `chosen_rung =
 * "Other"` — recording that no native Raw Ingredients authority existed, rather
 * than fabricating one.
 *
 * It does NOT reconstruct historical send-time rates. Those were never
 * recorded and are not knowable; the pin freezes what the system resolves
 * today, and `backfill_reason` says so.
 *
 * ── SNAPSHOT LINK ─────────────────────────────────────────────────────────
 *
 * Linked to the quote's real current snapshot where one exists. NULL where
 * none was ever captured — the truthful value. No synthetic `quote_snapshots`
 * row is created here or anywhere: inventing a send record to satisfy a FK
 * would corrupt the record of what was actually sent.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteCommercialMarkupPins,
  quoteCommercialSettingsPins,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { prepareQuoteCommercialPin } from "@/lib/commercial-settings";

const REASON =
  "0078 legacy policy freeze — quote predates the commercial-pin mechanism; " +
  "frozen at the rates resolved on backfill, not at historical send-time rates, " +
  "which were never recorded.";

const APPLY = process.argv.includes("--apply");

const targets = (await db.execute(sql`
  select q.id::text id, q.status, q.scenario_label lbl, p.deal_name dn
    from quotes q
    join projects p on p.id = q.project_id
    left join quote_commercial_settings_pins pin
      on pin.quote_id = q.id and pin.superseded_at is null
   where q.status <> 'draft' and pin.id is null
   order by p.deal_name, q.scenario_label
`)) as unknown as { id: string; status: string; lbl: string; dn: string }[];

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${targets.length} unpinned non-draft quotes\n`);

let pinned = 0;
let withSnapshot = 0;
let withoutSnapshot = 0;
const failures: string[] = [];

for (const t of targets) {
  const label = `${t.dn} / ${t.lbl} [${t.status}]`;
  try {
    const plan = await prepareQuoteCommercialPin(t.id);

    const snapRows = await db
      .select({ id: quoteSnapshots.id })
      .from(quoteSnapshots)
      .where(and(eq(quoteSnapshots.quoteId, t.id), isNull(quoteSnapshots.supersededAt)))
      .limit(1);
    const snapshotId = snapRows[0]?.id ?? null;

    const quoteRows = await db
      .select({ freightMarkupPct: quotes.freightMarkupPct, projectId: quotes.projectId })
      .from(quotes)
      .where(eq(quotes.id, t.id))
      .limit(1);
    const quote = quoteRows[0];
    if (!quote) throw new Error("quote vanished between select and pin");

    console.log(
      `  ${snapshotId ? "snapshot" : "NULL    "} · ${plan.markupRows.length} markup rows · ${label}`,
    );
    if (!APPLY) {
      snapshotId ? withSnapshot++ : withoutSnapshot++;
      pinned++;
      continue;
    }

    await db.transaction(async (tx) => {
      const [pin] = await tx
        .insert(quoteCommercialSettingsPins)
        .values({
          quoteId: t.id,
          quoteSnapshotId: snapshotId,
          targetMarginPct: plan.targetMarginPct,
          floorMarginPct: plan.floorMarginPct,
          freightMarkupPct: quote.freightMarkupPct,
          supersededAt: null,
          backfillReason: REASON,
          createdByUserId: null,
        })
        .returning({ id: quoteCommercialSettingsPins.id });

      if (plan.markupRows.length > 0) {
        await tx.insert(quoteCommercialMarkupPins).values(
          plan.markupRows.map((row) => ({ pinId: pin.id, ...row })),
        );
      }

      // NO AUDIT ROW, deliberately.
      //
      // `writeAuditEntry` refuses an entry with no acting user — correctly:
      // "an audit entry that names nobody" is the failure it exists to
      // prevent. A migration has no acting user, and the two ways to satisfy
      // that guard are both worse than omitting the row: attributing the write
      // to a person who did not make it is false, and widening the closed
      // `SYSTEM_ACTORS` set for a one-time script is a governance change made
      // sideways, which that set's own documentation forbids.
      //
      // Provenance is instead recorded ON THE ROW, in `backfill_reason` — which
      // is what the disposition actually asked for and is stronger here than an
      // audit entry: a reader looking at a NULL `quote_snapshot_id` sees why,
      // in place, without a join.
    });

    snapshotId ? withSnapshot++ : withoutSnapshot++;
    pinned++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${label}: ${msg}`);
    console.log(`  FAILED   · ${label}\n             ${msg}`);
  }
}

console.log("");
console.log(`RESULT pinned=${pinned} (snapshot-linked=${withSnapshot}, null-snapshot=${withoutSnapshot}) failed=${failures.length}`);
if (failures.length > 0) {
  console.log("RESULT failures are NOT swallowed — each is listed above and the quote remains unpinned.");
}
process.exit(failures.length > 0 ? 1 : 0);

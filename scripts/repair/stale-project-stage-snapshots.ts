/**
 * Repair the nine drifted project stage snapshots.
 *
 * ── WHY THIS EXISTS AS A SCRIPT ──────────────────────────────────────────
 *
 * `refreshFromHubspot` in `actions/projects.ts` is the governed projection of
 * cached HubSpot data onto a project row — and it has ZERO callers. Not one
 * page, not one component. (The five "Refresh from HubSpot" hits in the tree
 * are the product-library pull, a different thing entirely.)
 *
 * That is the whole cause of the drift being repaired here: there was never a
 * control to press. Nine projects therefore still claim stages HubSpot moved
 * them off long ago — four are Closed lost, four are Won, one is Delivered, and
 * all nine present in Nexus as live quoting work.
 *
 * So this script performs the SAME projection the action performs, over the
 * same shared `syncDealById`, writing the same five columns and the same
 * `refreshed` audit action. It is not a second implementation of a rule; it is
 * the existing rule applied by hand because nothing invokes it.
 *
 * ── FAIL-SAFE POSTURE ────────────────────────────────────────────────────
 *
 * `syncDealById` separates three states and so does this:
 *
 *   row returned  -> repair from HubSpot truth
 *   null (404)    -> deal is GONE. SKIPPED, not guessed at. Deleted-deal
 *                    lifecycle is a governed decision that has not shipped;
 *                    inventing a stage here would pre-empt it.
 *   throws        -> INDETERMINATE. Skipped, reported, nothing written.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────
 *
 *   node ... stale-project-stage-snapshots.ts            # preview
 *   node ... stale-project-stage-snapshots.ts --apply    # writes
 *
 * PREVIEW IS NOT WRITE-FREE, and calling it that was a real mistake on the
 * first run. It makes no change to `projects` or `audit_log` — both are gated
 * on `--apply` — but adjudicating a candidate means calling `syncDealById`,
 * which UPSERTS `hubspot_deals_cache`. That is benign (the cache is a HubSpot
 * mirror, and the row written is HubSpot's own current truth) but it is a
 * write, and a dry run that claims otherwise teaches an operator to trust a
 * guarantee it does not provide.
 */
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { syncDealById } from "@/lib/hubspot-cache";
import { writeAuditEntry } from "@/lib/audit";

const APPLY = process.argv.includes("--apply");
const ACTOR_EMAIL = "edward@thedps.co";

const [actor] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, ACTOR_EMAIL))
  .limit(1);
if (!actor) throw new Error(`No user ${ACTOR_EMAIL}; cannot attribute the audit row.`);

// Stage labels, so the report never prints an internal id at a reader.
const pipelines = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", {
  headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
}).then((r) => r.json());
const label = new Map<string, string>();
for (const p of pipelines.results ?? [])
  for (const s of p.stages ?? []) label.set(s.id, s.label);
const lbl = (s: string | null) => (s ? (label.get(s) ?? `(unknown ${s})`) : "(none)");

// EVERY non-test project is a candidate; HubSpot decides which actually drifted.
//
// An earlier version selected "projects the active-pipeline search no longer
// returns". That predicate was both fragile and SELF-ERASING: `syncDealById`
// upserts the cache, so merely adjudicating a candidate removed it from the
// candidate set — a preview that changed what the next preview would find. (It
// also made that run's "no writes" label wrong: `projects` and `audit_log` were
// untouched, but nine cache rows were written.)
//
// Comparing every project against HubSpot itself has no such feedback loop, and
// it catches drift in projects that ARE in the active cache but stale — which
// the narrower predicate could not see at all. 21 bounded calls.
const drifted = (await db.execute(sql.raw(`
  SELECT p.id::text AS id, p.hubspot_deal_id, p.deal_name, p.deal_stage,
         p.client_name, p.hubspot_owner_id, p.sales_rep_user_id::text AS sales_rep_user_id
    FROM projects p
   WHERE NOT p.is_test
   ORDER BY p.deal_name
`))) as unknown as Array<{
  id: string; hubspot_deal_id: string; deal_name: string; deal_stage: string | null;
  client_name: string | null; hubspot_owner_id: string | null; sales_rep_user_id: string | null;
}>;

// The label states what is and is not written, because "PREVIEW (no writes)"
// was FALSE and a future operator would have trusted it. Preview leaves
// `projects` and `audit_log` alone, but `syncDealById` upserts the HubSpot
// cache on every candidate it adjudicates — that is the point of calling it,
// and it happens in both modes.
console.log(
  APPLY
    ? "MODE APPLY — writes projects + audit_log, and refreshes hubspot_deals_cache"
    : "MODE PREVIEW — no projects/audit_log writes; DOES refresh hubspot_deals_cache",
);
console.log(`CANDIDATES ${drifted.length}\n`);

let repaired = 0, skipped404 = 0, skippedError = 0, unchanged = 0, outOfScope = 0;

for (const p of drifted) {
  let cacheRow;
  try {
    cacheRow = await syncDealById(p.hubspot_deal_id);
  } catch (err) {
    skippedError++;
    console.log(`INDETERMINATE  ${p.deal_name}  — ${(err as Error).message.slice(0, 70)}  (nothing written)`);
    continue;
  }
  if (!cacheRow) {
    skipped404++;
    console.log(`DELETED-404    ${p.deal_name}  — skipped; deleted-deal lifecycle has not shipped`);
    continue;
  }

  // Resolve the sales rep exactly as the action does: by the cached owner email.
  let salesRepUserId: string | null = null;
  if (cacheRow.salesRepEmail) {
    const [m] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, cacheRow.salesRepEmail)).limit(1);
    salesRepUserId = m?.id ?? null;
  }

  const before = {
    deal_name: p.deal_name, client_name: p.client_name,
    deal_stage: p.deal_stage, hubspot_owner_id: p.hubspot_owner_id,
    sales_rep_user_id: p.sales_rep_user_id,
  };
  const after = {
    deal_name: cacheRow.dealName, client_name: cacheRow.associatedCompanyName,
    deal_stage: cacheRow.dealStage, hubspot_owner_id: cacheRow.salesRepId,
    sales_rep_user_id: salesRepUserId,
  };
  const changed = Object.keys(after).filter(
    (k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k],
  );

  if (changed.length === 0) {
    unchanged++;
    console.log(`UNCHANGED      ${p.deal_name}`);
    continue;
  }

  // SCOPE GATE. The authorised defect is the stale STAGE snapshot. Adjudicating
  // every project also revealed that `sales_rep_user_id` is NULL on all 21 and
  // resolvable from the HubSpot owner on all 21 — a real improvement, and NOT
  // what was authorised. Rows whose stage is correct are reported and left
  // alone rather than swept up by a repair that was scoped to something else.
  if (!changed.includes("deal_stage")) {
    outOfScope++;
    console.log(
      `OUT-OF-SCOPE   ${p.deal_name}  — stage is correct; would only change ` +
        `${changed.join(", ")}. Not written.`,
    );
    continue;
  }

  console.log(
    `REPAIR         ${p.deal_name}` +
    (changed.includes("deal_stage")
      ? `\n                 stage  ${lbl(before.deal_stage)}  ->  ${lbl(after.deal_stage)}`
      : "") +
    (changed.filter((c) => c !== "deal_stage" && c !== "sales_rep_user_id").length
      ? `\n                 also   ${changed.filter((c) => c !== "deal_stage" && c !== "sales_rep_user_id").join(", ")}`
      : "") +
    // Spelled out rather than summarised. EVERY candidate reported a
    // sales_rep_user_id change, and the word "changed" cannot distinguish a
    // correction from a null-out. A repair that quietly erases owner
    // attribution is worse than the drift it is fixing.
    (changed.includes("sales_rep_user_id")
      ? `\n                 srep   ${before.sales_rep_user_id ?? "NULL"} -> ${after.sales_rep_user_id ?? "NULL"}` +
        (before.sales_rep_user_id && !after.sales_rep_user_id ? "   *** WOULD ERASE ***" : "")
      : ""),
  );

  if (APPLY) {
    await db.update(projects)
      .set({
        dealName: after.deal_name,
        clientName: after.client_name,
        dealStage: after.deal_stage,
        hubspotOwnerId: after.hubspot_owner_id,
        salesRepUserId,
        lastHubspotRefreshAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, p.id));

    await writeAuditEntry({
      userId: actor.id,
      entityType: "project",
      entityId: p.id,
      action: "refreshed",
      // Same action as the governed path — this IS a refresh. `source`
      // disambiguates origin per the Slice 9.2 convention, so the timeline can
      // separate a repair sweep from an operator-initiated refresh without a
      // second action name.
      diffJson: { before, after, changed, source: "data_repair" },
    });
  }
  repaired++;
}

console.log("");
console.log(`repaired        ${repaired}${APPLY ? "" : " (would)"}`);
console.log(`unchanged       ${unchanged}`);
console.log(`skipped · 404   ${skipped404}`);
console.log(`skipped · error ${skippedError}`);
console.log(`out of scope    ${outOfScope}  (stage correct; sales_rep_user_id populatable — separate decision)`);
process.exit(0);

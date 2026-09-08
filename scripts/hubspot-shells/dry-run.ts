/**
 * HubSpot project-shell materialisation — DRY RUN. WRITES NOTHING.
 *
 * Reports the proposed 21 -> ~77 transition before any of it happens. Every
 * statement below is a SELECT; there is no insert, update or delete in this
 * file, and a test asserts that.
 *
 * Stage labels come from HubSpot's own pipelines table, so the report never
 * shows an internal id to a reader.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

const ACTIVE = ["195274338", "195274339", "195274340", "195274342"];

// ── stage labels, from HubSpot itself ──────────────────────────────────────
const token = process.env.HUBSPOT_ACCESS_TOKEN!;
const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", {
  headers: { Authorization: `Bearer ${token}` },
});
const pipelines = await res.json();
const stageLabel = new Map<string, string>();
for (const p of pipelines.results ?? [])
  for (const s of p.stages ?? []) stageLabel.set(s.id, s.label);

type Row = {
  deal_id: string;
  deal_name: string;
  client: string | null;
  deal_stage: string | null;
  hubspot_category: string | null;
  existing_project_id: string | null;
  existing_is_test: boolean | null;
  has_quote: boolean | null;
  has_work_audit: boolean | null;
  has_pin: boolean | null;
};

const rows = (await db.execute(sql.raw(`
  SELECT c.deal_id, c.deal_name, c.associated_company_name AS client,
         c.deal_stage, c.project_category AS hubspot_category,
         p.id::text AS existing_project_id, p.is_test AS existing_is_test,
         EXISTS (SELECT 1 FROM quotes q WHERE q.project_id = p.id) AS has_quote,
         EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type='project' AND a.entity_id = p.id::text
                   AND a.action NOT IN ('created','refreshed','archived','unarchived_db_fix')) AS has_work_audit,
         EXISTS (SELECT 1 FROM user_pinned_projects pin WHERE pin.project_id = p.id) AS has_pin
    FROM hubspot_deals_cache c
    LEFT JOIN projects p ON p.hubspot_deal_id = c.deal_id
   ORDER BY c.deal_name
`))) as unknown as Row[];

const isActive = (s: string | null) => !!s && ACTIVE.includes(s);
const governed = (r: Row) => Boolean(r.has_quote || r.has_work_audit || r.has_pin);

let wouldCreate = 0, alreadyExists = 0, wouldArchive = 0, inDefault = 0, quoteless = 0;
const lines: string[] = [];

for (const r of rows) {
  const active = isActive(r.deal_stage);
  const exists = r.existing_project_id !== null;
  const label = r.deal_stage ? (stageLabel.get(r.deal_stage) ?? `(unknown ${r.deal_stage})`) : "(none)";

  // Category: NEVER mapped. Shells materialise unclassified; existing projects
  // keep whatever an operator already chose.
  const proposedCategory = exists ? "(unchanged)" : "unclassified";

  const archivesNow = !active && !governed(r);
  const showsInDefault = active && !archivesNow && Boolean(r.has_quote);

  if (!exists) wouldCreate++; else alreadyExists++;
  if (archivesNow) wouldArchive++;
  if (showsInDefault) inDefault++;
  if (!archivesNow && !r.has_quote) quoteless++;

  if (!exists) {
    lines.push(
      [
        r.deal_id.padEnd(12),
        (r.deal_name ?? "").slice(0, 46).padEnd(46),
        (r.client ?? "—").slice(0, 22).padEnd(22),
        label.slice(0, 22).padEnd(22),
        (active ? "active" : "INACTIVE").padEnd(9),
        proposedCategory.padEnd(13),
        (r.hubspot_category ?? "—").slice(0, 16).padEnd(16),
        archivesNow ? "ARCHIVE-ON-CREATE" : "keep",
      ].join(" "),
    );
  }
}

console.log("DRYRUN_BEGIN");
console.log(`cache rows examined            ${rows.length}`);
console.log(`already have a Nexus project   ${alreadyExists}`);
console.log(`WOULD CREATE (new shells)      ${wouldCreate}`);
console.log("");
console.log("DEAL_ID".padEnd(12) + " " + "DEAL NAME".padEnd(46) + " " + "CUSTOMER".padEnd(22) + " " + "STAGE".padEnd(22) + " " + "CLASS".padEnd(9) + " " + "NEXUS CAT".padEnd(13) + " " + "HS CATEGORY".padEnd(16) + " OUTCOME");
for (const l of lines) console.log(l);
console.log("");

// ── SIDE B · projects the cache does NOT contain ───────────────────────────
//
// The archive and deletion arms are decided by PROJECT-SIDE absence, which a
// loop over cache rows structurally cannot observe. A first version of this
// report omitted them and printed "archived immediately: 0" — a number it
// could only ever produce. This side is where that answer actually lives.
//
// Adjudicated by a DIRECT read-only HubSpot GET. `syncDealById` would be the
// production adjudicator, but it upserts the cache, and a dry run writes
// nothing — including to the cache.
const orphans = (await db.execute(sql.raw(`
  SELECT p.id::text AS id, p.deal_name, p.hubspot_deal_id, p.deal_stage, p.status,
         EXISTS (SELECT 1 FROM quotes q WHERE q.project_id = p.id) AS has_quote,
         EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type='project' AND a.entity_id = p.id::text
                   AND a.action NOT IN ('created','refreshed','archived','unarchived_db_fix')) AS has_work_audit,
         EXISTS (SELECT 1 FROM user_pinned_projects pin WHERE pin.project_id = p.id) AS has_pin
    FROM projects p
   WHERE NOT p.is_test
     AND NOT EXISTS (SELECT 1 FROM hubspot_deals_cache c WHERE c.deal_id = p.hubspot_deal_id)
   ORDER BY p.deal_name
`))) as unknown as Array<Row & { id: string; hubspot_deal_id: string; status: string }>;

console.log("");
console.log(`PROJECTS ABSENT FROM CACHE — adjudicated against HubSpot: ${orphans.length}`);
console.log("DEAL NAME".padEnd(52) + " " + "SNAPSHOT STAGE".padEnd(22) + " " + "HUBSPOT SAYS".padEnd(26) + " " + "WORK".padEnd(6) + " OUTCOME");

let orphanArchive = 0, orphanPreserve = 0, orphanIndeterminate = 0, orphanReactivate = 0;
for (const o of orphans) {
  let verdict: string, outcome: string;
  try {
    const r = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${o.hubspot_deal_id}?properties=dealstage`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (r.status === 404) {
      verdict = "404 · DEAL DELETED";
      outcome = governed(o) ? "PRESERVE + flag CRM lost" : "ARCHIVE";
      governed(o) ? orphanPreserve++ : orphanArchive++;
    } else if (r.ok) {
      const j = await r.json();
      const st = j.properties?.dealstage ?? null;
      const lbl = st ? (stageLabel.get(st) ?? `(unknown ${st})`) : "(none)";
      if (ACTIVE.includes(st)) {
        verdict = `active · ${lbl}`;
        outcome = "RE-ACTIVATE (cache was stale)";
        orphanReactivate++;
      } else {
        verdict = `inactive · ${lbl}`;
        outcome = governed(o) ? "PRESERVE (left pipeline)" : "ARCHIVE";
        governed(o) ? orphanPreserve++ : orphanArchive++;
      }
    } else {
      verdict = `HTTP ${r.status}`;
      outcome = "INDETERMINATE — no change";
      orphanIndeterminate++;
    }
  } catch (e) {
    verdict = "read failed";
    outcome = "INDETERMINATE — no change";
    orphanIndeterminate++;
  }
  const snap = o.deal_stage ? (stageLabel.get(o.deal_stage) ?? o.deal_stage) : "(none)";
  console.log(
    (o.deal_name ?? "").slice(0, 52).padEnd(52) + " " +
    snap.slice(0, 22).padEnd(22) + " " +
    verdict.slice(0, 26).padEnd(26) + " " +
    (governed(o) ? "yes" : "no").padEnd(6) + " " + outcome,
  );
}

const totalProjectsAfter = (await db.execute(sql.raw(
  "SELECT count(*)::int n FROM projects WHERE NOT is_test"))) as unknown as Array<{ n: number }>;

console.log("");
console.log("RESULTING COUNTS");
console.log(`  new shells created                            ${wouldCreate}`);
console.log(`  active work (has a quote, shows by default)   ${inDefault}`);
console.log(`  quote-less shells (behind a filter)           ${quoteless}`);
console.log(`  archived — cache side                         ${wouldArchive}`);
console.log(`  archived — absent-from-cache side             ${orphanArchive}`);
console.log(`  preserved with governed history               ${orphanPreserve}`);
console.log(`  re-activated (stale cache)                    ${orphanReactivate}`);
console.log(`  INDETERMINATE — untouched                     ${orphanIndeterminate}`);
console.log(`  real projects before                          ${totalProjectsAfter[0].n}`);
console.log(`  real projects after                           ${totalProjectsAfter[0].n + wouldCreate}`);
console.log("DRYRUN_END");
process.exit(0);

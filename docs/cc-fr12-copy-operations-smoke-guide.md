# slice-fr12-copy-operations · CB smoke guide

**Branch:** `slice-fr12-copy-operations`
**Status:** Ready for Edward + CB CB walk. Merge gate.
**Date:** 2026-06-15
**Companion docs:**
- Kickoff: `docs/cc-fr12-copy-operations-kickoff.md` (Step 1 +
  locked dispositions + 8-step plan)
- Brief: `docs/cc-comm-fr12-copy-operations-brief.md` (LOCKED)
- Review: `docs/cc-comm-fr12-copy-operations-review.md` (CC, 7
  §0.5 catches + Q5-Q11)

---

## Pre-walk environment check

```sql
-- 1. Schema unchanged (no migrations this slice)
select column_name, is_nullable from information_schema.columns
 where table_name = 'quotes'
   and column_name = 'copied_from_quote_id';
-- Expect: copied_from_quote_id text/uuid NULLABLE

-- 2. scenario_drop_reason enum confirms 'superseded_by_copy'
select unnest(enum_range(null::scenario_drop_reason))::text as drop_reason;
-- Expect 5 rows including 'superseded_by_copy'

-- 3. Pick a source-quote candidate: ASY/LEAF-tree-having draft
select q.id, p.client_name, q.scenario_label, q.scenario_status,
       count(a.id) filter (where a.id is not null) as asy_count
  from quotes q
       inner join projects p on p.id = q.project_id
       left join assemblies a on a.quote_id = q.id
 where q.status = 'draft'
   and exists (select 1 from assemblies where quote_id = q.id)
 group by q.id, p.client_name, q.scenario_label, q.scenario_status
 having count(a.id) filter (where a.id is not null) >= 1
 order by q.updated_at desc
 limit 5;

-- 4. Pick a second project to use as cross-project target
select p.id, p.client_name, p.deal_name,
       count(distinct q.id) as quote_count
  from projects p
       left join quotes q on q.project_id = p.id
 group by p.id, p.client_name, p.deal_name
 order by p.updated_at desc
 limit 5;
```

Environment:
- Local dev: `npm run dev` (heap-bumped per PR #50 era)
- Single fresh browser tab per smoke run
- Edward signed in with `can_create_leaves` left as-is (Catch #6:
  no permission gate on copy paths; ensureUser only)

---

## FR12-1 · Within-project copy · happy path

**Path:**
1. Open project detail for a project with at least 2 scenarios,
   one of which has at least one ASY (source candidate from
   pre-walk query 3)
2. Click `+ New scenario` to open CSF modal
3. Select **"Copy a scenario from this project"** radio
4. Confirm:
   - Picker chrome appears below the radio (paper-2 background,
     `Source scenario` eyebrow)
   - Dropdown lists project's scenarios (excluding the anchor
     scenario) in "★ {label} · v{N} · {status?} · X ASYs · Y leafs"
     format
5. Pick a source scenario
6. (Optional) Fill scenario name + intent + customer target tier
   + attach a brief
7. Leave drop choice = "Keep both"
8. Click **`Copy scenario`**
9. Confirm:
   - Modal closes
   - Browser navigates to `/projects/{projectId}/quotes/{newQuoteId}/setup`
   - Setup tree shows the cloned assemblies + leaves (count
     matches source's ASY/LEAF count)
   - Tier rail shows tiers with qty=0 (RESET per FR-12 bucket)
   - Project detail page (back-nav) shows the new scenario card
     with the auto-assigned label (e.g., "Alt 3")

**DB verification:**
```sql
-- New quote row with copied_from_quote_id set + Reset bucket
-- cleared + Inherited from same project
select id, project_id, scenario_label, scenario_status,
       version_number, status, accepted_at, sent_at, pdf_url,
       copied_from_quote_id
  from quotes
 where created_at > now() - interval '5 minutes'
 order by created_at desc
 limit 1;
-- Expect: status='draft' version_number=1 scenario_status='active'
--   accepted_at NULL sent_at NULL pdf_url NULL
--   copied_from_quote_id = the source quote.id

-- Cloneable graph: assemblies cloned (new IDs, same commercial
-- fields)
select count(*) as new_asy_count from assemblies
 where quote_id = '<new-quote-id>';
-- Expect: matches source quote's ASY count

-- Cloneable graph: assembly_leaves point at SAME library leaves
select count(*) as junction_count
  from assembly_leaves al
       inner join assemblies a on a.id = al.assembly_id
 where a.quote_id = '<new-quote-id>';
-- Expect: matches source's junction count

-- Library leaves NOT cloned (same leaf_id referenced)
select count(distinct al_new.leaf_id) as new_leaf_refs,
       count(distinct al_src.leaf_id) as src_leaf_refs
  from assembly_leaves al_new
       inner join assemblies a_new on a_new.id = al_new.assembly_id
  join assembly_leaves al_src
       inner join assemblies a_src on a_src.id = al_src.assembly_id
       on a_src.quote_id = '<source-quote-id>'
 where a_new.quote_id = '<new-quote-id>';
-- Expect: new_leaf_refs = src_leaf_refs (same library leaves
-- referenced by both quotes)

-- Tier qty RESET
select label, qty, sort_order from quote_tiers
 where quote_id = '<new-quote-id>'
 order by sort_order;
-- Expect all qty = NULL (or 0 depending on column default; verify
-- by schema lookup)

-- Freight legs cloned with policy columns + customs JSONB; shipment
-- dates NULL
select fl.direction, fl.mode, fl.treatment, fl.customs,
       fl.cargo_ready_date, fl.vessel_etd, fl.vessel_eta,
       fl.actual_delivery_date
  from freight_legs fl
       inner join freight_leg_groups flg on flg.id = fl.leg_group_id
 where flg.quote_id = '<new-quote-id>';
-- Expect: policy columns + customs match source; all *_date NULL
```

---

## FR12-2 · Cross-project copy · happy path

**Path:**
1. Open project detail for a DIFFERENT project from FR12-1's
   source (target project)
2. Click `+ New scenario`
3. Select **"Copy a quote from another project"** radio
4. Confirm cross-project picker mounts (paper-2 box;
   `Source project + scenario` eyebrow; search input)
5. Type search term matching FR12-1's source project's
   `client_name` or `deal_name` (e.g., 3 chars of the client
   name)
6. Wait for debounce (~300ms); confirm project dropdown
   populates with the source project visible
7. Pick the source project
8. Confirm scenario dropdown appears with same option label
   format as within-project picker
9. Pick a source scenario from the source project
10. (Optional) Fill scenario name + intent + brief
11. Drop choice radios should be **disabled** (cross-project
    copy has no anchor to drop)
12. Click **`Copy quote`**
13. Confirm:
    - Modal closes
    - Browser navigates to `/projects/{targetProjectId}/quotes/{newQuoteId}/setup`
    - Setup tree shows cloned assemblies + leaves

**DB verification:**
```sql
-- Inherited bucket: target project's values (NOT source's)
select q.project_id, q.scenario_label, q.copied_from_quote_id,
       p.client_name as target_client_name,
       p.hubspot_deal_id as target_deal_id
  from quotes q
       inner join projects p on p.id = q.project_id
 where q.id = '<new-quote-id>';
-- Expect: project_id = TARGET project id (NOT source's)
--   client_name = target's client (NOT source's)
--   copied_from_quote_id = source quote id

-- Audit row carries cross_project discriminator + source_project_id
select diff_json, created_at
  from audit_log
 where action = 'scenario_copied'
   and created_at > now() - interval '5 minutes'
 order by created_at desc
 limit 1;
-- Expect diff_json contains:
--   source_type = 'cross_project'
--   source_quote_id = source quote id
--   source_project_id = source project id (REQUIRED here)
--   target_project_id = target project id
--   scenario_label
```

---

## FR12-3 · Drop current on within-project copy

**Path:**
1. Same as FR12-1 but on a project with at least 2 active
   scenarios (the anchor scenario + at least one sibling source)
2. Open modal, select "Copy a scenario from this project" radio
3. Pick source scenario from picker
4. Switch drop choice radio to **"Drop the current scenario"**
5. Click `Copy scenario`

**Post-condition:**
- New scenario created (per FR12-1 bucket integrity)
- Anchor scenario's family (all rows sharing project_id +
  scenario_label) flipped to `scenario_status='dropped'` with
  `drop_reason='superseded_by_copy'`

**DB verification:**
```sql
-- Anchor scenario family flipped to dropped
select id, scenario_label, scenario_status, drop_reason,
       dropped_by_user_id, dropped_at
  from quotes
 where project_id = '<project-id>'
   and scenario_label = '<anchor-scenario-label>';
-- Expect: scenario_status='dropped' drop_reason='superseded_by_copy'
--   dropped_at recent

-- scenario_dropped audit row with new audit_source value
select diff_json
  from audit_log
 where action = 'scenario_dropped'
   and created_at > now() - interval '5 minutes'
 order by created_at desc
 limit 1;
-- Expect diff_json.audit_source = 'fr12_copy_supersede'
--   diff_json.drop_reason = 'superseded_by_copy'
--   diff_json.triggered_by_new_scenario_id = new quote id
--   diff_json.dropped_quote_ids = array of family quote ids

-- scenario_copied audit row carries dropped_source_quote_id
select diff_json
  from audit_log
 where action = 'scenario_copied'
   and created_at > now() - interval '5 minutes'
 order by created_at desc
 limit 1;
-- Expect diff_json.dropped_source_quote_id NOT NULL
--   diff_json.dropped_scenario_label = anchor scenario label
```

---

## FR12-4 · Field bucket integrity (within-project)

After FR12-1 or FR12-3 succeeds, sweep bucket compliance:

```sql
-- Cloneable bucket carried (sample subset)
select q_src.global_price_adj_pct = q_new.global_price_adj_pct as gpa_match,
       q_src.target_margin_pct is not distinct from q_new.target_margin_pct as tmp_match
  from quotes q_new
  inner join quotes q_src on q_src.id = q_new.copied_from_quote_id
 where q_new.id = '<new-quote-id>';
-- Expect: both true

-- Reset bucket: explicit columns
select id, version_number, status, accepted_at, sent_at, pdf_url,
       hubspot_quote_id, customer_facing_notes, internal_notes,
       valid_until, retail_benchmark, scenario_status,
       copied_from_quote_id
  from quotes
 where id = '<new-quote-id>';
-- Expect: version_number=1, status='draft', scenario_status='active'
--   accepted_at NULL, sent_at NULL, pdf_url NULL,
--   hubspot_quote_id NULL, customer_facing_notes NULL,
--   internal_notes NULL, valid_until NULL, retail_benchmark NULL,
--   copied_from_quote_id NOT NULL

-- Inherited bucket: from target project
select q.project_id = (
  select project_id from quotes where id = '<new-quote-id>'
) as inherited_match
  from quotes q
 where q.id = '<target-project-anchor-quote-id>';
-- Expect: true (within-project copy inherits same project_id)
```

---

## FR12-5 · ASY/LEAF graph integrity

```sql
-- Source quote: N assemblies × M leaves per assembly
select count(distinct a.id) as asy_count, count(al.id) as leaf_count
  from assemblies a
       left join assembly_leaves al on al.assembly_id = a.id
 where a.quote_id = '<source-quote-id>';

-- New quote: same counts
select count(distinct a.id) as asy_count, count(al.id) as leaf_count
  from assemblies a
       left join assembly_leaves al on al.assembly_id = a.id
 where a.quote_id = '<new-quote-id>';

-- assembly_leaves point at SAME leaf_id references (library not
-- cloned)
select count(*) as junction_matches
  from assembly_leaves al_new
       inner join assemblies a_new on a_new.id = al_new.assembly_id
       inner join assembly_leaves al_src on al_src.leaf_id = al_new.leaf_id
       inner join assemblies a_src on a_src.id = al_src.assembly_id
 where a_new.quote_id = '<new-quote-id>'
   and a_src.quote_id = '<source-quote-id>';
-- Expect: matches source's junction count (each new junction
-- corresponds to a source junction with same leaf_id)

-- Single-level v1 invariant: parent_assembly_leaf_id NULL
select count(*) as nested_count
  from assembly_leaves al
       inner join assemblies a on a.id = al.assembly_id
 where a.quote_id = '<new-quote-id>'
   and al.parent_assembly_leaf_id is not null;
-- Expect: 0
```

---

## FR12-6 · Freight legs clone

```sql
-- Source freight structure
select flg.id, flg.label, count(fl.id) as leg_count
  from freight_leg_groups flg
       left join freight_legs fl on fl.leg_group_id = flg.id
 where flg.quote_id = '<source-quote-id>'
 group by flg.id, flg.label;

-- New quote: same structure (new IDs, same labels + leg counts)
select flg.id, flg.label, count(fl.id) as leg_count
  from freight_leg_groups flg
       left join freight_legs fl on fl.leg_group_id = flg.id
 where flg.quote_id = '<new-quote-id>'
 group by flg.id, flg.label;

-- Policy columns cloned + customs JSONB intact
select direction, mode, carrier, incoterm, treatment,
       freight_markup_pct, duty_markup_pct, tariff_markup_pct,
       customs
  from freight_legs fl
       inner join freight_leg_groups flg on flg.id = fl.leg_group_id
 where flg.quote_id = '<new-quote-id>';
-- Compare against source's columns — expect identical

-- SHIPMENT dates RESET to NULL
select cargo_ready_date, vessel_etd, vessel_eta,
       actual_delivery_date
  from freight_legs fl
       inner join freight_leg_groups flg on flg.id = fl.leg_group_id
 where flg.quote_id = '<new-quote-id>';
-- Expect: all four NULL on every leg
```

---

## FR12-7 · Audit log entries

```sql
-- All copy-related audit rows in last 30 min
select action, entity_type, entity_id, diff_json->>'source_type' as src_type,
       diff_json->>'audit_source' as audit_src, created_at
  from audit_log
 where action in ('scenario_copied', 'scenario_dropped')
   and created_at > now() - interval '30 minutes'
 order by created_at desc;
```

Expected:
- For FR12-1: one `scenario_copied` with `source_type='within_project'`
- For FR12-2: one `scenario_copied` with `source_type='cross_project'`
- For FR12-3: one `scenario_copied` + one `scenario_dropped` with
  `audit_source='fr12_copy_supersede'`

---

## FR12-8 · Cross-project picker ASY/LEAF filter (Pattern 32 / Q7)

If any legacy quote_skus-only quotes exist (pre-CSF dev quotes
without ASY/LEAF tree rows):

**Setup verification:**
```sql
-- Find a legacy quote (has quote_skus but NO assemblies)
select q.id, p.client_name, q.scenario_label,
       (select count(*) from assemblies where quote_id = q.id) as asy_count,
       (select count(*) from quote_skus where quote_id = q.id) as legacy_count
  from quotes q
       inner join projects p on p.id = q.project_id
 where exists (select 1 from quote_skus where quote_id = q.id)
   and not exists (select 1 from assemblies where quote_id = q.id);
```

If any legacy quote exists:

**Path:**
1. Open CSF modal in any target project
2. Select "Copy a quote from another project"
3. Search for the legacy quote's client_name or deal_name

**Expected:**
- Legacy quote does NOT appear in the picker
- Other quotes from the same project (if they have ASY/LEAF
  trees) DO appear

If no legacy quotes exist, this scenario auto-passes
(loader's EXISTS subquery filter is in code regardless).

---

## FR12-9 · Open to all signed-in users (Catch #6)

Confirm copy paths have no permission gate:

```sql
-- Verify Edward's flag is unchanged
select email, can_create_leaves from users
 where email = 'edward.shin@gmail.com';
```

**Expected from prior PR #52 LMP-4 revert:** `can_create_leaves=true`.

But per Catch #6, copy paths don't gate on this flag — they use
only `ensureUser()`. To prove:

1. Optionally flip `can_create_leaves=false`:
   ```sql
   update users set can_create_leaves = false
    where email = 'edward.shin@gmail.com';
   ```
2. Sign out + sign back in
3. Open CSF modal
4. Both copy paths should remain functional
5. Revert:
   ```sql
   update users set can_create_leaves = true
    where email = 'edward.shin@gmail.com';
   ```

This isolates the copy permission posture from the library leaf
creation flag (which DID gate in PR #52 LMP-4).

---

## CB merge-gate checklist

After all 9 FR12 scenarios pass:

- [ ] FR12-1 within-project happy path — PASS
- [ ] FR12-2 cross-project happy path — PASS
- [ ] FR12-3 drop-current on within-project — PASS
- [ ] FR12-4 field bucket integrity — PASS
- [ ] FR12-5 ASY/LEAF graph integrity — PASS
- [ ] FR12-6 freight legs clone (policy + customs JSONB; dates
      reset) — PASS
- [ ] FR12-7 audit log entries (3 actions seen across paths) —
      PASS
- [ ] FR12-8 cross-project picker ASY/LEAF filter — PASS
- [ ] FR12-9 permission posture (no gate) — PASS

---

## Cumulative Pattern 27 manifest (full slice)

7 implementation commits (Steps 2-7) + this guide (Step 8). Folds
per-commit manifests into end-of-slice audit shape.

### STRUCTURAL MATCHED (full slice)

- CLAUDE.md audit namespace: `scenario_copied` action with
  `diff_json.source_type` discriminator; `scenario_dropped`
  audit_source enum extension with `'fr12_copy_supersede'` value
- `cloneQuoteGraph` shared helper covers all 6 Cloneable tables:
  assemblies, assembly_leaves (point at SAME library leaves),
  quote_tiers (qty RESET), freight_leg_groups, freight_legs
  (POLICY + customs JSONB; shipment dates RESET), quotes
  (Cloneable columns + Inherited from target + Reset cleared +
  copied_from_quote_id = source.id)
- `copyScenarioWithinProject` action with optional family-level
  scenario_dropped per CSF Bug CSF-3-A precedent
- `copyQuoteFromProject` action (cross-project; no drop option)
- Loaders: `loadScenarioCopyPicker` + `loadCopySourceProjects`
  (renamed per Q9); Pattern 32 ASY/LEAF EXISTS filter on both
- Action wrappers: `fetchScenarioCopyPicker` +
  `fetchCopySourceProjects` (ensureUser-gated; mirror PR #51
  fetchLibraryBrowse pattern)
- CSF modal: within-project picker (Step 6) + cross-project
  3-step picker (Step 7); copy radios flipped from
  visible-disabled to active
- Form-input gate split: `advancedFieldsDisabled` (Recommended;
  copy actions don't carry the flag) + `dropChoiceDisabled`
  (cross-project — no anchor scenario to drop)
- Submit dispatch on `startPath`; submit-button copy switches
  across all three paths
- No schema migration (column + enum already existed per
  Catches 1+3)

### POLISH MATCHED (full slice)

- All copy verbatim per locked dispositions:
  - "Source scenario" / "Source project + scenario" eyebrows
    (mono uppercase)
  - "Search by client name or deal name" placeholder
  - "★ {label} · v{N} · {status?} · {asy} ASYs · {leaf} leafs"
    option label format (within-project + cross-project)
  - Empty-state copy distinguishes:
    - "No other scenarios in this project have a setup tree to
      copy from. Use Scratch instead." (within-project)
    - `No projects match "{term}." Try a different search.`
      (cross-project filtered)
    - "No projects with setup-tree scenarios available."
      (cross-project genuine empty)
  - Submit-button copy: "Create scenario" / "Copy scenario" /
    "Copy quote" + "Creating…" / "Copying…"
- diff_json keys per Step 2 CLAUDE.md contract:
  - `source_quote_id`, `source_type`, `target_project_id`,
    `source_project_id` (cross_project only), `scenario_label`,
    `intent_note`, `customer_target_tier_label`,
    `dropped_source_quote_id`, `dropped_scenario_label`
- ActionGuardError shapes match existing quotes.ts conventions
- Inline comments cite locked Qs by number for forensic
  continuity (Catches 1-7 + Q1-Q11)
- "Alt N" auto-label collision avoidance scoped per project
  (within-project: source's project; cross-project: target's)
- Auto-label algorithm matches `createScenario` (consistent
  scratch + copy behavior per Q11)

### DEFERRED (full slice → carry-forwards, NOT in this slice)

- Lineage indicator chip on scenario cards — v1.1+ visual polish
- Field bucket preview disclosure in modal — v1.1+
- "Show archived" project toggle on cross-project picker —
  v1.1+
- Tier remap UI (source 4 → target 3 preserve-hidden) — v1.1+
- Save-as-template / templates library — v2 per SPEC non-goal
- Bulk copy — v1.5+
- Copy-from-accepted preview (read-only source view before
  commit) — v1.1+ usability
- `quotes_copied_from_idx` partial index — v1.1+ if lineage
  query patterns surface
- Per-cell `quote_sku_tiers` clone — v1.1+ once ASY/LEAF
  per-cell override architecture lands (currently FK to legacy
  `quoteSkus.id`; orphan per Pattern 32)
- Cross-project picker SKU-label search — v1.1+
- `can_create_scenarios` permission gate — v1.1+ if per-role
  isolation requested

### NOT-IN-ANY-STEP

(none)

---

## §0.5 Pattern 22 catch ledger (cumulative across slice)

| # | Catch | Step shipped | Disposition |
|---|---|---|---|
| 1 | `copied_from_quote_id` column + FK already exist | (no migration) | Drop Migration 1 |
| 2 | `scenario_status` enum is 3 values, not 4 | Step 5 type signature | Drop `'archived'` from picker type |
| 3 | `superseded_by_copy` enum value confirmed | (no migration) | No action |
| 4 | Cost-input cloneable graph anchored to legacy `quote_skus` | Step 3 helper | Re-anchor per ASY/LEAF model |
| 5 | `freight_inputs` table dropped in R6.2 | Step 3 helper | Use `freight_leg_groups` + `freight_legs` |
| 6 | Permission gate posture | All action steps | No gate v1 (ensureUser only) |
| 7 | CSF modal copy radios already in place | Step 6/7 | Confirmation; flip gates only |

Cumulative §0.5 count across slices: 26 → **33** (7 new catches
this slice; 2 BLOCKERs caught pre-build saved a mid-slice
rewrite of the Cloneable bucket).

---

## Implementation commit log (this slice)

```
19fe9aa  Step 7 — CSF modal cross-project copy wiring
c35e74f  Step 6 — CSF modal within-project copy wiring
69cce98  Step 5 — picker loaders + action wrappers
34b84a4  Step 4 — copyQuoteFromProject action
3a2ab6a  Step 3 — copyScenarioWithinProject + cloneQuoteGraph helper
7007067  Step 2 — CLAUDE.md audit namespace updates
6d014ef  Step 1 — kickoff + brief + review
```

Plus this guide (Step 8).

---

## Standing by

Edward + CB walk FR12-1 through FR12-9. CSF-style "pass, merged"
on PR confirmation completes the slice.

— CC, 2026-06-15

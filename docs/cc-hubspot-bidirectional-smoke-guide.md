# slice-hubspot-bidirectional · CB smoke guide

**Branch:** `slice-hubspot-bidirectional`
**Status:** Ready for Edward's CB walk. Merge gate.
**Date:** 2026-05-21
**Companion:** `docs/cc-hubspot-bidirectional-kickoff.md` (Step 1 +
§1B PROD scope smoke results); `docs/cc-comm-hubspot-bidirectional-review.md`
(brief review + dispositions).

---

## Pre-walk environment check

Run these queries before walking the modal flows to confirm DB +
HubSpot state.

```sql
-- 1. Migration 0032 landed
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'leaves'
   and column_name in ('hubspot_product_id', 'archived')
 order by column_name;
-- Expect:
-- archived             boolean   nullable=NO
-- hubspot_product_id   text      nullable=YES

-- 2. Indexes present
select indexname from pg_indexes
 where tablename = 'leaves'
   and indexname in (
     'leaves_hubspot_product_id_idx',
     'leaves_archived_idx',
     'leaves_product_type_idx',
     'leaves_sku_idx'
   )
 order by indexname;
-- Expect 4 rows.

-- 3. Pre-walk leaf inventory snapshot
select count(*) filter (where hubspot_product_id is not null) as hs_sourced,
       count(*) filter (where hubspot_product_id is null) as nexus_local,
       count(*) filter (where archived = true) as archived_count
  from leaves;
-- Expect pre-walk:
--   hs_sourced = 0 (no Step 4 creates + no pulls yet)
--   nexus_local = 8 (impl-1 fixtures)
--   archived_count = 0
```

Environment:
- Local dev server: `npm run dev` (port 3000)
- HubSpot DEV sandbox token in `.env.local` (HUBSPOT_DEV_ACCESS_TOKEN)
- Test product seeding: optional — DEV sandbox has its own
  catalog; CB can pull straight from it

---

## HBS-1 · Push path · createLeaf via AddProductModal LEAF mode

**Path:** Open any draft quote → Setup tree → click `+ Add product`
→ flip to LEAF mode → fill required fields → Submit "Defer specs"
(stays on Setup; faster smoke than "Continue to specs").

**Form input:**
- Name: "HBS-1 smoke leaf"
- Product Type: any leaf-scope type from dropdown
- SKU: "HBS-1-SMOKE-{any}"
- Unit cost: "1.50"
- URL: (optional, blank ok)

**Expected:**
- Modal closes; toast "Added 'HBS-1 smoke leaf' to the library ·
  specs deferred."
- HubSpot DEV console (https://app.hubspot.com/products/{DEV_HUB_ID}/library)
  shows new product matching the SKU
- `leaves` row exists with `hubspot_product_id` populated to the
  HubSpot product's id

**DB verification:**
```sql
select id, name, sku, hubspot_product_id, archived, created_at
  from leaves
 where created_at > now() - interval '5 minutes'
   and sku like 'HBS-1-SMOKE-%'
 order by created_at desc;
-- Expect 1 row; hubspot_product_id is non-null numeric string.
```

**Audit verification:**
```sql
select action, diff_json, created_at
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'leaf_create'
   and (diff_json->>'sku') like 'HBS-1-SMOKE-%';
-- Expect 1 row. diff_json must contain:
--   - hubspot_product_id (non-null)
--   - source: 'nexus_authored'
--   - name, sku, product_type_id, unit_cost
```

---

## HBS-2 · Push failure UX

**Path:** Temporarily break HubSpot connectivity to verify the
error surface.

**Reproduction options:**

(a) Easiest — swap `HUBSPOT_DEV_ACCESS_TOKEN` value in `.env.local`
    to garbage (e.g., add an `X` prefix), restart dev server, repeat
    HBS-1 flow.
(b) Block HubSpot at the network layer (firewall rule on
    api.hubapi.com). Heavier setup; only needed if (a) doesn't fit
    the smoke.

**Expected:**
- Submit click → modal stays open
- Inline error: "Could not create product in HubSpot:
  Failed to create HubSpot product" (or similar wrapped message)
- NO new `leaves` row created
- NO `leaf_create` audit row
- HubSpot DEV console shows no new product

**DB verification:**
```sql
select count(*) from leaves
 where created_at > now() - interval '2 minutes';
-- Expect 0 (no row from the failed attempt).
```

**Restore:** revert `.env.local` to the real DEV token + restart
dev server. Re-submit HBS-1 — should now succeed (or skip if HBS-1
already ran).

---

## HBS-3 · Pull · happy path · double-pull pattern

**Path:** Setup tree → click `↗ Pull from HubSpot`.

**Expected:**
- Modal opens; header "Pulling from HubSpot…"; phase caption
  "Active products · pass 1 of 2"
- 4-stat grid updates progressively: Batches · Added · Updated ·
  Archived
- "{N} products processed so far" running total
- Per-batch line: "Batch N: 100 processed · +X added · ~Y updated
  · Z archived"
- When active pass finishes (nextAfter=null with includeArchived=false):
  phase caption flips to "Archived sweep · pass 2 of 2"
- When archived sweep finishes: phase = "Pull complete"; green
  completion card "✓ Pulled {N} HubSpot products into the library.
  {added} new · {updated} updated · {archived} archived."
- Close → modal dismisses; Setup tree unchanged (library leaves
  don't auto-attach to ASYs)

**Cancellation guard:** during active pass, click outside modal —
nothing happens (backdrop dismissal disabled while pulling).

**DB verification:**
```sql
-- Library populated
select count(*) filter (where hubspot_product_id is not null) as hs_sourced
  from leaves;
-- Expect >> 0 (DEV sandbox should have at least a few products
-- post-HBS-1 + any pre-seeded DEV catalog).

-- Pull batch root audit rows
select count(*),
       sum((diff_json->>'processed')::int) as processed,
       sum((diff_json->>'added')::int) as added,
       sum((diff_json->>'updated')::int) as updated
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'hubspot_pull_batch';
-- Expect: row count = (active batches) + (archived batches),
-- typically 2-3 batches total for DEV sandbox-sized catalogs.
```

---

## HBS-4 · Pull · idempotency on re-run

**Path:** Immediately re-run Pull (after HBS-3 succeeds).

**Expected:**
- Completion card shows "0 new · {N} updated · {Z} archived"
  (every product hit the UPDATE branch this time)
- No new `leaves` rows; existing rows have their `updated_at`
  bumped

**DB verification:**
```sql
-- No leaf count growth between runs
select count(*) from leaves where hubspot_product_id is not null;
-- Should match HBS-3's post-run count.

-- Latest pull batch audit shows added=0
select diff_json
  from audit_log
 where action = 'hubspot_pull_batch'
 order by created_at desc
 limit 1;
-- Expect added=0, updated > 0.
```

---

## HBS-5 · Pull · archive handling

**Path:** In HubSpot DEV console, manually archive one of the
products that has been pulled (Products → product detail → ⋯
→ Archive). Then re-run Pull.

**Expected:**
- Re-run shows an `archived` increment in the completion card
- The corresponding `leaves` row has `archived = true`
- Audit log shows a `leaf_archive` row with
  `source: 'hubspot_pull'` + `caused_by_audit_id` pointing at the
  parent `hubspot_pull_batch` row

**DB verification:**
```sql
-- Archived leaf transitioned
select id, name, archived
  from leaves
 where archived = true
   and updated_at > now() - interval '5 minutes';
-- Expect 1 row (the one Edward manually archived).

-- Cascade-derived archive audit row
select action, diff_json, caused_by_audit_id
  from audit_log
 where created_at > now() - interval '5 minutes'
   and action = 'leaf_archive'
   and diff_json->>'source' = 'hubspot_pull';
-- Expect 1 row with caused_by_audit_id non-null.
```

---

## HBS-6 · Pull · type preservation on re-pull

**Path:** Pre-conditions — HBS-3 ran, library has some HubSpot-
sourced leaves with `product_type_id = NULL` (no auto-typing on
pull). Pick one and assign a type via the impl-3 TypePicker flow
(open the leaf detail, set Product Type). Then re-run Pull.

**Expected:**
- Re-pull does NOT overwrite the manually-assigned `product_type_id`
- Other fields (name, sku, unit_cost, url) may refresh from
  HubSpot

**DB verification:**
```sql
-- Pick a leaf to track; replace {leafId} with the chosen row's id
select id, product_type_id, hubspot_product_id, updated_at
  from leaves
 where id = '{leafId}';
-- Note product_type_id pre-re-pull. After re-pull, product_type_id
-- must be unchanged. updated_at advances (UPDATE fires regardless).
```

---

## HBS-7 · Library browse · HubSpot-sourced indicator chip

**Path:** Setup tree → click `+ Add leaf from library →` → library
browse modal opens.

**Expected:**
- HubSpot-sourced rows (post-HBS-1, post-HBS-3) display a small
  `⤓ HS` chip adjacent to the type-tag, with accent-soft register
- Pre-slice Nexus-local rows (the 8 impl-1 fixture leaves) do NOT
  show the chip
- Hover the chip → title tooltip: "Sourced from HubSpot · product
  id {value}"
- Search + scope + type filters interact normally; chip render
  unaffected by filter state

---

## HBS-9 · Cascade audit row count verification

After HBS-3 (Pull happy path), verify the audit cascade pattern:

```sql
-- One root + N derived per batch
select root.id as root_id,
       (root.diff_json->>'batch_number')::int as batch,
       (root.diff_json->>'processed')::int as processed,
       (root.diff_json->>'added')::int as added_in_diff,
       count(child.id) as derived_count
  from audit_log root
       left join audit_log child on child.caused_by_audit_id = root.id
 where root.action = 'hubspot_pull_batch'
   and root.created_at > now() - interval '15 minutes'
 group by root.id, root.diff_json
 order by batch;
-- Expect: derived_count ≈ added_in_diff + (archive transitions in batch).
-- derived_count ≤ processed (UPDATEs without archive transition
-- emit no derived rows; only INSERTs + state-transitioning archives do).
```

---

## CB merge-gate checklist

After all HBS scenarios run cleanly:

- [ ] HBS-1 push path (DEV) — PASS
- [ ] HBS-2 push failure UX — PASS (manual error injection)
- [ ] HBS-3 pull happy path — PASS
- [ ] HBS-4 pull idempotency — PASS
- [ ] HBS-5 archive handling — PASS
- [ ] HBS-6 type preservation — PASS
- [ ] HBS-7 library indicator chip — PASS
- [ ] HBS-9 cascade audit shape — PASS
- [x] HBS-8 OAuth scope (DEV) — Step 1 §1
- [x] HBS-8 OAuth scope (PROD) — Step 1B
- [ ] Vercel `HUBSPOT_WRITE_ACCESS_TOKEN` set (Edward; before
      production deploy — non-blocking for merge to main)

---

## Cumulative Pattern 27 manifest

This slice ships 8 commits across 8 steps. Each commit carries its
own manifest; this section folds them for end-of-slice audit.

### STRUCTURAL MATCHED (full slice)

- Schema: `leaves.hubspot_product_id text` + partial indexes
  (`leaves_hubspot_product_id_idx` unique, `leaves_archived_idx`)
- `src/lib/hubspot.ts`: `listProducts` + `HubspotProductRaw` type
- `src/lib/hubspot-mapper.ts`: pure mapping (pull + push directions)
- `src/lib/hubspot-pull.ts`: `pullProductsBatch` transactional
  executor with cascade audit
- `src/app/actions/leaves.ts`: `createLeaf` HubSpot-first refactor
- `src/app/actions/hubspot-pull.ts`: `pullFromHubSpot` server-
  action wrapper
- `src/components/assembly-tree/pull-from-hubspot-trigger.tsx`:
  modal + double-pull loop client component
- `src/components/library/library-browse-modal.tsx`: HS chip
  render

### POLISH MATCHED (full slice)

- Locked field-mapping table documented inline in
  `hubspot-mapper.ts` (12 HubSpot fields × pull/push direction)
- Cascade audit pattern matches Slice 8.5 precedent
- `source` discriminator follows Slice 9.2 namespace convention
- HS chip register matches project detail 📎 chip grammar
  (mono uppercase 10-10.5px, paper-2/rule with accent
  variants for origin signal)
- Modal register matches scenario-create + add-product
  (a1v2-modal-* class family)
- CLAUDE.md audit namespace updated: leaf_create source field +
  leaf_archive source field + hubspot_pull_batch root action

### DEFERRED (full slice → carry-forwards, NOT in this slice)

- Scheduled background sync via HubSpot webhooks → v1.1+
- Bulk-edit leaf metadata that writes back to HubSpot → v1.1+
- Conflict resolution UI when HubSpot + Nexus diverge mid-pull
  → v1.1+
- NetSuite mirror reconcile → out of scope (HubSpot writes only)
- Description + price columns on leaves (Catch #12 deferral) →
  revisit v1.1+ if PMs need them
- Advisory lock on parallel pulls (Concern D) → v1.1+
- Legacy `addProductSku` + `addSkuFromHubspotProduct` dead code
  cleanup → UX_BACKLOG sweep

### NOT-IN-ANY-STEP

(none)

---

## §0.5 Pattern 22 catch ledger (cumulative across slice)

| # | Catch | Disposition |
|---|---|---|
| 9 | `leaves.hubspot_product_id` doesn't exist (anticipated in brief) | Added Migration 1 |
| 10 | `leaves.archived` already exists | Dropped column-add; kept new partial index |
| 11 | `leaf_archive` action exists (brief proposed `leaf_archived`) | Reused with `source: 'hubspot_pull'` |
| 12 | `description` + `price` columns missing on `leaves` | Stay skipped from pull mapping |
| 13 | Cost-math layer `production_inputs` dependency on new leaves | Verified decoupled for ASY/LEAF model |
| 14 | No `listProducts` paginated helper | Added in Step 3 |

Pattern 22 §0.5 cumulative count: 9 → 14 (5 new catches in this
slice; 8th-14th overall since pattern's promotion to standing
protocol).

---

## Standing by

Edward walks HBS-1 through HBS-7 + HBS-9. CSF-style "pass, merged"
on PR confirmation completes the slice.

— CC, 2026-05-21

# Slice 12 close verification — §0.5 report

Architect verification, 2026-07-29. CA-authorized pre-Step-10-close pass.

## 1. `quotes` schema shape

**Evidence:**
- 13 columns added Slice 12 across migrations 0037-0046
- FK behavior confirmed: `customer_accepted_tier_id` SET NULL / `accepted_tier_id` RESTRICT / `customer_accepted_recorded_by_user_id` SET NULL
- `netsuiteSoId` typed `varchar(50)`; `netsuiteSoTranid` typed `text` (asymmetric — the ID is `varchar` from Step 3, the tranid mirror added 8c-3 as `text`. Same field family, different types.)
- All Slice 12 additions nullable; no defaults; no data currently exercising the freeze-committed shape (0 complete)
- `unmarkAccepted` (2489-2519) does NOT clear `customer_accepted_tier_id` or `customer_response_channel`; `reviseFromAccepted` (1898-1902) does NOT clear them either. Post-unmark quotes carry stale acceptance data until re-accept overwrites.

**Assessment:** Additive-only, no destructive changes. Type asymmetry (`varchar(50)` vs `text`) on the two NetSuite SO ID columns is a minor smell — same string category, no functional difference at NetSuite's ID range, but future-CC diffing the columns will notice.

- **BANK**: Stale `customer_accepted_tier_id` / `customer_response_channel` on unmark → revise → draft path. Not customer-visible today (no path renders them on draft). Becomes a concern IF a future admin surface reads them out of context.
- **BANK**: `netsuiteSoId varchar(50)` vs `netsuiteSoTranid text` inconsistency. Not a bug; unify next migration touch.
- **OK**: All Slice 12 additions are shape-sound.

## 2. Pattern 52 freeze list

**Evidence:**
- CLAUDE.md Pattern 52 describes discipline as "held by CONVENTION, not by schema"
- Only `mark-complete.ts` (lines 528-538, 651-652) writes `netsuiteSoPushStatus` / `netsuiteSoPushError` / `netsuiteSoTranid`; `mark-complete.ts:109` guards `quote.status !== "accepted"` (rejects on 'complete')
- Freeze-tx (642-696) writes all 6 Slice 12 columns in one UPDATE; runs on 'accepted' quotes only
- `assertDraft` (quotes.ts:213) called at 9 sites in quotes.ts; NONE include the netsuite columns in their edit surface
- No canonical "freeze list" inventory exists in one place — it's implicit across schema comments

**Assessment:** The freeze list is complete for the mechanism operating today. The 3 new mirror columns (`netsuiteSoTranid`, `netsuiteSoPushStatus`, `netsuiteSoPushError`) ARE effectively frozen post-complete because nothing except `mark-complete.ts` writes them, and `mark-complete.ts` rejects non-accepted quotes at STEP 1. But this is architecturally identical to Pattern 52's stated failure mode: reproducibility guaranteed by convention, not by `assertDraft` on the mutation entry.

The failure surface: Slice 13+ admin surface (e.g., "retry failed SO push", "manually record NetSuite SO id"), NetSuite reconcile job, or a Slice 15 CS support tool — any of these could write these columns without knowing to fail-closed against `status='complete'`. Same risk as the base Pattern 52 columns.

- **RECOMMEND**: Add a canonical freeze-list inventory to `docs/BOM_NOTES.md` or a new `docs/pattern-52-freeze-list.md`. Enumerate all 30 columns (27 CA identified + `netsuiteSoTranid` + `netsuiteSoPushStatus` + `netsuiteSoPushError`). Cross-reference from Pattern 52 in CLAUDE.md. Cost of adding: 1 hour. Cost of missing this AT Slice 13 admin build: the same debugging round we've already seen for missing FK behavior.
- **RECOMMEND**: When Slice 13 admin surfaces are briefed, `§0.5` includes an explicit "does this write any Pattern 52 column?" check. If yes, action must call an `assertRevisable(quote)` helper that fails on `status IN ('accepted', 'complete')` for anything except the sanctioned reopen path.
- **OK**: Current writers respect the freeze by construction.

## 3. Choice/commitment FK pair

**Evidence:**
- FK asymmetry verified: `customer_accepted_tier_id → ... SET NULL`; `accepted_tier_id → ... RESTRICT`
- Freeze-tx writes `acceptedTierId: effectiveAcceptedTierId` (mark-complete.ts:647). Precedence `quote.acceptedTierId ?? quote.customerAcceptedTierId` (127-128) — override wins; v1 no-override always falls back.
- `deleteTier` (quotes.ts:918-947) has `assertDraft` guard; tier delete blocked on any non-draft quote — RESTRICT is defense in depth only
- 1 accepted quote (customer_set, accepted NULL), 0 complete quotes — no live post-freeze evidence

**Assessment:** Design intent survives. Post-freeze the RESTRICT locks tier deletion via DB constraint; `assertDraft` locks it via app layer. `customer_accepted_tier_id` staying at SET NULL preserves history-forgiving semantics for the customer's declared choice (nice-to-preserve, not load-bearing forensic). The asymmetry — one SET NULL, one RESTRICT — makes structural sense: the customer's stated choice is data; the commitment is contract.

**BLOCKER-adjacent finding — `netsuite_so_pushes.accepted_tier_id` has NO FK constraint** (0045 line 14: `"accepted_tier_id" uuid NOT NULL,` — no `REFERENCES`). If a tier row is deleted out-of-band (data admin cleanup), the push row's `accepted_tier_id` becomes an orphan uuid. Today the app layer's `assertDraft` blocks tier delete on accepted/complete quotes, so the app can't cause this. But defense-in-depth is thin.

- **RECOMMEND** (pre-launch, low-cost): Add `REFERENCES quote_tiers(id) ON DELETE RESTRICT` to `netsuite_so_pushes.accepted_tier_id`. Single-line migration; no data migration needed (all current values are valid — 0 rows). Symmetric with `quotes.accepted_tier_id` RESTRICT semantics. Migration destination: new manual `0047_netsuite_so_pushes_fk_tighten.sql`.
- **OK**: Choice/commitment split holds correctly against live evidence.

## 4. New tables

**`netsuite_item_groups` (0 rows):**
- Shape supports the three Slice 13 reactivation routes (a/b/c per UX_BACKLOG). `composition_hash` key + per-customer scope + `netsuite_external_id` unique are correct for all three.
- **Concern:** `firstUsedByQuoteId → quotes ON DELETE SET NULL` — same shape as SoPushes but this table is intended long-lived (per CA "groups are historically anchored"). If a quote is deleted (draft cleanup), the row keeps the group but loses provenance. Design is acceptable but note that `first_used_by_deal_id` is bare `text` — no FK to `projects.hubspot_deal_id`, so it's stable across quote/project deletes. Good.
- **BANK**: If Slice 13 reactivates, the description-generation path exists but is untested against real production items. Sandbox smoke covers happy path only.
- **OK**: Shape is right for reactivation; zero live weight until then.

**`netsuite_so_pushes` (0 rows currently):**
- Fresh INSERT per attempt design (mark-complete.ts:606-619) means N failures × M quotes produces N×M rows. UX_BACKLOG "Smoke-generated audit rows leave orphans" flags this at the audit_log level; same shape applies here.
- Partial unique index `WHERE status='succeeded'` correctly permits N failed rows per (quote, tier). Retry convergence path in mark-complete.ts (335-346, 372-393) works: CHECK-then-insert reads succeeded rows to bypass NetSuite POST.
- **`payload_snapshot jsonb`** is never pruned; each row carries the full SO request body. At production scale (say 5 SO pushes/mo, ~5KB each) storage is trivial. At 500/mo × 20KB = 10 MB/mo, still trivial. But no retention policy exists.
- **RECOMMEND**: Bank a payload_snapshot retention story in UX_BACKLOG. Suggest: after 90 days for succeeded pushes, null the `payload_snapshot` column (keep the row for forensic). Not urgent — bank as "Slice 14 or v1.1 admin hygiene." Do NOT ship now; premature per Pattern 32 tolerance until real production accumulates.
- **OK**: Shape is sound.

**`netsuite_customer_map` (9 rows):**
- Historical-anchor design: no delete path, all edits go through changed-audit. Consistent with the "map is contract" framing.
- PK on `hubspot_company_id` means a HubSpot company id renaming/reassignment path (rare but possible) would strand the mapping. Zero risk today; would surface if HubSpot admin ever merges two companies.
- **OK**: Shape is sound for v1.

## 5. Migration integrity

**Evidence:**
- `_journal.json` tracks auto-migrations 0-45 (46 entries) sequentially
- Live `__drizzle_migrations` has 38 rows, ids 7-47, gaps at 19/20/24 — first 7 auto-migrations were applied pre-tracking (early Slice 1 direct psql)
- Manual/0045 exists AND auto/0045 exists with same DDL; manual is idempotent (IF NOT EXISTS), auto is not
- Manual/0036 (data-fix: HubSpot stage label) and manual/0037 (data-fix: HubSpot stage ID key) collide numerically with auto-tracked DDL migrations of the same numbers
- Manual/0046 is a data-fix (tax code) with no auto-migration counterpart
- No manifest tracks which manual migrations have been applied to which environment — oral knowledge only

**Assessment: BLOCKER for production launch confidence.**

Concrete failure scenarios:
1. **Fresh deployment on a new Supabase project (or full DB reset)**: `drizzle-kit migrate` runs 0-45. Manual/0036, manual/0037, manual/0046 don't run automatically. HubSpot integration silently fails at markAccepted (wrong stage label / stage-ID key mismatch); NetSuite SO push fails with tax code error. All three are runtime-symptomatic, not startup-symptomatic. PMs discover the outage in the wild.
2. **New developer onboarding**: Same failure mode. No signal that manual migrations exist unless they read this specific CLAUDE.md.
3. **Prod rebuild required**: The order of "apply manual/0045 vs auto/0045" is ambiguous — auto/0045 is not idempotent (CREATE TABLE without IF NOT EXISTS at line 1); manual/0045 is idempotent. If someone runs the auto tool after the manual tool, prod errors.

- **BLOCKER**: Before v1 launch, either (a) reconcile manual/0036/0037/0046 into a proper drizzle-tracked migration OR (b) add an explicit `scripts/apply-all-manual.mjs` that reads a manifest file listing which manual migrations must be applied at any deployment. Preferred: (a) — collapse manual/0036 into auto-drizzle-kit's model. Manual/0046 (tax code data fix) can be idempotent SQL in a new auto/0047 migration.
- **BLOCKER-adjacent**: manual/0045 vs auto/0045 duplication — pick one, delete the other. Since auto/0045 is already in `_journal.json` and applied to prod, delete manual/0045 or leave it explicitly marked "obsolete — auto/0045 supersedes."

## 6. Speculative additions

**`pendingHubspotFromStageId` + `pendingHubspotFromStageVersion` (0 rows populated):**
- Defensive engineering against a REAL failure mode (from_stage poisoning on retry after HubSpot succeeds + DB tx fails). Zero rows means either no failures happened, or every failure completed retry successfully (clearing the columns).
- The pattern is textbook Pattern 52 sibling: pre-write outside tx, clear inside tx that finalizes state. Cost: 2 nullable columns + 1 extra UPDATE per accept attempt. Benefit: rollback via unmarkAccepted reads correct from_stage on ANY retry outcome.
- **Keep as-is.** This is exactly the kind of correctness cost that Slice 12 should have paid. Removing pre-launch would trade a real bug for two columns.
- **OK**.

**`netsuite_item_groups` (0 rows):**
- Assessed in §4. Shape is right for reactivation. `smoke:netsuite-item-groups` script keeps the primitives exercised.
- **OK — keep**. Removing pre-Slice-13 would require re-shipping when Vu's backfill lands.

---

## Standing-cost analysis (production-hardening lens)

Ranked by cost of change once Nexus is in production use:

1. **Manual migration model** (§5 BLOCKER). Once prod carries real deals, "we need to re-apply manual/0037 to a hot DB" is a real production incident. Fix cost NOW: ~2 hours to collapse into auto-migrations + document. Fix cost POST-LAUNCH: same 2 hours + downtime coordination + risk of running on a DB with partial state.

2. **Pattern 52 freeze list held by convention** (§2 RECOMMEND). Once Slice 13 or admin/reconcile paths land, any new writer could bypass without knowing. Fix cost NOW: 1 hour to enumerate + add an `assertRevisable` helper. Fix cost POST-LAUNCH: potentially data corruption on completed quotes that requires audit reconstruction to unwind.

3. **`netsuite_so_pushes.accepted_tier_id` missing FK** (§3 RECOMMEND). Symptom: orphan uuid in forensic table if tier deleted out-of-band. Fix cost NOW: 1-line migration. Fix cost POST-LAUNCH: data cleanup of orphans + backfill FK integrity check.

4. **`payload_snapshot` retention** (§4 BANK). Storage growth is gentle; won't matter for 6-12 months at v1 scale. Fix cost NOW or later: same. Genuine BANK.

5. **`netsuiteSoId varchar(50)` vs `netsuiteSoTranid text` type asymmetry** (§1 BANK). Cosmetic. Fix in any future migration that touches the columns.

6. **Stale `customer_accepted_tier_id` on unmark → revise path** (§1 BANK). Not customer-visible today. Would become a real issue only if a future admin surface reads it out of context. BANK.

The three items worth resolving pre-launch (in order): the manual-migration reconciliation (#1) is the only true BLOCKER — the other two RECOMMENDs are worth 2-3 hours to close but wouldn't block v1 launch if deferred.

Reference paths:
- `src/lib/netsuite/mark-complete.ts` (freeze-tx entrance, mirror-column writes)
- `src/app/actions/quotes.ts:213` (assertDraft), `:918-947` (deleteTier), `:2404-2519` (unmarkAccepted), `:1860-1935` (reviseFromAccepted)
- `src/db/schema.ts:305-544` (quotes), `:2257-2426` (netsuite tables)
- `drizzle/manual/0036_slice_12_step_7b_hubspot_stage_label_fix.sql`, `0037_...`, `0045_...`, `0046_...` (unreconciled manual migrations)
- `drizzle/0045_slice_12_step_8c3_schema.sql:14` (missing FK on `accepted_tier_id`)

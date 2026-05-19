# Canonical scenario-create flow · CC kickoff

**Slice:** `slice-canonical-scenario-create-flow`
**Branch:** `slice-canonical-scenario-create-flow`
**Brief:** `docs/cc-comm-canonical-scenario-create-flow-impl-brief.md`
**Dispositions:** `docs/cc-canonical-scenario-create-flow-dispositions.md` (CA)
**Estimate:** 4-5 days

---

## Pattern 22 §0.5 verification — PASS

| Check | Status | Notes |
|---|---|---|
| `quotes` column collision | ✓ clean | None of `intent_note`, `customer_target_tier_label`, `scenario_recommended` exist on the table |
| `quote_tiers.recommended` vs `quotes.scenario_recommended` | ✓ distinct | Per-tier vs per-scenario semantics; distinct names; no FK collision |
| `drop_reason` enum value | ✓ `'manual'` present | per CA disposition 1, swap from speculative `'explored'` to canonical `'manual'` (per schema comment "manual: PM explicitly dropped it") |
| Storage permission | ✓ DIRECT_URL can read `storage.buckets` | 0 buckets currently exist; `quote-attachments` creates via manual SQL |
| File 0034 number availability | ✓ available | drizzle/manual/ highest = 0033; both auto-gen + manual SQL files claim 0034 (parallel naming per 0030 precedent) |

## CA disposition amendments folded in

Per `docs/cc-canonical-scenario-create-flow-dispositions.md`:

1. **`drop_reason` enum** — `'manual'` (not `'explored'`) per schema canonical
2. **Target tier dropdown source** — current scenario's `quote_tiers` rows passed as prop from server loader
3. **Migration files** — split into `drizzle/0034_*.sql` (drizzle-kit auto-gen DDL) + `drizzle/manual/0034_canonical_scenario_create_storage.sql` (manual SQL for Storage + RLS)
4. **Step 3 commit message** — explicit HubSpot writeback lineage acknowledgment per CA disposition (regression-window widens to all scenarios; pre-launch tolerance; bundled bidirectional micro-slice restores)
5. **Component dirs** — `src/components/scenario-create/` (modal + trigger) + `src/components/quote-attachments/` (list UI); split by lifecycle-scope per established `add-product/` / `assembly-tree/` convention

Technical observations CA concurred on:
- `loadAssemblyTree` keeps nullable signature; always returns non-null in practice (non-breaking refactor)
- Pattern 28 N/A for modal content (no canonical CD source); Pattern 30 applies to shell CSS; Pattern 27 documents nexus-extension delta
- `setScenarioRecommended` standalone action stays (future-proofs v1.1+; carries own audit row)

## Step plan (8 commits)

1. **Step 1 — kickoff** (this commit)
2. **Step 2 — schema migrations + Storage bucket**
   - schema.ts edits + `drizzle-kit generate` → `drizzle/0034_*.sql` (auto-gen)
   - `drizzle/manual/0034_canonical_scenario_create_storage.sql` (Storage bucket + RLS)
   - Edward authorizes both applies
3. **Step 3 — loader refactor + detector removal**
   - `loadAssemblyTree` returns empty-tree instead of null on zero-assembly state
   - Remove `usesNewSchema` detector + legacy render branch
   - Remove legacy `SkuRowList` + drawer + `add-product-modal.tsx` chain (with HubSpot-writeback lineage acknowledgment in commit message per CA disposition 4)
4. **Step 4 — server actions**
   - `createScenario` refactor (form-action → ActionResult shape)
   - `addQuoteAttachment` + `removeQuoteAttachment`
   - `setScenarioRecommended` (standalone)
   - Audit namespace updates in CLAUDE.md
5. **Step 5 — modal client component**
   - `src/components/scenario-create/canonical-modal.tsx`
   - All 3 start-path radios; Copy paths visible-disabled with inline messaging
   - File upload with inline validation errors
6. **Step 6 — modal trigger wiring**
   - Project detail form-action → client modal trigger
   - Post-create router.push to new quote's /setup
7. **Step 7 — post-creation surfaces**
   - Project detail scenario card: ★ Primary badge + 📎 N chip + intent tooltip
   - Setup header attachment-list affordance + list modal
   - `src/components/quote-attachments/` for the list UI
8. **Step 8 — smoke guide + Pattern 27 wrap**

## Risk + open items

- **Modal trigger source quote** — modal needs the most-recent active scenario in the project to load tier labels for the target-tier dropdown. Single server query at page load.
- **`scenarioRecommended` flag flip transactionality** — `createScenario` either sets the new quote as recommended (and unsets all others atomically) OR creates without touching recommendation. Single transaction.
- **Pre-existing form-action callsite** — project detail page's `<form action={createScenario}>` swaps to a client trigger button + modal mount. Removing the form-action cleanly is part of Step 6.

## Carry-forwards (per brief)

- FR-12 copy operations → next slice
- Multi-file upload at modal time → single at modal, multi via post-creation list modal
- HubSpot bidirectional micro-slice → after this slice ships
- Pattern 22 §0.5 catch automation → v1.5+ candidate (6 catches in v1 cycle to date)

## Next

Step 2 — schema migrations + Storage bucket.

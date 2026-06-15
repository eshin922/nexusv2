# slice-hubspot-bidirectional · Step 1 kickoff

**Branch:** `slice-hubspot-bidirectional`
**Step:** 1 (kickoff + Pattern 22 §0.5 pre-build verification +
OAuth scope smoke)
**Date:** 2026-05-20
**Status:** Step 1 PASS. Cleared to proceed to Step 2 (schema
migration).

---

## §1 — OAuth scope smoke (DEV path)

Per CA disposition (b) — DEV smoke now, PROD scope smoke as
pre-merge gate. Edward provisions HUBSPOT_WRITE_ACCESS_TOKEN in
parallel; CC re-runs Step 1 smoke against PROD before merge.

### Run output

```
--- READ scope smoke ---
OK · getPage(1) returned 1 product(s)
  Sample: id=2911876415 · name="Coca Cola - 12Oz Bottle -1.1"

--- WRITE scope smoke ---
OK · create returned id=44892913161 · sku=NEXUS-OAUTH-SMOKE-1779301108637

--- CLEANUP ---
OK · archived id=44892913161

=== Step 1 smoke PASS ===
Read scope: OK · Write scope: OK · Archive scope: OK
```

### What was verified

- HubSpot DEV sandbox is reachable via `HUBSPOT_DEV_ACCESS_TOKEN`
- `crm.objects.products.read` scope confirmed (getPage returned a
  real product)
- `crm.objects.products.write` scope confirmed (create returned a
  new product id)
- Archive permission confirmed (cleanup removed the test product)
- `@hubspot/api-client` SDK call shape works against current
  HubSpot Products API

### Cleanup state

- Test product `id=44892913161` archived (HubSpot soft delete) in
  DEV sandbox. Safe to delete permanently from HubSpot UI if
  Edward wants to clear residue; otherwise auto-purges per
  HubSpot's archive retention policy.

### PROD pre-merge gate

Per CA disposition, before merge:

- [x] Edward provisions PROD HubSpot private app with
      `crm.objects.products.read` + `crm.objects.products.write`
      scopes — done 2026-05-21
- [x] `HUBSPOT_WRITE_ACCESS_TOKEN` set in local `.env.local` —
      done 2026-05-21
- [ ] `HUBSPOT_WRITE_ACCESS_TOKEN` set in Vercel env vars
      (production + preview) — Edward's task; Vercel UI; before
      deploy
- [x] CC re-runs Step 1 scope smoke against PROD — see §1B below
- [x] PROD smoke result appended — see §1B below

---

## §1B — PROD OAuth scope smoke (2026-05-21)

Re-run of Step 1 against PROD HubSpot via the just-provisioned
`HUBSPOT_WRITE_ACCESS_TOKEN`. Same script shape as the DEV smoke;
swap token only.

### Run output

```
--- READ scope smoke (PROD) ---
OK · getPage(1) returned 1 product(s)
  Sample: id=1808453674 · name="DISPOSABLE VAPE PEN - TOOLING"

--- WRITE scope smoke (PROD) ---
OK · create returned id=44985123601 · sku=NEXUS-OAUTH-SMOKE-PROD-1779409473377

--- CLEANUP (PROD) ---
OK · archived id=44985123601

=== Step 1B PROD smoke PASS ===
Read scope: OK · Write scope: OK · Archive scope: OK
```

### What was verified

- HubSpot PROD reachable via `HUBSPOT_WRITE_ACCESS_TOKEN`
- `crm.objects.products.read` scope confirmed
- `crm.objects.products.write` scope confirmed
- Archive permission confirmed (cleanup removed test product)
- Same SDK call shape works against PROD as DEV — no API surface
  divergence

### Cleanup state

- Test product id=44985123601 archived (HubSpot soft-delete) in
  PROD. Visible briefly in PROD HubSpot UI between create + archive
  calls (~5s window); safe to ignore. Auto-purges per HubSpot's
  archive retention policy.

### Remaining pre-merge tasks

Only Vercel env-var configuration remains (Edward's task). PROD
deploy from main after merge requires
`HUBSPOT_WRITE_ACCESS_TOKEN` set in Vercel production + preview
environments; otherwise `getProductsClient()` falls back to
`HUBSPOT_ACCESS_TOKEN` (read-only) and `createProduct` /
`pullFromHubSpot` will 403 on write attempts in PROD.

---

## §2 — Pattern 22 §0.5 pre-build verification

Per CC review (`docs/cc-comm-hubspot-bidirectional-review.md`).
All five new catches confirmed against current `main`:

### Catch #10 — `leaves.archived` ALREADY EXISTS

**Verified:** `src/db/schema.ts:1690` carries
`archived: boolean("archived").notNull().default(false)`. Plus
existing partial indexes filter on `archived = false`.

**Disposition (Edward confirmed):** Drop `archived` column-add
from Migration 1; keep partial index
`leaves_archived_idx (archived) WHERE archived = true` (new
index complementing existing `archived = false` ones).

### Catch #11 — `leaf_archive` action ALREADY EXISTS

**Verified:** `CLAUDE.md` namespace ~line 2483:

> `'leaf_archive'` — soft-archive (sets archived=true). entity_id
> = leaf.id; diff_json carries {reason} when PM provides one.

**Disposition (Edward confirmed):** Reuse existing `leaf_archive`;
namespace pull-triggered archive via `diff_json.source =
'hubspot_pull'`. Mirrors Slice 9.2 source-flag convention.

### Catch #12 — `description` + `price` columns DON'T EXIST on `leaves`

**Verified:** `src/db/schema.ts:1676-1706` — `leaves` columns are
name, sku, url, image_url, productTypeId, unitCost, fscClaim,
fscStatus, supplierVerified, ownerId, archived, createdAt,
updatedAt. No `description`, no `price`/`unit_price`.

**Disposition (Edward confirmed):** Both fields stay skipped from
pull mapping (no column add this slice). PM uses HubSpot UI for
description/price edits until v1.1+.

### Catch #13 — Cost-math layer `production_inputs` dependency

**Verified pre-build:**

- `src/lib/costing.ts` (math module) does NOT import
  `productionInputs`. Math layer is decoupled at the module level.
- `src/app/actions/costing.ts` reads `productionInputs` via
  `innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))`
  at lines 288, 1121, 1429. These read paths walk the LEGACY
  `quote_skus` tree.
- Phase A.1 v2 quotes (assemblies + leaves) have zero `quote_skus`
  rows; legacy read paths return empty and downstream math uses
  the new `leaves.unit_cost` direct path.

**Conclusion:** Pull creating ~990 library leaves requires ZERO
production_inputs seeding. The new ASY/LEAF model rolls up costs
directly from `leaves.unit_cost` through `assembly_leaves`
junctions; no per-tier production-rate rows needed.

**Disposition (CC self-verified):** Cleared. Pre-build verification
gate PASS.

### Catch #14 — No `listProducts` paginated helper in `hubspot.ts`

**Verified:** `src/lib/hubspot.ts` exports `searchProducts(query,
limit)`, `getProduct(id)`, `findProductBySku(sku)`,
`createProduct(input)`. No `listProducts({ after, limit,
includeArchived })` helper for paginated bulk-list.

**Disposition (Edward confirmed):** Add helper in Step 3. Two
calls per pull operation needed (active products + archived
products); HubSpot's list endpoint defaults to archived=false.

---

## §3 — Concerns from review (carry-forwards)

All dispositioned. Tracking for slice scope:

- **Concern A · Cascade audit pattern** — confirmed: one root
  `hubspot_pull_batch` row per batch + N derived `leaf_create`
  rows via `caused_by_audit_id`.
- **Concern B · OAuth scope** — DEV PASS; PROD pre-merge gate.
- **Concern C · Push field mapping** — confirmed limited to
  name + sku + unit_cost + url (subset of AddProductModal LEAF
  form fields).
- **Concern D · Double-click pull race** — modal-level disable
  handles 99%; advisory lock banked to v1.1+.

---

## §4 — Step plan refinement (locked)

1. ✅ **Step 1** · Kickoff + Pattern 22 §0.5 verification + OAuth
   scope smoke (DEV PASS)
2. **Step 2** · Schema migration — Migration 1 adds
   `leaves.hubspot_product_id text` + `leaves_hubspot_product_id_idx`
   unique partial index + `leaves_archived_idx` partial index.
   Drop `archived` column add per Catch #10.
3. **Step 3** · `src/lib/hubspot-mapper.ts` (Nexus leaf ↔ HubSpot
   Product field mapping per locked table) + `src/lib/hubspot-pull.ts`
   (pagination + dedup + cascade-audit batching) + add
   `listProducts` helper to `src/lib/hubspot.ts`.
4. **Step 4** · `createLeaf` refactor (HubSpot-first restored;
   call `createProduct` then INSERT `leaves` with
   `hubspot_product_id`; failure path returns ActionGuardError
   with no local row).
5. **Step 5** · `pullFromHubSpot` server action + cascade audit
   (one `hubspot_pull_batch` per batch + N derived `leaf_create`
   rows) + extended audit namespace doc-updates in CLAUDE.md.
6. **Step 6** · Setup tree button wiring (existing inert button
   at `src/components/assembly-tree/assembly-tree-view.tsx:82-95`)
   + progress UI + completion toast.
7. **Step 7** · Library browse modal HubSpot-sourced indicator
   chip (`src/components/library/library-browse-trigger.tsx` +
   browse rows).
8. **Step 8** · Smoke guide + Pattern 27 wrap + PROD scope smoke
   re-run (pre-merge gate).

---

## §5 — Standing by

Step 1 PASS. Cleared to proceed to Step 2 (schema migration) on
Edward's next directive. PROD token request on Edward's radar in
parallel.

— CC, 2026-05-20

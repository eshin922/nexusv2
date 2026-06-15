# HubSpot bidirectional micro-slice · CC brief review

**Date:** 2026-05-20
**Branch:** (none — pre-kickoff)
**Brief under review:** `docs/hubspot-bidirectional-brief.md` (or
inline from chat per CA convention)
**Status:** CC review complete. Surfacing concerns for CA + Edward
disposition before kickoff.

---

## §0 — Summary

Brief is well-scoped overall. Architecture lines up with the prior
HubSpot-first pattern, and the dev/prod-aware client wiring is
already in place from Phase 1 (add-product modal era). Six
Pattern 22 §0.5 catches surfaced (one was anticipated by the brief
itself, raising slice total to **catch #9-#14**). One architectural
concern (cascade-audit pattern for ~990 leaf creates in one
button-click) needs CA disposition before kickoff. Field-mapping
table for pull direction needs locked values.

No blockers. With dispositions on the six items below, slice can
kick off cleanly.

---

## §1 — Pattern 22 §0.5 catches

### Catch #9 (anticipated by brief) · `leaves.hubspot_product_id` doesn't exist

**Status:** ✅ Already flagged in brief intro. Migration 1 adds it.
No action needed beyond confirming Migration 1's idempotent guards.

### Catch #10 · `leaves.archived` ALREADY EXISTS

**Where:** `src/db/schema.ts:1690`.

```ts
archived: boolean("archived").notNull().default(false),
```

Plus existing indexes:
```ts
index("leaves_product_type_idx")
  .on(t.productTypeId)
  .where(sql`archived = false`),
index("leaves_sku_idx").on(t.sku).where(sql`archived = false`),
```

**Disposition needed:** Drop `archived` column add from Migration 1
(idempotent guards would catch it, but cleaner to remove the line
entirely). Keep the `leaves_archived_idx` partial index addition
(`WHERE archived = true`) — it's a new index that complements the
existing `archived = false` indexes.

### Catch #11 · `leaf_archive` audit action ALREADY EXISTS (brief says `leaf_archived`)

**Where:** `CLAUDE.md` namespace line ~2483.

> `'leaf_archive'` — soft-archive (sets archived=true). entity_id =
> leaf.id; diff_json carries {reason} when PM provides one.

Brief's proposed `leaf_archived` (past tense) is a new action name
duplicating an existing one.

**Disposition needed:** Reuse existing `leaf_archive` action. Pull
distinguishes auto-archive from manual via `diff_json.source =
'hubspot_pull'` per Slice 9.2 source-namespace convention. Mirrors
the `system_suggestion` / `system_version_pin` precedent.

### Catch #12 · `description` + `price` columns don't exist on `leaves`

**Where:** `src/db/schema.ts:1676-1706` — `leaves` columns are
name, sku, url, image_url, productTypeId, unitCost, fscClaim,
fscStatus, supplierVerified, ownerId, archived.

Brief Q4 mentions "description, price, image_url" as field-mapping
candidates for pull. `description` and `price` (sell-price) have no
nexus column to land in. `image_url` ✓ exists.

**Disposition needed:** lock pull field mapping (see §3 below).
Either add columns OR explicitly skip these from the mapper. CA
recommendation needed.

### Catch #13 · Cost-math layer dependency on `production_inputs` for new leaves

**Where:** Legacy `addProductSku` (`src/app/actions/quotes.ts:706-710`
+ `seedProductionInputsForNewLeaf` at 736-754) seeded one
`production_inputs` row per existing tier when a leaf SKU was
created. The new Phase A.1 v2 `createLeaf` (`src/app/actions/leaves.ts`)
does NOT seed `production_inputs` because `production_inputs.quote_sku_id`
doesn't apply — leaves are library-scoped (no `quote_id`), attached
via `assembly_leaves` junctions.

**Concern:** if cost-math layer still has a `production_inputs`
read path that breaks for new leaves, pulling 990 leaves silently
breaks the math.

**Disposition needed:** CC pre-verifies cost-math layer is fully
decoupled from `production_inputs` for the ASY/LEAF model
(presumably YES given impl-2 → impl-5 shipped). If NO, surface
immediately as a Phase A.1 v2 regression that PRE-DATES this slice
and needs separate handling.

**Pre-kickoff verification step:** grep `production_inputs` against
cost-math layer (`src/lib/costing.ts`, `src/app/actions/costing.ts`)
and check whether any read path can be triggered by leaf-only
quotes.

### Catch #14 · No `listProducts` paginated helper in `src/lib/hubspot.ts`

**Where:** `src/lib/hubspot.ts` has `searchProducts(query, limit)`,
`getProduct(id)`, `findProductBySku(sku)`, `createProduct(input)`,
but NO `listProducts({ after, limit })` for paginated bulk list.

**Disposition:** add helper. Signature:

```ts
export async function listProducts(opts: {
  after?: string;
  limit?: number; // max 100 per HubSpot
  includeArchived?: boolean;
}): Promise<{
  results: ProductSummary[];
  nextAfter: string | null;
}>;
```

Wraps `c.crm.products.basicApi.getPage(limit, after, properties,
propertiesWithHistory, associations, archived)`.

For archive sweep: pull must run TWICE per Pull operation — once
with `includeArchived: false` (active products) and once with
`includeArchived: true` (archived ones). HubSpot's list endpoint
defaults to `archived: false`; archived products are explicitly
excluded unless requested.

---

## §2 — Architectural concerns

### Concern A · Cascade audit pattern for bulk pull

**Issue:** 990 products on first pull = 990 `leaf_create` audit
rows in one button-click. Without cascade-pattern, this floods
the audit log and makes "find user-initiated leaf creates" queries
expensive (need to filter on `diff_json.source IS NULL`).

**Recommendation:** adopt the Slice 8.5 cascade-aware audit
pattern:

- One root `hubspot_pull_batch` audit row per batch
  (entity_type='project', entity_id=projectId, diff_json carries
  batch summary stats).
- Per-leaf rows are `leaf_create` (existing) BUT carry
  `caused_by_audit_id` pointing at the root + `diff_json.source =
  'hubspot_pull'`.
- Audit-log readers filter on `caused_by_audit_id IS NULL` for
  "user-initiated" + `caused_by_audit_id IS NOT NULL` for cascade
  scope.

This mirrors the existing `deleteSku` cascade snapshot pattern
(see CLAUDE.md "Assembly rules · Cascade-aware audit") and the
Slice 8.5 hubspot_pull design rhetoric. **CA disposition:**
confirm cascade pattern OR confirm one-flat-batch row (per-leaf
rows skipped).

### Concern B · OAuth scope reality check (brief §0.5 anticipates this)

**Status:** Edward needs to confirm `HUBSPOT_WRITE_ACCESS_TOKEN`
+ `HUBSPOT_DEV_ACCESS_TOKEN` both carry `crm.objects.products.write`
scope. The Phase 1 add-product modal already does `createProduct`
in dev (per `hubspot.ts:70-84` comment), suggesting the dev token
has the scope. Prod token status is a comment-asserted claim
("PROD hub via HUBSPOT_WRITE_ACCESS_TOKEN which carries both read
+ write scopes for Products since the dev token does") — not yet
verified against the actual prod token in production. **Step 0
smoke-test:** dummy product create against dev sandbox; if 403,
re-issue token before proceeding.

### Concern C · Push-direction field mapping is narrower than pull

**Pull mapping (HubSpot → nexus leaf):** ~10 fields
**Push mapping (nexus leaf → HubSpot product):** 4 fields from
AddProductModal LEAF form (name, sku, unitCost, url) + potentially
others.

Brief implies symmetric bidirectional mapping but the AddProductModal
LEAF form is minimal — PMs aren't entering description, owner,
fsc fields, image_url at leaf-create time. So `createLeaf` push
sends 4 fields; HubSpot product gets richer attributes later from
HubSpot UI or external sync.

**Disposition needed:** confirm push mapping is name + sku + cost
+ url ONLY (other fields stay HubSpot-empty until pull-back or
HubSpot-UI edit). Acceptable for v1; later micro-slice can add
"edit leaf metadata writes back to HubSpot" per brief carry-forward.

### Concern D · Idempotent pull + accidental double-click

If PM clicks Pull twice rapidly, two parallel pull operations
fire. Each batch INSERTs new leaves with `ON CONFLICT (hubspot_product_id)
DO UPDATE` (per the brief's upsert logic). Race condition possible
if both batches process the same HubSpot product simultaneously.

Postgres unique-index on `(hubspot_product_id) WHERE NOT NULL`
prevents duplicate rows but the race produces transient errors
mid-pull.

**Disposition needed:** advisory lock per-user OR per-project
during pull. Banking concern for v1 acceptance — if first prod
pull surfaces this, fix in v1.1+. Modal-level disable-while-pulling
UX handles 99% of accidental double-clicks; the remaining 1% is
rare enough for post-launch.

### Concern E · Legacy `addProductSku` / `addSkuFromHubspotProduct` orphaned code

**Status:** CSF Step 3 removed the legacy SKU renderer; the
modal/action files still on disk but no caller imports them
(see UX_BACKLOG entry "Legacy quote_skus components sweep"). This
HubSpot slice does NOT touch them.

**Recommendation:** preserve UX_BACKLOG entry; this slice's scope
stays narrow to createLeaf write-back + pullFromHubSpot. Cleanup
of dead `addProductSku` lives in the documented sweep.

---

## §3 — Field mapping recommendation

Locked candidate mapping table for CA + Edward review:

| HubSpot field | Nexus column | Pull direction | Push direction | Notes |
|---|---|---|---|---|
| `name` | `leaves.name` | ✓ | ✓ | direct |
| `hs_sku` | `leaves.sku` | ✓ | ✓ | direct |
| `hs_cost_of_goods_sold` | `leaves.unit_cost` | ✓ | ✓ | numeric; HubSpot returns text |
| `hs_url` | `leaves.url` | ✓ | ✓ | direct |
| `hs_images` | `leaves.image_url` | ✓ | (skip) | first URL only; pull doesn't push image edits |
| `hs_product_type` | (no map) | (skip) | (skip) | HubSpot enum ≠ nexus taxonomy; preserve product_type_id on pull |
| `description` | (no nexus column) | (skip) | (skip) | candidate column add; not required for v1 |
| `price` | (no nexus column) | (skip) | (skip) | sell-price lives on quote_skus, not leaves |
| `hubspot_owner_id` | `leaves.owner_id` | conditional | (skip) | map via `users.hubspot_owner_id` join; skip if no match |
| `fsc_claim_type` | `leaves.fsc_claim` | conditional | (skip) | text-to-bool coercion; `null/none → false`; any value → true |
| `fsc_status` | `leaves.fsc_status` | ✓ | (skip) | direct text |
| `fsc_supplier_verified` | `leaves.supplier_verified` | conditional | (skip) | text-to-bool coercion |
| `hs_status='archived'` | `leaves.archived` | ✓ | n/a | true if HubSpot product archived |

**Pull-only fields** (read but don't write back): owner mapping
+ fsc fields + archive state.

**Push-only fields:** none — push is a strict subset of pull.

**Skipped fields:** description + price (no column); hs_product_type
(taxonomy mismatch).

**CA + Edward disposition needed on:**
- Q4-A: confirm `description` + `price` + `unit_price` stay
  skipped (no column add this slice)
- Q4-B: confirm `hs_product_type` ≠ nexus `product_type_id`
  mapping (preserve nexus value across pulls; never auto-set
  from HubSpot)
- Q4-C: confirm owner mapping via `users.hubspot_owner_id` lookup
  (existing column; need to verify presence) OR skip pull-direction
  owner

---

## §4 — Smoke considerations

CB scenarios in brief look good. Two additions:

### HBS-8 · Dev token OAuth scope verification (Step 0 add)

Before any code change: Edward creates a dummy product manually in
HubSpot dev console; CC calls `getProduct()` to verify read scope
works; CC calls `createProduct({ name: "test", hs_sku: "TEST-001" })`
to verify write scope works. If write returns 403, surface
immediately; slice paused pending OAuth token re-issue.

### HBS-9 · Cascade audit query verification (post-Pull)

```sql
-- Confirm one root + N derived rows pattern
select root.id as root_id,
       count(child.id) as derived_count,
       root.diff_json->>'batch_number' as batch
  from audit_log root
       left join audit_log child on child.caused_by_audit_id = root.id
 where root.action = 'hubspot_pull_batch'
   and root.created_at > now() - interval '1 hour'
 group by root.id, root.diff_json->>'batch_number'
 order by batch::int;
-- Expect ~10 rows; each derived_count ≤ 100 (batch size).
```

---

## §5 — Step plan refinement

Brief's 8-step plan is sound. Recommend:

1. **Step 1** · Kickoff + Pattern 22 §0.5 verification + OAuth
   scope smoke (HBS-8 above)
2. **Step 2** · Schema migration (Migration 1, archived column
   dropped per Catch #10) — `npm run db:migrate`; manual apply
   via `apply-manual-sql.mjs` not needed (just drizzle migration).
3. **Step 3** · `hubspot-mapper.ts` + `hubspot-pull.ts` helpers
   + `listProducts` added to `hubspot.ts` (Catch #14).
4. **Step 4** · `createLeaf` refactor (HubSpot-first restored).
5. **Step 5** · `pullFromHubSpot` server action + cascade audit
   pattern (Concern A) + audit namespace doc-updates.
6. **Step 6** · Setup tree button wiring (existing inert button
   at `assembly-tree-view.tsx:82-95`) + progress UI + completion
   toast.
7. **Step 7** · Library browse modal HubSpot-sourced indicator
   chip (`src/components/library/library-browse-trigger.tsx`).
8. **Step 8** · Smoke guide + Pattern 27 wrap.

---

## §6 — Locked-disposition checklist (for CA + Edward to fill)

- [ ] Catch #10 — drop `archived` column add from Migration 1.
      Yes/No.
- [ ] Catch #11 — reuse `leaf_archive` (not `leaf_archived`) with
      `diff_json.source = 'hubspot_pull'`. Yes/No.
- [ ] Catch #12 — confirm `description` + `price` stay skipped
      from pull mapping (no column add this slice). Yes/No.
- [ ] Catch #13 — CC pre-verifies `production_inputs` decoupled
      from leaves before kickoff (CC todo, not CA disposition).
- [ ] Catch #14 — confirm `listProducts` helper added to
      `hubspot.ts`. Implicit yes; confirm.
- [ ] Concern A — confirm cascade audit pattern (1 root + N
      derived). Yes/No.
- [ ] Concern B — confirm Step 0 OAuth scope smoke as kickoff
      gate. Yes/No.
- [ ] Concern C — confirm push mapping limited to name + sku +
      cost + url. Yes/No.
- [ ] Concern D — confirm advisory-lock for double-click bank
      to v1.1+ (modal-level disable handles 99%). Yes/No.
- [ ] Q4-A — confirm description/price skipped. Yes/No.
- [ ] Q4-B — confirm hs_product_type NOT mapped. Yes/No.
- [ ] Q4-C — confirm owner mapping via users.hubspot_owner_id.
      Yes/No.

---

## §7 — Standing by

Brief is approvable post-disposition on the items above. No
blockers — every concern has a clear forward path. CC standing by
for CA disposition pass + Edward sign-off on the locked-
disposition checklist; then kickoff Step 1.

**Pattern 22 §0.5 catch count: 9 → 14 (5 new catches in this brief
review).** Pattern earned its standing-protocol promotion long ago;
catches 10-14 here are routine evidence that the pre-approval pass
keeps paying.

— CC, 2026-05-20

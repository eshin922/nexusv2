# slice-mark-accepted-netsuite-so-push — CC brief

**Branch:** `slice-mark-accepted-netsuite-so-push` (TBD CC naming)
**Baseline:** `main` post-PR #54 merge (Pricing surface redesign)
**Strategic position:** v1 critical path #7 — replaces existing PO-on-deal-stage-change business process with Nexus-authored canonical SO creation event
**Authoring:** CA (this thread) · 2026-06-16

---

## §1 · Strategic framing

This slice is a **business process replacement**, not just additive capability.

**Today's flow** (to be deprecated at slice merge):
```
PM marks deal accepted (in HubSpot or via existing trigger)
       ↓
Existing automation creates Purchase Order in NetSuite
       ↓
SO created downstream (manual / separate process)
```

**New flow under Slice 12:**
```
PM clicks Mark Accepted in Nexus Quote umbrella
       ↓
1. Freeze Nexus quote + snapshot production recipe (atomic)
       ↓
2. Push completed SO to NetSuite via custom RESTlet (async)
       ↓
3. Advance HubSpot deal stage to "Purchase Order" (via PR #50 client)
       ↓
4. Native HubSpot ↔ NetSuite sync propagates everything else
```

**Why this matters:**
- **Mark Accepted becomes Nexus's canonical authoring event** for the entire post-acceptance lifecycle
- **Production recipe entity** preserves the architectural commitment from CLAUDE.md banked learnings — accepted quotes freeze into stable production recipe entities (CM-facing artifact; consumption v1.1+ via CM packets / purchasing / reconciliation)
- **Lean on existing native sync** — Nexus does NOT dual-write to HubSpot for deal fields beyond stage advancement; NOT touch NetSuite custom subtabs (PP/SP/SGA/COP); NOT manage Customer/Company mapping
- **Hard cutover** — old PO-creation trigger disabled pre-merge; no parallel-run complexity

---

## §2 · Architecture

### Three-leg ownership model

| Leg | Owns |
|---|---|
| **Nexus** | Pre-acceptance pricing, acceptance event, frozen recipe, SO push trigger, HubSpot deal stage advancement |
| **NetSuite** | SO record (post-creation), fulfillment, billing, payment, project records |
| **HubSpot** | Deal stage source-of-truth, customer/company records, product spec source (PP/SP/SGA/COP fields) |

### Triangulation patterns (all confirmed via existing native sync infrastructure)

**SKU resolution:**
```
Nexus library leaf / ASY (SKU code)
       ↓ (HubSpot SKU field is mandatory; identical to leaf code)
HubSpot product
       ↕ (native sync; Product Inventory + Product Non-Inventory Resale sync ON)
NetSuite Item / Item Group
```
No new Nexus columns; SKU code is the join.

**Customer resolution:**
```
Nexus project.hubspot_deal_id
       ↓ (HubSpot deal → Associated Company)
HubSpot Company
       ↕ (native sync; Company sync ON, 4,498 records)
NetSuite Customer
```
RESTlet resolves Customer via the synced Company mapping. Nexus does NOT manage Customer IDs.

**Project resolution:**
```
Nexus project.hubspot_deal_id
       ↓ (HubSpot Deal synced via native sync to NetSuite Opportunity)
NetSuite Opportunity
       ↓ (NetSuite Project.main_opportunity = Opportunity ID)
NetSuite Project
```
RESTlet queries: `SELECT * FROM Project WHERE main_opportunity_id = (SELECT id FROM Opportunity WHERE hubspot_deal_id = ?)`. SO push binds to returned Project ID.

### Item Group line structure (per SO2454 reference)

Each accepted ASY pushes as ONE Item Group line on the SO. Item Group structure pre-configured by DPS in NetSuite:
- Group header SKU (the ASY)
- Group component children (defined on Item Group itself; multipliers default qty 1):
  - Finished SKU child (priced at customer rate from accepted tier)
  - OTC-* freight passthrough children (multiple; per freight type)
    - Ocean freight → OTC-0012 (existing)
    - Customs/duties → OTC-0036 (existing)
    - Air freight, surface freight, etc. → new SKUs to enumerate (Step 1)

Nexus's `freight_leg_groups + freight_legs` map to per-OTC-line rates. Group qty = accepted tier qty propagates uniformly to all children.

---

## §3 · Schema

### Additions to `quotes`

```sql
ALTER TABLE quotes
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN accepted_by_user_id uuid REFERENCES users(id),
  ADD COLUMN accepted_tier_id uuid REFERENCES quote_tiers(id),
  ADD COLUMN frozen boolean NOT NULL DEFAULT false,
  ADD COLUMN netsuite_so_id text,
  ADD COLUMN netsuite_so_pushed_at timestamptz,
  ADD COLUMN netsuite_so_push_status text NOT NULL DEFAULT 'not_pushed',
  ADD COLUMN netsuite_so_push_error text,
  ADD COLUMN hubspot_deal_stage_advanced_at timestamptz;

-- Enum check (or pgenum)
ALTER TABLE quotes
  ADD CONSTRAINT quotes_netsuite_so_push_status_check
    CHECK (netsuite_so_push_status IN (
      'not_pushed',     -- pre-acceptance default
      'pending',        -- acceptance triggered, push in flight
      'succeeded',      -- SO created, netsuite_so_id populated
      'failed',         -- push errored; retryable via UI
      'retrying'        -- in retry state
    ));

CREATE INDEX quotes_accepted_at_idx ON quotes (accepted_at)
  WHERE accepted_at IS NOT NULL;

CREATE UNIQUE INDEX quotes_netsuite_so_id_idx ON quotes (netsuite_so_id)
  WHERE netsuite_so_id IS NOT NULL;
```

**Versioned-table carry-forward audit:** `quotes` is versioned. CC extends the `versionedQuotesUpdate` helper (or equivalent) to carry all new columns forward. Defaults preserve pre-acceptance behavior (`frozen = false`, `netsuite_so_push_status = 'not_pushed'`).

### New table `production_recipes`

Per CA lean (a) — frozen snapshot at acceptance even though consumption is v1.1+. Banks the data shape clearly; avoids messy retrofit.

```sql
CREATE TABLE production_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by_user_id uuid NOT NULL REFERENCES users(id),
  accepted_tier_id uuid NOT NULL REFERENCES quote_tiers(id),

  -- The snapshot — full BOM tree + pricing + qty + cost state
  -- Includes: ASY/LEAF hierarchy, parent_sku_id, qty_per_parent,
  --          per-tier pricing (only for accepted tier),
  --          unit_cost, sell_price, margin, cost_stack
  snapshot_json jsonb NOT NULL,

  -- Lifecycle status
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'completed')),

  -- Future binding to CM events (banked v1.1+)
  cm_packet_generated_at timestamptz,
  cm_packet_id text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX production_recipes_quote_id_idx ON production_recipes (quote_id);
CREATE INDEX production_recipes_status_idx ON production_recipes (status);
```

**Why a table and not just an audit row:**
- Production recipes will have lifecycle (active → superseded if re-accepted; completed when production finishes). Audit rows are append-only and don't model state.
- v1.1+ consumers (CM packets, purchasing lists, reconciliation exports) query recipes; querying audit_log is the wrong access pattern.
- The snapshot_json is the contract that v1.1+ consumers depend on; lock it now even without consumers.

**snapshot_json shape** (CC implements; CA disposition):
```typescript
{
  schema_version: '1',
  quote_id: string,
  accepted_tier: {
    tier_index: number,
    qty: number,
    sell_price: number,
    margin_pct: number,
  },
  bom: {
    assemblies: Array<{
      asy_sku: string,
      asy_id: string,
      qty: number,
      children: Array<{
        leaf_sku: string,
        leaf_id: string,
        qty_per_parent: number,
        unit_cost: number,
        cost_stack: { pkg, prod, frt, dt },
      }>,
    }>,
  },
  pricing: {
    blended_margin_pct: number,
    order_value: number,
    global_price_adj_pct: number | null,
    per_tier_overrides: Array<{ tier_index, sell_price_override }>,
  },
  netsuite_push: {
    so_id: string | null,
    pushed_at: timestamp | null,
  },
}
```

---

## §4 · Server actions

### `markQuoteAccepted(quoteId, tierId, userId)`

**Atomic transaction** — all-or-nothing:
1. Validate quote is in acceptable state (not already accepted, not blocked-mode at the accepted tier — though this last check is informational, not blocking; PMs can override per business policy)
2. Update `quotes`:
   - `accepted_at = now()`
   - `accepted_by_user_id = userId`
   - `accepted_tier_id = tierId`
   - `frozen = true`
   - `netsuite_so_push_status = 'pending'`
3. Insert `production_recipes` row with full snapshot_json
4. Audit log:
   - `quote_accepted` — primary event; diff_json: `{ tier_id, accepted_by, recipe_id }`
   - `production_recipe_frozen` — secondary event with `caused_by_audit_id` linking to quote_accepted; diff_json: `{ recipe_id, snapshot_version: '1' }`
5. Enqueue async `pushQuoteToNetSuite(quoteId)` (via existing async pattern in codebase — TBD specific mechanism with CC)

**Failure mode:** if transaction fails at any step, all writes roll back; PM sees error toast. Quote remains in pre-acceptance state.

### `pushQuoteToNetSuite(quoteId)` (async)

1. Read quote + production recipe + accepted tier
2. Build RESTlet payload (see §6 RESTlet contract)
3. Call NetSuite RESTlet via authenticated HTTP request
4. On success:
   - Update `quotes.netsuite_so_id`, `quotes.netsuite_so_pushed_at`, `quotes.netsuite_so_push_status = 'succeeded'`
   - Audit: `netsuite_so_pushed`; diff_json: `{ netsuite_so_id, netsuite_project_id }`
   - Call `advanceHubSpotDealStage(quoteId)` (next step)
5. On failure:
   - Update `quotes.netsuite_so_push_status = 'failed'`, `quotes.netsuite_so_push_error = errorMessage`
   - Audit: `netsuite_so_push_failed`; diff_json: `{ error, restlet_response }`
   - PM sees retry UI; manual retry triggers `retryNetSuiteSOPush(quoteId)`

### `advanceHubSpotDealStage(quoteId)` (async)

1. Look up HubSpot deal ID from quote's project
2. Use PR #50 HubSpot client to advance deal stage to "Purchase Order"
3. On success:
   - Update `quotes.hubspot_deal_stage_advanced_at = now()`
   - Audit: `hubspot_deal_stage_advanced`; diff_json: `{ from_stage, to_stage: 'Purchase Order' }`
4. On failure:
   - Audit: `hubspot_deal_stage_advance_failed`; diff_json: `{ error }`
   - **Soft failure** — SO is already pushed; deal stage can be advanced manually if HubSpot push errors. Don't block acceptance flow.

### `retryNetSuiteSOPush(quoteId)`

1. Reset `quotes.netsuite_so_push_status = 'retrying'`, clear `netsuite_so_push_error`
2. Re-invoke `pushQuoteToNetSuite(quoteId)` flow
3. RESTlet must be idempotent — use `custbody_nexus_quote_id` to detect "SO already exists for this Nexus quote" and return existing SO ID rather than create duplicate.

---

## §5 · UI surface

### Quote umbrella "Mark Accepted" CTA

Quote umbrella canon (post-canon-revision May 2026) places Mark Accepted as a Quote sub-tab affordance. Per PR #54 Step 8 tear-down, Pricing surface no longer carries this affordance; it lives on Quote umbrella.

**Pre-acceptance state:**
- Quote umbrella renders normal scenario view + sub-tab navigation
- "Mark Accepted →" CTA visible (positioned per CD design — TBD Step 1)
- CTA disabled if quote has unresolved blockers (e.g., blocked-mode at current tier without explicit override accept-risk path)

**Acceptance flow:**

1. **Click "Mark Accepted →"** opens **AcceptedTierPickerModal**:
   - Lists all tiers with margin status + qty + order value
   - Highlights recommended tier
   - Required: PM explicitly selects which tier the customer accepted
   - No implicit auto-pick — too easy to ship wrong number

2. **Continue** opens **AcceptanceConfirmationModal** with "what happens next" preview:
   - Frozen quote summary (accepted tier, total order value, blended margin)
   - "On Confirm:" checklist:
     - ✓ Quote frozen (no further edits)
     - ✓ Production recipe snapshot created
     - ✓ SO pushed to NetSuite
     - ✓ HubSpot deal stage → Purchase Order
   - Confirm button (final commit) + Cancel (returns to pre-acceptance state)

3. **Confirm** fires `markQuoteAccepted` → atomic Nexus event → toast "Quote accepted · SO push pending"

4. **Async resolution** (poll or websocket — TBD CC):
   - On `netsuite_so_push_status = 'succeeded'`: toast "SO #SO2454 created in NetSuite"
   - On `failed`: toast "SO push failed · retry available" + retry CTA on the accepted quote

### Post-acceptance state

Quote umbrella renders read-only with:
- **Accepted badge** at header: `● ACCEPTED · SO #SO2454 · 8/6/2025`
- Scenario data still visible but inputs disabled
- Audit drawer shows: accepted_by, accepted_at, recipe_id, NetSuite push trace
- If push status = `failed` or `retrying`: error banner + retry CTA

### Retry UI

For `netsuite_so_push_status IN ('failed', 'retrying')`:
- Persistent banner on Quote umbrella: "NetSuite SO push failed: {error_message}"
- "Retry push" button → `retryNetSuiteSOPush(quoteId)`
- Manual override: "Mark SO created manually" → PM enters NetSuite SO ID directly (fallback for unrecoverable RESTlet failures); audit row `netsuite_so_id_manually_set`

### Permission gating

Per CLAUDE.md context — Jing Santos (Sales) has `can_create_leaves` only. Mark Accepted should NOT be available to sales-only users.

**TBD Step 1:** Edward confirms which users/roles can Mark Accepted (PMs only? Specific PM list? PM + admins?). Brief assumes PM-only for v1; permission column likely `can_mark_accepted` (boolean per user) following existing pattern.

---

## §6 · External integrations

### NetSuite Custom RESTlet (Edward + DPS NetSuite admin builds)

**Endpoint:** TBD URL during Step 1 contract iteration

**Authentication:** TBD (token-based auth most likely; CC + Aisha + Edward iterate)

**Request payload** (CA proposed shape; CC iterates with Aisha during Step 1):
```json
{
  "nexus_quote_id": "uuid",
  "hubspot_deal_id": "string",
  "accepted_tier": {
    "qty": 15000,
    "ship_date": "2026-08-01"
  },
  "assemblies": [
    {
      "asy_sku": "TCS-BAR-01 DRSQ Bar Soap Travel Case w/UC",
      "qty": 15000,
      "components": [
        {
          "component_sku": "TCS-BAR-01",
          "rate": 1.2731,
          "amount": 19096.50
        },
        {
          "component_sku": "OTC-0012",
          "rate": 0.5264,
          "amount": 7896.00
        },
        {
          "component_sku": "OTC-0036",
          "rate": 0.4195,
          "amount": 6292.50
        }
      ]
    }
  ]
}
```

**RESTlet responsibilities (server-side):**
1. **Idempotency check:** query for existing SO where `custbody_nexus_quote_id = nexus_quote_id`. If exists, return that SO ID without creating new.
2. **Customer resolution:** look up NetSuite Customer via HubSpot Company sync mapping (Associated Company → Customer).
3. **Project resolution:** look up NetSuite Project where `main_opportunity_id = hubspot_deal_id` (via Opportunity sync).
4. **Validation:** verify all SKUs exist in NetSuite (Item or Item Group lookup); fail loudly with specific SKU codes if missing.
5. **SO creation:** create Sales Order with Customer + Project + Item Group line + `custbody_nexus_quote_id`.
6. **Response shape:**
   ```json
   {
     "ok": true,
     "netsuite_so_id": "SO2454",
     "netsuite_project_id": "internal_project_id",
     "warnings": []
   }
   ```
   Or:
   ```json
   {
     "ok": false,
     "error_code": "SKU_NOT_FOUND",
     "error_message": "OTC-9999 not found in NetSuite",
     "context": { "failed_sku": "OTC-9999" }
   }
   ```

### Required NetSuite-side preparation (Edward + DPS NetSuite admin)

Pre-merge tasks owned by Edward / DPS NetSuite admin (NOT CC):

1. **Build RESTlet endpoint** per agreed contract
2. **Create custom field on Sales Order:**
   - Internal ID: `custbody_nexus_quote_id`
   - Type: text
   - Display name: "Nexus Quote ID"
   - Indexed/searchable for idempotency lookup
3. **Enumerate + create new OTC-* SKUs** (Step 1):
   - Existing: OTC-0012 (Ocean freight), OTC-0036 (Customs/duties)
   - Need to enumerate: which freight types in Nexus's `freight_leg_groups` need new OTC-* SKUs (air freight, surface freight, warehouse, etc.)
   - Create as Non-Inventory Resale Items
4. **Disable existing PO-creation trigger** at slice merge (hard cutover):
   - Identify current automation (HubSpot workflow? NetSuite scripted record? Third-party tool?)
   - Coordinate with whoever owns it
   - Disable simultaneously with slice merge

### HubSpot deal stage advancement (PR #50 client)

Use existing HubSpot client infrastructure from PR #50. Server action:
```typescript
await hubspotClient.deals.update(deal.id, {
  properties: {
    dealstage: 'Purchase Order' // or stage internal ID
  }
});
```

Stage internal ID looked up at Step 1 from HubSpot pipeline config (Image 7 from CB context shows "Purchase Order" stage exists in DPS's HubSpot pipeline).

---

## §7 · Audit chain

Following Slice 9.2 audit-source namespace conventions:

| Action | Entity | diff_json | caused_by_audit_id |
|---|---|---|---|
| `quote_accepted` | quote | `{ tier_id, accepted_by, recipe_id }` | NULL (primary event) |
| `production_recipe_frozen` | production_recipe | `{ recipe_id, snapshot_version }` | quote_accepted audit ID |
| `netsuite_so_pushed` | quote | `{ netsuite_so_id, netsuite_project_id }` | quote_accepted audit ID |
| `netsuite_so_push_failed` | quote | `{ error, restlet_response }` | quote_accepted audit ID |
| `hubspot_deal_stage_advanced` | quote | `{ from_stage, to_stage }` | quote_accepted audit ID |
| `hubspot_deal_stage_advance_failed` | quote | `{ error }` | quote_accepted audit ID |
| `netsuite_so_id_manually_set` | quote | `{ netsuite_so_id, set_by }` | NULL (manual fallback) |

**Cascade discipline:** every async follow-up audit row carries `caused_by_audit_id` linking back to the primary `quote_accepted` event. PMs can trace the full acceptance cascade from one anchor.

---

## §8 · Edge cases + error handling

| Edge case | Handling |
|---|---|
| **SO push fails mid-acceptance** | Quote stays accepted + frozen + recipe created. `netsuite_so_push_status = 'failed'`. Retry UI surfaces. PM can retry or manually set SO ID as fallback. |
| **Customer not in NetSuite (sync failure)** | RESTlet returns `CUSTOMER_NOT_FOUND` error. PM sees: "Customer not synced to NetSuite. Verify HubSpot Company is set on this deal and synced." Manual NetSuite Customer ID entry as fallback (TBD whether v1 supports — CA lean: bank v1.1+, error surface only in v1). |
| **Project not found (no NetSuite Project for HubSpot deal)** | RESTlet returns `PROJECT_NOT_FOUND` error. PM creates NetSuite Project manually, then retries. |
| **HubSpot deal stage advance fails** | SO push succeeded; this is a soft failure. Audit row recorded; PM can manually advance HubSpot stage. Doesn't block acceptance flow. |
| **Idempotency on retry** | RESTlet checks `custbody_nexus_quote_id` before creating; returns existing SO ID if found. Nexus also guards: only allow push if `netsuite_so_push_status NOT IN ('succeeded')`. |
| **Concurrent PM edits** | Quote acceptance is atomic; once `frozen = true`, all edit endpoints reject. Concurrent acceptance attempts: second one fails on `accepted_at IS NOT NULL` check. |
| **Sell price below floor at accepted tier** | Per business policy — PMs CAN accept below-floor with explicit override accept-risk (existing pattern from classifier). Mark Accepted respects classifier's accept-risk gate. If `state.flags.accept_risk_unavailable === true`, Mark Accepted CTA disabled with explainer. |
| **Quote has provisional cells (missing raws)** | Same as classifier — disable Mark Accepted CTA with explainer "N cells awaiting raws · margin unknown · enter cost data before accepting." |
| **Production recipe snapshot too large for jsonb** | jsonb practical limit is ~1GB; realistic quote snapshots are KB-MB range. Not a v1 concern. |
| **Network failure between Nexus and NetSuite** | Standard retry semantics; configurable timeout (CA lean: 30s); failure → `failed` status + retry UI. |

---

## §9 · Cutover plan (hard cutover at slice merge)

**Pre-merge tasks (Edward owns):**
1. Identify the existing PO-creation trigger (HubSpot workflow? NetSuite scripted record? Third-party automation?)
2. Coordinate with whoever maintains it
3. Confirm sunset date = slice merge date
4. Communicate to PMs: "On {date}, mark-accepted flow moves to Nexus. Old flow disabled. New flow: Quote umbrella → Mark Accepted."

**Merge day:**
1. Slice 12 PR merges
2. Old PO-creation trigger disabled (Edward executes)
3. PMs use Nexus Mark Accepted for new quotes
4. Backlog quotes (in-flight pre-merge) finish on old flow — they're already past the PO-creation moment

**Post-merge monitoring (Week 1):**
- Check NetSuite SO creation rate matches expected acceptance volume
- Check `netsuite_so_push_status = 'failed'` rate
- PM feedback on UI flow
- HubSpot deal stage advancement working as expected

**Rollback plan:** If catastrophic failure, re-enable old PO trigger; Nexus Mark Accepted continues working for quote freezing + recipe creation but skips SO push (status = 'manual' fallback). Avoids data loss; SO can be created manually.

---

## §10 · Verification surfaces

### Predicate-layer verification (CC self-tests pre-PR)

1. Quote state machine — pre/post acceptance, frozen flag transitions
2. Production recipe snapshot schema validation
3. RESTlet payload construction from accepted quote + tier
4. Audit chain integrity (cascade with caused_by_audit_id)
5. Permission gating (markQuoteAccepted rejects non-PM users)

### Browser smoke walks (CB after CC ships)

Scenarios (suggested — CC + CA iterate during Step 1):
- **MA-1:** Vanilla accept (clean quote, single ASY, single tier accepted, push succeeds)
- **MA-2:** Accept with multiple ASYs in quote, each becomes Item Group line on SO
- **MA-3:** Accept-with-retry (force RESTlet failure → retry → succeed)
- **MA-4:** Accept on quote with override accept-risk path (below floor + admin override)
- **MA-5:** Accept blocked because provisional cells exist (CTA disabled with explainer)
- **MA-6:** Accept blocked because already accepted (idempotency)
- **MA-7:** Post-acceptance read-only state — verify all input surfaces disabled
- **MA-8:** Retry UI exercise — failed push → retry → succeed
- **MA-9:** Manual SO ID fallback — enter SO ID directly when RESTlet permanently fails
- **MA-10:** HubSpot deal stage advancement verification (DB write + HubSpot deal stage matches)

### NetSuite-side verification (Edward + CC)

- SO created with correct Customer + Project bindings
- Item Group line structure correct (group + components + rates)
- `custbody_nexus_quote_id` populated
- Subtotal matches expected (quantity × rate per child line summed)
- Native sync propagates PP/SP/SGA/COP fields without Nexus involvement

### HubSpot-side verification (CC)

- Deal stage advanced to "Purchase Order"
- `hubspot_deal_stage_advanced_at` written
- Other deal fields untouched by Nexus

### Audit chain SQL verification (CC)

```sql
SELECT action, entity_type, entity_id,
       diff_json, caused_by_audit_id, created_at
  FROM audit_log
 WHERE entity_id = '<accepted_quote_id>'
    OR caused_by_audit_id IN (
      SELECT id FROM audit_log
       WHERE entity_id = '<accepted_quote_id>'
         AND action = 'quote_accepted'
    )
 ORDER BY created_at ASC;
```

Expected cascade:
1. `quote_accepted` (primary, caused_by_audit_id = NULL)
2. `production_recipe_frozen` (caused_by = #1)
3. `netsuite_so_pushed` (caused_by = #1)
4. `hubspot_deal_stage_advanced` (caused_by = #1)

---

## §11 · Out of scope / banked v1.1+

- **Production recipe consumption** — CM packets, purchasing lists, reconciliation exports. v1 freezes the snapshot; v1.1+ adds consumers.
- **`custbody_nexus_recipe_id` on NetSuite SO** — only useful once consumption ships
- **Webhook subscription for SO lifecycle events** — Booked → Billed → Fulfilled → Closed visibility in Quote umbrella. v1.1+ "post-acceptance status visibility" enhancement
- **Mark "unaccepted" / undo** — not supported v1. If business changes after acceptance, create new quote and mark old as superseded. Per CLAUDE.md banked learning.
- **Multi-tier acceptance on one quote** — v1 supports one tier per acceptance event. Multi-tier per single SO is rare (usually customer accepts one tier).
- **Real-time NetSuite SO status sync** — v1 is push-only. Webhook subscription banked v1.1+.
- **Customer / Project create-if-missing** — v1 fails loudly; v1.1+ could automate creation if business demand surfaces.

---

## §12 · Step 1 discovery TBDs (not brief blockers)

| # | TBD | Owner | Resolution timeline |
|---|---|---|---|
| 1 | RESTlet payload contract specifics | CC + Aisha + Edward | Step 1 |
| 2 | NetSuite RESTlet authentication mechanism | CC + Aisha | Step 1 |
| 3 | Complete OTC-* SKU enumeration | Edward + DPS NetSuite admin | Step 1 |
| 4 | Existing PO-creation trigger identification + sunset coordination | Edward | Step 1 |
| 5 | "Purchase Order" stage internal ID in HubSpot | Edward | Step 1 |
| 6 | Permission gating model (which users can Mark Accepted) | Edward | Step 1 |
| 7 | Confirmation modal copy + visual treatment | CD | Step 1 (Pattern 30 prototype) |
| 8 | Async push mechanism (polling vs websocket vs queue) | CC | Step 1 |
| 9 | Manual NetSuite Customer ID fallback (v1 or v1.1+?) | Edward + CA | Step 1 |
| 10 | NetSuite Customer record requirements (does Customer need to pre-exist always?) | Edward | Step 1 |

---

## §13 · Pattern 22 §0.5 pre-build verification checklist (CC owns)

Per standing protocol — CC runs §0.5 verification BEFORE Edward + CA approve. Surface findings before any schema work or implementation begins.

### Schema verification

- [ ] Verify `quotes` table is versioned (per CLAUDE.md "Versioned-table carry-forward audit" pattern) — if so, `versionedQuotesUpdate` helper exists and needs extension
- [ ] Verify `production_recipes` doesn't collide with existing table names
- [ ] Verify `audit_log` schema supports `caused_by_audit_id` (cascade lineage)
- [ ] Verify `users` table has the permission column pattern (likely `can_*` boolean per existing `can_create_leaves` model)
- [ ] Verify `quote_tiers` table has the fields needed for snapshot (sell_price, margin, tier_index, qty)
- [ ] Verify `freight_legs + freight_leg_groups` schema to confirm OTC-* mapping approach

### Architectural verification

- [ ] Verify PR #50 HubSpot client supports `deals.update` with stage advancement (or identify which method does)
- [ ] Verify async pattern in codebase (background jobs? Vercel functions? edge runtime?) for `pushQuoteToNetSuite` invocation
- [ ] Verify CostingStore + classifier output is enough to construct snapshot_json, OR identify if additional read paths needed
- [ ] Verify quote umbrella sub-tab IA — where exactly does Mark Accepted live?

### Cross-surface verification

- [ ] Verify `frozen = true` flag is respected by ALL existing quote-edit surfaces (Setup, Costs, Pricing) — frozen quotes can't be re-priced
- [ ] Verify PR #54's classifier handles `frozen = true` state (likely renders read-only; CC verifies or surfaces)
- [ ] Verify PR #54's accept-risk path (Mark Accepted respects `state.flags.accept_risk_unavailable`)

### Integration verification

- [ ] Verify NetSuite RESTlet endpoint exists OR confirm Edward's commitment to building one before CC Step 2
- [ ] Verify HubSpot pipeline "Purchase Order" stage internal ID is retrievable
- [ ] Verify native sync handles all PP/SP/SGA/COP fields (zero Nexus side work needed)

### Brief drift surfacing

Any architectural assumption in this brief that doesn't match production reality → CC surfaces in §0.5 report BEFORE implementation begins. Per pattern: 2 BLOCKER-class catches in PR #54 saved estimated step-cycles of rework.

Surface findings → CA + Edward disposition → brief amendments → CC proceeds to Step 1.

---

## §14 · Open questions for CC discussion before kickoff

1. **Snapshot timing precision.** `production_recipe.frozen_at` vs `quote_accepted.created_at` — should they be exactly equal? Within same transaction? Or async (recipe frozen as side effect)? CA lean: same transaction, identical timestamp. Confirms acceptance moment is atomic.

2. **Retry exponential backoff?** For automatic retries (not manual). CA lean: NO automatic retries v1. Single push attempt; failure → PM retries manually. Simpler error semantics; avoids hidden state.

3. **Mark Accepted CTA placement on Quote umbrella.** Per R7a IA grammar + Quote umbrella canon revision May 2026 — CD design needed. Step 1 Pattern 30 prototype delivers.

4. **Toast/notification timing for async push.** CA lean: optimistic toast ("Accepted! Pushing to NetSuite...") + secondary toast on async resolution ("SO #SO2454 created" or "Push failed — retry?"). UX pattern TBD with CD.

5. **Production recipe entity name** — `production_recipes` is CA proposed. CC may prefer `accepted_quote_snapshots` or `production_orders` or similar. Match existing codebase conventions.

---

## §15 · Slice plan (preliminary — CC iterates)

Suggested 8-step structure (mirrors PR #54 cadence):

1. **Step 1 — Kickoff + §0.5 verification + Step 1 TBD resolution** (CC self-contained doc + CD prototype handoff)
2. **Step 2 — Schema migration** (quotes additions + production_recipes table + versioned-table carry-forward helper extension)
3. **Step 3 — Server actions** (markQuoteAccepted + production recipe snapshot builder + invariant verification)
4. **Step 4 — NetSuite RESTlet integration** (pushQuoteToNetSuite + retry path + idempotency + error handling)
5. **Step 5 — HubSpot deal stage advancement** (advanceHubSpotDealStage via PR #50 client)
6. **Step 6 — UI: AcceptedTierPickerModal + AcceptanceConfirmationModal + post-acceptance state**
7. **Step 7 — UI: Retry UI + manual SO ID fallback + audit drawer integration**
8. **Step 8 — Cutover coordination + smoke guide + slice fold + PR open**

CC iterates plan based on §0.5 findings + Step 1 TBD resolutions.

---

## §16 · Architectural commitments locked

For the slice-fold doc + future v1.1+ reference:

- **Acceptance is atomic Nexus event.** Quote frozen + recipe created in single transaction. NetSuite + HubSpot follow-ups are async, decoupled.
- **§3 source-of-truth invariant** (from PR #54) extends to acceptance state. `frozen` + `accepted_*` fields are classifier inputs; no parallel derivation.
- **Production recipe entity** owns the CM-facing artifact contract. NetSuite SO owns the customer/finance artifact. Two different consumers, two different durable records, one acceptance event creates both.
- **Hard cutover model** — replacing existing business process at slice merge; no parallel-run.
- **Lean on native HubSpot ↔ NetSuite sync** — Nexus does NOT dual-write for fields that sync handles. Only Nexus-authored field is `custbody_nexus_quote_id`.
- **Idempotency at RESTlet** — `custbody_nexus_quote_id` is the canonical idempotency key; RESTlet checks before creating; Nexus retries are safe.

---

**End of brief.** CC reads + executes §0.5 verification + surfaces findings before Step 2 schema work. CD handoff for AcceptedTierPickerModal + AcceptanceConfirmationModal during Step 1. CA standing by for dispositions on §0.5 findings.

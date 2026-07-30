# slice-mark-accepted-netsuite-so-push — Brief AMENDMENTS v2

**Brief baseline:** v1 (cc-comm-mark-accepted-netsuite-so-push-brief.md)
**Amendment driver:** Edward's review surfaced 8 architectural improvements
**Status:** Architecture approved; implementation blocked pending Step 1 resolution of 4 gates
**Date:** 2026-06-16

This document amends the v1 brief. CC reads v1 + v2 as the canonical
brief set. Section numbers reference v1 sections.

---

## Amendment 1 · §2 Triangulation — concrete IDs in payload (Critique #1)

**v1 (subordinate):** Customer/Project resolution via triangulation through native sync
**v2 (supersedes):** Concrete IDs passed when known; triangulation as fallback

Native sync has visible failure rates per Image 1 sync config:
- 83 failing Companies (of 4,498)
- 79 failing Contacts (of 7,416)
- 30 failing Inventory Items, 12 failing Non-Inventory Resale

Relying on RESTlet to triangulate when sync may have failed is brittle.
Payload includes all available IDs; RESTlet prefers concrete when present,
triangulates as fallback.

Revised payload includes:
- `nexus_quote_id` (v1, unchanged)
- `hubspot_deal_id` (v1, unchanged)
- **`hubspot_company_id`** (NEW) — from project.hubspot_deal_id → Associated Company
- **`netsuite_customer_id`** (NEW, optional, nullable v1) — Nexus stores from RESTlet response capture starting v1.1+
- **`netsuite_project_id`** (NEW, optional, nullable v1) — same pattern

RESTlet logic priority order for Customer:
1. If `netsuite_customer_id` present → use directly
2. Else if `hubspot_company_id` present → lookup via Company sync mapping
3. Else if `hubspot_deal_id` present → triangulate via Deal → Associated Company → Customer
4. Else fail with `CUSTOMER_RESOLUTION_FAILED`

Same priority pattern for Project lookup chain.

**v1.1+ banked enhancement:** RESTlet response returns resolved NetSuite IDs;
Nexus captures and stores them on `projects` table for subsequent quotes on
the same project. Reduces triangulation dependency over time.

---

## Amendment 2 · §1 Framing precision (Critique #2)

**v1 framing:** "HubSpot owns deal stage source-of-truth"
**v2 framing:** **"HubSpot owns sales pipeline stage display; Nexus owns acceptance event."**

These are different concerns:
- HubSpot displays sales pipeline state to sales team; stage value propagates via native sync
- Nexus is the canonical authoring system for the acceptance event; the `quote_accepted` audit row is the authoritative business-event record
- HubSpot stage advancement is a downstream side-effect for sales visibility, not an authority claim

This precision matters because:
- If HubSpot stage advance fails, the acceptance EVENT is still canonical (in Nexus audit log + production recipe + NetSuite SO)
- Nexus + NetSuite proceed without HubSpot dependency; HubSpot stage is remediated separately
- Aligns ownership boundaries cleanly with the three-leg model

§7 audit chain unchanged; `quote_accepted` remains the primary event.

---

## Amendment 3 · §3 Schema — separate status enums (Critique #3)

**v1 had:** Single `netsuite_so_push_status` enum + HubSpot tracked only by timestamp + audit
**v2 has:** Two independent status enums + new states

```sql
-- Modified ALTER TABLE quotes (supersedes v1's version)
ALTER TABLE quotes
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN accepted_by_user_id uuid REFERENCES users(id),
  ADD COLUMN accepted_tier_id uuid REFERENCES quote_tiers(id),
  ADD COLUMN frozen boolean NOT NULL DEFAULT false,

  -- NetSuite SO push tracking
  ADD COLUMN netsuite_so_id text,
  ADD COLUMN netsuite_so_pushed_at timestamptz,
  ADD COLUMN netsuite_so_push_status text NOT NULL DEFAULT 'not_pushed',
  ADD COLUMN netsuite_so_push_error text,

  -- NEW: Manual SO fallback tracking (per Critique #4)
  ADD COLUMN netsuite_so_id_source text DEFAULT 'restlet',  -- 'restlet' | 'manual'
  ADD COLUMN manual_so_validated_at timestamptz,
  ADD COLUMN manual_so_reason text,

  -- NEW: HubSpot stage advancement (separate from SO push)
  ADD COLUMN hubspot_stage_status text NOT NULL DEFAULT 'not_advanced',
  ADD COLUMN hubspot_stage_advanced_at timestamptz,
  ADD COLUMN hubspot_stage_error text;

-- Two status enums
ALTER TABLE quotes
  ADD CONSTRAINT quotes_netsuite_so_push_status_check
    CHECK (netsuite_so_push_status IN (
      'not_pushed', 'pending', 'succeeded', 'failed', 'retrying', 'manual'
    )),
  ADD CONSTRAINT quotes_hubspot_stage_status_check
    CHECK (hubspot_stage_status IN (
      'not_advanced', 'pending', 'succeeded', 'failed', 'retrying', 'skipped'
    )),
  ADD CONSTRAINT quotes_netsuite_so_id_source_check
    CHECK (netsuite_so_id_source IN ('restlet', 'manual'));
```

State semantics:

**NetSuite SO push:**
| State | Meaning |
|---|---|
| `not_pushed` | Pre-acceptance default |
| `pending` | Push in flight |
| `succeeded` | SO created via RESTlet |
| `failed` | RESTlet errored; retryable |
| `retrying` | Active retry attempt |
| `manual` | PM entered SO ID; validated against NetSuite |

**HubSpot stage advancement:**
| State | Meaning |
|---|---|
| `not_advanced` | Pre-acceptance default |
| `pending` | Advance in flight |
| `succeeded` | Stage updated to "Purchase Order" |
| `failed` | HubSpot client errored; retryable |
| `retrying` | Active retry attempt |
| `skipped` | Explicitly skipped (rare; admin override) |

Each tracked independently; UI surfaces remediation per status.

---

## Amendment 4 · §5+§6 Manual SO fallback validation (Critique #4)

**v1 had:** PM enters SO ID directly; no validation
**v2 has:** PM enters SO ID → RESTlet validates + patches `custbody_nexus_quote_id`

**Why this matters:** Without validation, PM could enter wrong SO ID, OR if
RESTlet later succeeds asynchronously (transient failure resolved), we'd
have two SOs for the same quote.

**Validation flow:**

1. PM clicks "Manual SO ID fallback" in retry UI
2. PM enters SO ID + reason (text field)
3. Nexus calls new RESTlet method: `validateAndBindManualSO(nexus_quote_id, netsuite_so_id)`
4. RESTlet:
   - Verifies SO with that ID exists in NetSuite
   - Checks SO's `custbody_nexus_quote_id` value:
     - If empty → patches to `nexus_quote_id` (binds the SO)
     - If matches `nexus_quote_id` → already bound; success
     - If matches different quote_id → returns `SO_ALREADY_BOUND_TO_DIFFERENT_QUOTE` error
   - Returns updated SO ID + status
5. Nexus writes:
   - `netsuite_so_id = entered_so_id`
   - `netsuite_so_id_source = 'manual'`
   - `manual_so_validated_at = now()`
   - `manual_so_reason = entered_reason`
   - `netsuite_so_push_status = 'manual'`
6. Audit: `netsuite_so_id_manually_set` with diff_json: `{ netsuite_so_id, source: 'manual', reason }`

**Subsequent retry safety:** Any future `retryNetSuiteSOPush(quoteId)` checks
`netsuite_so_push_status = 'manual'` first; if matched, no-op (manual binding
is authoritative; retry would create duplicate).

---

## Amendment 5 · §3 Schema — freeze + snapshot version reference (Critique #5)

**v1 had:** `frozen = true` flag; production_recipes carries snapshot
**v2 has:** Snapshot references exact quote `version_number` for immutable anchor

`quotes.version_number` column already exists (surfaced as schema edge catch
#11 during PR #54 BUG-E investigation: INTEGER NOT NULL without default).

Extend `production_recipes` to reference the exact snapshot version:

```sql
-- Modified production_recipes (supersedes v1's version)
CREATE TABLE production_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id),

  -- NEW: snapshot version anchor (per Critique #5)
  snapshot_quote_version_number integer NOT NULL,

  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by_user_id uuid NOT NULL REFERENCES users(id),
  accepted_tier_id uuid NOT NULL REFERENCES quote_tiers(id),
  snapshot_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'completed')),
  cm_packet_generated_at timestamptz,
  cm_packet_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX production_recipes_quote_id_idx ON production_recipes (quote_id);
CREATE INDEX production_recipes_version_idx ON production_recipes (quote_id, snapshot_quote_version_number);
CREATE INDEX production_recipes_status_idx ON production_recipes (status);
```

**Snapshot integrity check** (CC implements in recipe builder):
- At freeze time: read quote `version_number`, capture as `snapshot_quote_version_number`
- snapshot_json must consistently reflect that version's state
- If `quotes.version_number != production_recipes.snapshot_quote_version_number` at any later read, surface as data integrity warning

**Why this protects:** If someone (admin override edge case) mutates a frozen
quote, `version_number` bumps. Discrepancy with the recipe's
`snapshot_quote_version_number` becomes detectable; integrity check fires.
Without this, mutation-after-freeze could silently divorce the live quote
from the production-time snapshot.

**snapshot_json shape extension** — add the version anchor at the top:

```typescript
{
  schema_version: '1',
  quote_id: string,
  snapshot_quote_version_number: number,  // NEW: anchor
  // ... rest as v1 brief
}
```

---

## Amendment 6 · §6 RESTlet payload — line-level Nexus IDs (Critique #6)

**v1 had:** SKU codes + rates per line; no Nexus IDs
**v2 has:** Every line carries its Nexus-side ID for error mapping

Revised payload shape:

```json
{
  "nexus_quote_id": "uuid",
  "snapshot_quote_version_number": 42,
  "hubspot_deal_id": "string",
  "hubspot_company_id": "string",
  "netsuite_customer_id": null,
  "netsuite_project_id": null,
  "accepted_tier": {
    "nexus_tier_id": "uuid",
    "qty": 15000,
    "ship_date": "2026-08-01"
  },
  "assemblies": [
    {
      "nexus_assembly_id": "uuid",
      "asy_sku": "TCS-BAR-01 DRSQ Bar Soap Travel Case w/UC",
      "qty": 15000,
      "components": [
        {
          "nexus_leaf_id": "uuid",
          "component_sku": "TCS-BAR-01",
          "component_type": "finished_sku",
          "rate": 1.2731,
          "amount": 19096.50
        },
        {
          "nexus_freight_leg_id": "uuid",
          "component_sku": "OTC-0012",
          "component_type": "freight_passthrough",
          "rate": 0.5264,
          "amount": 7896.00
        },
        {
          "nexus_freight_leg_id": "uuid",
          "component_sku": "OTC-0036",
          "component_type": "freight_passthrough",
          "rate": 0.4195,
          "amount": 6292.50
        }
      ]
    }
  ]
}
```

**Error response shape extended:**

```json
{
  "ok": false,
  "error_code": "SKU_NOT_FOUND",
  "error_message": "OTC-9999 not found in NetSuite",
  "context": {
    "failed_sku": "OTC-9999",
    "nexus_line_id": "uuid-of-the-freight-leg",
    "line_type": "freight_passthrough",
    "nexus_assembly_id": "uuid-of-the-parent-assembly"
  }
}
```

Nexus UI maps `nexus_line_id` back to the offending line and highlights it
in the failed-push retry surface. PM sees exactly which line caused the
failure without guessing.

---

## Amendment 7 · §9 Cutover — Sandbox Validation Phase as merge gate (Critique #7)

**v1 had:** Verification surfaces; no explicit sandbox gate
**v2 has:** Sandbox Validation Phase as MANDATORY pre-merge gate

Added as **§9.5 (new section)**:

### §9.5 · Sandbox Validation Phase (MERGE GATE)

Required before slice merge. Cutover is hard; sandbox proof is the safety net.

**Phase setup (Edward + DPS NetSuite admin + Aisha):**
1. NetSuite sandbox environment available
2. Custom RESTlet built per finalized v2 contract in sandbox
3. Required SO custom field `custbody_nexus_quote_id` created in sandbox
4. All required OTC-* SKUs enumerated + created in sandbox (Step 1 deliverable)
5. Nexus dev environment can point at sandbox RESTlet URL (env var or feature flag)

**Test plan:**

| # | Scenario | Verification |
|---|---|---|
| SV-1 | Happy path push (representative quote) | SO created; Customer/Project bound correctly; Item Group line structure correct; `custbody_nexus_quote_id` populated |
| SV-2 | Idempotency: re-push same quote | RESTlet returns existing SO ID; NO duplicate SO created in sandbox |
| SV-3 | Customer resolution: concrete `netsuite_customer_id` | RESTlet uses ID directly (skip triangulation) |
| SV-4 | Customer resolution: triangulation via `hubspot_company_id` | RESTlet resolves correctly via Company sync mapping |
| SV-5 | Customer resolution: full triangulation via `hubspot_deal_id` | RESTlet resolves correctly via Deal → Company chain |
| SV-6 | Project resolution: similar 3 paths | All paths resolve correctly |
| SV-7 | SKU not found (intentionally bad component_sku) | Error response with correct `nexus_line_id` + `failed_sku` |
| SV-8 | Customer not found (no matching Company) | Error response `CUSTOMER_RESOLUTION_FAILED` |
| SV-9 | Project not found (no Project for Deal) | Error response `PROJECT_NOT_FOUND` |
| SV-10 | Manual SO validation: valid SO, empty custom field | RESTlet patches custom field; returns success |
| SV-11 | Manual SO validation: SO already bound to different quote | Returns `SO_ALREADY_BOUND_TO_DIFFERENT_QUOTE` error |
| SV-12 | Network failure simulation | Nexus marks `failed`; PM retry succeeds |
| SV-13 | Line-level error mapping | Nexus UI correctly highlights offending line from `nexus_line_id` |

**Sign-off requirement:**
- Edward + Aisha review sandbox results
- Edward signs off on cutover authorization
- ONLY after sign-off can the slice merge proceed
- Sign-off is documented in PR description

**What this protects against:**
- Wrong NetSuite Customer binding (silent reconciliation pain weeks later)
- Duplicate SO creation if idempotency fails
- Production SO creation with malformed Item Group structure
- Errors that can't be debugged because Nexus didn't get enough context back

---

## Amendment 8 · §11 Out of scope — minor additions

Added to v1 §11 banked list:
- **`projects.netsuite_customer_id` + `projects.netsuite_project_id` capture** — v1.1+ enhancement to reduce triangulation dependency; capture from first successful RESTlet response, reuse on subsequent quotes
- **Schema integrity check daemon** for `production_recipes.snapshot_quote_version_number` vs current `quotes.version_number` — surface drift over time (per Critique #5)
- **Manual remediation UI for HubSpot stage advancement** — separate from SO retry UI; surfaces when `hubspot_stage_status = 'failed'` (per Critique #3)

---

## Amendment 9 · §12 Step 1 TBDs — implementation blockers

Per Edward's recommendation: **architecture approved, implementation blocked
until Step 1 resolves 4 gates.**

The 4 implementation blockers (must close before Step 2 schema work):

1. **Identity mapping payload contract** (per Critique #1)
   - RESTlet handles all 3 customer/project resolution priorities correctly
   - Test data covers all 3 paths

2. **RESTlet contract specifics** (per Critiques #4, #6)
   - Manual SO validation endpoint defined
   - Line-level Nexus IDs in payload + error responses
   - Error code taxonomy enumerated

3. **Idempotency mechanism** (per Critiques #4, #6)
   - `custbody_nexus_quote_id` as primary key
   - Manual SO validation patches the custom field
   - Retry safety verified (no duplicate creation on retry-after-success edge case)

4. **Sandbox validation phase** (per Critique #7)
   - Sandbox RESTlet built
   - All 13 SV test scenarios pass
   - Edward + Aisha sign-off documented

Remaining Step 1 TBDs (non-blocking — can resolve during implementation):
- Complete OTC-* SKU enumeration (Edward + DPS NetSuite admin)
- Existing PO-creation trigger identification + sunset coordination (Edward)
- Permission gating model (Edward)
- Confirmation modal copy (CD)
- Async push mechanism (CC investigates codebase)

---

## Summary of changes

| # | Critique | Brief impact |
|---|---|---|
| 1 | Concrete IDs in payload | §6 RESTlet contract + §3 schema (optional NetSuite ID columns banked v1.1+) |
| 2 | Framing precision | §1 + §2 reframed: HubSpot owns display, Nexus owns event |
| 3 | Status model split | §3 schema: two enums + new states (manual, skipped) |
| 4 | Manual SO idempotency | §3 schema (3 new columns) + §5 UI flow + §6 RESTlet validation endpoint |
| 5 | Freeze + snapshot version | §3 production_recipes references version_number; snapshot_json carries version anchor |
| 6 | Line-level Nexus IDs | §6 RESTlet payload + error response shape |
| 7 | Sandbox validation gate | NEW §9.5 — mandatory pre-merge gate |
| 8 | Production recipe table | Confirmed kept; no change |

§0.5 §0.5 pre-build verification checklist (v1 §13) extended:
- Verify `quotes.version_number` column behavior (per Critique #5)
- Verify async pattern supports separate HubSpot vs NetSuite status tracking
- Verify HubSpot client (PR #50) supports stage advancement with proper status returns
- Verify sandbox environment access for SV phase

---

**Action:** CC reads v1 brief + v2 amendments. Step 1 kickoff after PR #54
merges. Step 2 schema work blocked until 4 implementation gates close
(identity mapping + RESTlet contract + idempotency + sandbox validation).

Standing by for CC Step 1 kickoff post PR #54 merge.

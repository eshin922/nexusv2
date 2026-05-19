# Architect §0.5 Verification — Phase A.1 v2 Schema

**Slice:** Phase A.1 v2 — ASY/LEAF/library spec model
**Inputs:** `docs/cc-phase-a1-v2-impl-brief.md`, `docs/cd-quote-workflow-recalibration-brief.md`, `docs/design-prototypes/dist/docs/qw_cd-quote-workflow-a1-v2-designer-notes.md`, `docs/design-prototypes/dist/docs/qw_cd-quote-workflow-a1-v2-data-source-map.md`
**Canonical schema source:** `src/db/schema.ts` (current as of 2026-05-19)
**Latest migration:** `drizzle/0029_pricing_events_table.sql`

---

## Summary

- **5 gates resolved** with concrete DDL + decisions ready for impl-1.
- **Two material deviations from the brief** require CA brief amendments before impl-1 opens:
  1. **Phantom `scenarios` table reference.** Brief §3.2 + data-source map line 217 reference `references scenarios on delete cascade` on `assemblies.scenario_id`. No `scenarios` table exists. Per `src/db/schema.ts:1398-1404` + CLAUDE.md Pattern 22 instance #1 (RI.9 step 0), scenarios are denormalized onto `quotes` (`scenario_label` / `scenario_status` / `version_number`). **Resolution:** key `assemblies` on `quote_id`, not `scenario_id`. Pattern matches `bulk_raw_section_meta` (`schema.ts:1267-1269` explicitly banks this).
  2. **Postgres RLS architecture mismatch.** Brief §3.8 + data-source map propose `create policy ... auth.user_has_permission(flag)`. Per CLAUDE.md "RLS-off latent dependency" + `src/lib/admin-guard.ts`, **RLS is OFF across the entire codebase**; access control is Clerk + page/action layer. Implementing actual Postgres RLS policies is a v2-class architectural shift (requires Clerk-Supabase JWT bridge, RLS-realtime delivery compat). **Resolution:** Gate 5 path B — flags-on-users + action-layer guards, matching the established `requireAdminAction` / `requireAdminPage` pattern.
- **Additional brief gaps caught** (smaller — patched inline below, not requiring brief re-approval):
  - `assemblies.scenario_id` typo as noted above
  - `audit_log` column names — brief assumes `actor_type` / `actor_name` / `target_type` / `target_id`; actual columns are `user_id` / `entity_type` / `entity_id` (`schema.ts:1146-1158`). Export shape must map.
  - `leaves.current_version` referenced in data-source map (lines 68, 141, 165) — does NOT exist as a column; must be derived via JOIN to `leaf_specs WHERE is_current = true`.
  - `quotes.predecessor_quote_id` and `quotes.superseded_by_quote_id` referenced in data-source map (lines 140, 168-169) — do NOT exist. The existing self-FK is `quotes.copiedFromQuoteId` (`schema.ts:277`). Re-quote workflow re-uses existing column OR adds new column.
  - `quotes.include_spec_addendum` referenced as "carry-forward from iter 1" (data-source map line 148) — does NOT exist (iter 1 never landed). Must be added.
- **All other schema shapes verified** against canonical schema.ts. Migrations buildable per existing patterns.

**Schema-ready: yes, pending CA brief amendments for items 1-2 above.** CC may open `slice-phase-a1-v2-impl-1-schema` once CA confirms the two material amendments.

---

## Gate 1 — `product_types` table shape

**Decision: UNIFIED table with `scope` enum.** Brief's proposal accepted.

**Rationale:**
- Single source of truth for type-name resolution across both ASY context-menu type-tags and leaf spec-rendering — one JOIN target on both `assemblies.product_type_id` and `leaves.product_type_id`. Splitting forces conditional FK reads at every type-label site.
- The `scope` enum is the natural disambiguator; both query patterns (ASY-only / leaf-only) are partial-index-friendly per the proposed `product_types_scope_idx on (scope) where hidden = false`.
- `field_schema` column is harmless on assembly-scope rows (always NULL); not worth a column-split to "save" NULLs.
- Matches the precedent of `cost_section_kind` enum + single `cost_section_deposits` table (`schema.ts:1360`) — same architectural pattern.
- Pattern 21 / Pattern 39 hygiene: type seeds + JSONB `field_schema` are admin data, not first-class application columns; unified taxonomy fits the data model.

**DDL (final):**

```sql
CREATE TABLE product_types (
  id text PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('assembly', 'leaf')),
  description text,
  field_schema jsonb,
  placeholder boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_types_scope_idx
  ON product_types (scope)
  WHERE hidden = false;
```

**Note on enum vs CHECK:** brief uses `CHECK (scope IN (...))`. Existing codebase prefers `pgEnum` (see `cost_section_kind`, `scenario_drop_reason`, `freight_leg_mode` in `schema.ts:31-175`). Equivalent semantics; the pgEnum approach is the house style. Recommend converting to:

```ts
export const productTypeScope = pgEnum("product_type_scope", ["assembly", "leaf"]);
```

Drizzle emits the `CREATE TYPE ... AS ENUM` + the column references it. No functional difference; cosmetic alignment with rest-of-schema.

**Indexes (final):**

- `product_types_scope_idx` — partial on `(scope) WHERE hidden = false`. Picks correctly for type-picker dropdowns (which exclude hidden) and for ASY/leaf-scoped resolution. Hidden types are still queryable via direct PK lookup for legacy data that still references them.
- **Add: `product_types_placeholder_idx`** — partial on `(scope, placeholder) WHERE hidden = false`. Lets type-picker query "show all leaf types with `field_count` meta" efficiently (placeholder=true → "fields TBD", placeholder=false → field count from `field_schema`).

**v1 enforcement:**

- JSONB validation lives in the app layer (per Q-Type3 disposition + brief §3.5). No Postgres-side JSON schema enforcement (no `jsonb_schema_check` extension; not worth the dependency for the v1 scale of ~10 types and ~100s of leaves).
- App-side validators read `product_types.field_schema`, validate `leaf_specs.spec_values` keys against the schema's field keys, reject unknown keys, enforce required fields when `field.required === true`.
- Validation lives in `src/lib/leaf-spec-validation.ts` (new module), called from server actions before INSERT/UPDATE on `leaf_specs`.
- `placeholder = true` types: `field_schema` is NULL; spec entry surface renders the "fields TBD" stub; the leaf is treated as `completeness = 'unknowable_until_schema_defined'` (special sentinel; doesn't fire soft gate).
- `hidden = true` types: not surfaced in type-picker dropdowns; still resolve for label rendering on legacy data.
- Edward provides seed data per pre-impl-1 checklist (§14 of impl brief).

---

## Gate 2 — `leaf_specs` versioning model

**Decision: `is_current` flag + history-via-row-insert.** Brief's proposal accepted with one clarification.

**Rationale:**
- The brief's §3.5 description is slightly inconsistent: "Subsequent edits update the current row's `spec_values` in place (NOT a new row)" (line 350) vs. "version_number increments AT pin time (creating effective_to on current row + new is_current row with bumped version_number)" (line 351). The Gate 2 verification clarifies: **edits between pins update in place; pins create a new row**. This is the only way to retain historical pinned values (otherwise a subsequent edit on the current row corrupts the data the prior pin pointed at — `quote_leaves.leaf_spec_version_id` would resolve to the in-place-edited current spec, not the spec the quote was sent with).
- Single-row-per-leaf with `is_current` partial unique works correctly: pre-pin edits mutate the current row's `spec_values` in place. AT pin time, the current row closes (`effective_to = now()`, `is_current = false`) and a new row inserts with `is_current = true` + bumped `version_number`. `quote_leaves.leaf_spec_version_id` references the CLOSED row, preserving the snapshot.
- Separate `leaf_spec_versions` table is over-engineering at v1 scale; the `is_current` flag + history-via-row-insert handles the same shape with one fewer table. Reconstruction from `audit_log` alone is sufficient for forensics; the closed `leaf_specs` rows ARE the version history.
- Partial unique index `(leaf_id) WHERE is_current = true` enforces "exactly one current row per leaf" at the schema level.

**DDL (final):**

```sql
CREATE TABLE leaf_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leaf_id uuid NOT NULL REFERENCES leaves ON DELETE CASCADE,
  spec_values jsonb NOT NULL DEFAULT '{}',
  version_number integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users,
  updated_by uuid REFERENCES users
);

CREATE UNIQUE INDEX leaf_specs_current_idx
  ON leaf_specs (leaf_id)
  WHERE is_current = true;

CREATE INDEX leaf_specs_leaf_version_idx
  ON leaf_specs (leaf_id, version_number);
```

**Versioning semantics (step-by-step on quote-pin):**

1. PM edits leaf specs N times pre-send. Each edit: `UPDATE leaf_specs SET spec_values = jsonb_set(spec_values, ...), updated_at = now(), updated_by = $user WHERE leaf_id = $leaf AND is_current = true`. Each edit writes an `audit_log` row with action `leaf_spec_field_edit`, capturing per-field diff.
2. Quote is sent (`sendQuote` action). For each `quote_leaves` row in the quote with `leaf_spec_version_id IS NULL`:
   a. Read the leaf's current `leaf_specs` row (`is_current = true`).
   b. Update its `leaf_spec_version_id` to point at that row's id.
   c. Set `pinned_at = now()` on the `quote_leaves` row.
3. **Pin event** (system-triggered when a leaf is first pinned, or when an already-pinned leaf is touched in a new quote at a different state): close the current row + insert a new one.
   - `UPDATE leaf_specs SET is_current = false, effective_to = now() WHERE id = $current_id`
   - `INSERT INTO leaf_specs (leaf_id, spec_values, version_number, is_current, effective_from, created_by, updated_by) VALUES ($leaf, $current_spec_values, $current_version + 1, true, now(), $system_user_id, $system_user_id)`
   - Audit row: action `leaf_spec_version_pin`, `diff_json.source = 'leaf_spec'`, `diff_json.version_number = N+1`, `caused_by_audit_id` = the sendQuote audit row.

**Note on pin-event timing:** the brief implies version bumps at every quote-pin (line 351). This is correct semantics but worth flagging: **a single sendQuote with M leaves causes M version-bump audit rows**, all sharing the same `caused_by_audit_id` (the sendQuote audit row). The cascade audit pattern handles this cleanly (CLAUDE.md "Cascade audit pattern"); CC writes one root row + M derived rows under the existing pattern.

**Historical query pattern (example):**

Given a `quote_leaves.leaf_spec_version_id = $pin_id`, reconstruct the spec values at pin time:

```sql
SELECT spec_values, version_number, effective_from, effective_to
FROM leaf_specs
WHERE id = $pin_id;
```

The closed row IS the historical snapshot. `effective_to` reads as "this version was retired on date X" (timestamp of the pin event that closed it). The currently-pinned-but-edited-since-pin case is handled by `quote_leaves.leaf_spec_version_id` pointing at the CLOSED (historical) row, not the open (current) row — so the customer's view of an already-sent quote always reads the historical snapshot, never the post-pin edits.

For the current spec (drafts):

```sql
SELECT spec_values, version_number
FROM leaf_specs
WHERE leaf_id = $leaf_id AND is_current = true;
```

Drafts always resolve to the current spec — auto-update semantics from brief §4.6.

**Performance:**

App-side JSONB validation on every save against the type's `field_schema`. At Nexus scale (~12 users, ~100s of leaves, ~5-10 fields per leaf type, ~5-10 save events per leaf per quote cycle), validation cost is negligible. JSONB column read+write performance is fine for `spec_values` payloads under ~50KB (well under typical ~1-5KB).

**Edge case worth flagging:** if a PM edits a leaf AFTER it's been pinned by quote A but BEFORE quote B sends, the edits accumulate on the CURRENT row (quote A's pinned row stays closed). When quote B sends, the pin event closes the current row + inserts a new row at version N+2. Quote A reads version N (pinned at send); quote B reads version N+2 (pinned at its send). The intermediate version N+1 — which technically existed mid-edit — is collapsed into N+2 by the pin event. This is correct (PMs don't need to see intra-pin micro-versions in version history; the version-bump granularity is "what was sent").

---

## Gate 3 — `assembly_leaves.parent_assembly_leaf_id` self-referential FK

**Decision: confirm FK shape, with adjusted ON DELETE behavior + clarified unique-constraint NULL handling.**

**FK shape:**

```sql
parent_assembly_leaf_id uuid REFERENCES assembly_leaves(id) ON DELETE CASCADE
```

Self-referential FKs work cleanly in Postgres; this is the same pattern as `quote_skus.parent_sku_id` (`schema.ts:459-462`) and `quotes.copiedFromQuoteId` (`schema.ts:371-375`).

**ON DELETE behavior:**

`ON DELETE CASCADE` confirmed. Brief proposed CASCADE; verified correct: if a parent assembly_leaf row is removed, its nested children should cascade. SET NULL would orphan children at the top level of an ASY (parent unreferenced, position lost). RESTRICT would block parent deletion until the PM manually moves children, which is wrong UX. CASCADE is right for the future nesting workflow.

(For v1, the column is always NULL anyway, so this behavior is preemptive — but cementing it correctly now avoids re-litigation when nesting ships.)

**v1 enforcement (app-side):**

```ts
// In actions/assembly-leaves.ts (new):
async function createAssemblyLeaf(input: { assemblyId, leafId, quantity, position }) {
  // v1 invariant: parent_assembly_leaf_id is always NULL.
  // Future workflow (post-v1) lifts this guard.
  await db.insert(assemblyLeaves).values({
    assemblyId: input.assemblyId,
    leafId: input.leafId,
    quantity: input.quantity,
    position: input.position,
    parentAssemblyLeafId: null, // forward-compat hook; not yet used
  });
}

async function updateAssemblyLeafParent() {
  // Reject for v1: nested leaves under leaves isn't designed yet
  throw new ActionGuardError(ERR.NOT_SUPPORTED, "Nested leaves under leaves are not yet supported.");
}
```

The "Assign to parent" context menu item from leaf context menu (data-source map line 57) is **disabled in v1** with a "future workflow" caption. The schema column exists for forward-compat; the UI does not surface it until the workflow is designed.

**Unique constraint with NULL handling:**

```sql
UNIQUE (assembly_id, leaf_id, parent_assembly_leaf_id)
```

Postgres `UNIQUE` treats NULLs as **distinct** by default (every NULL is unique). With `parent_assembly_leaf_id = NULL` (v1 default), this constraint allows multiple rows with the same `(assembly_id, leaf_id, NULL)` tuple — meaning **the same leaf can be added to the same ASY multiple times**.

Is this intended? Per brief §3.4 + CD designer notes: the UI does prevent this (the leaf context menu surfaces "library leaf is already in this ASY" affordance, per the `In-scenario indicator` from data-source map line 126). But the schema constraint is permissive.

**Recommendation: add a partial unique index for the v1 case:**

```sql
CREATE UNIQUE INDEX assembly_leaves_assembly_leaf_unique_top_idx
  ON assembly_leaves (assembly_id, leaf_id)
  WHERE parent_assembly_leaf_id IS NULL;
```

This enforces "leaf appears at top level of an ASY at most once" — matches the UI expectation. When future-nesting ships, additional constraints will be needed for nested cases (each nesting level has its own uniqueness expectation); for now, the partial index handles v1 cleanly.

The original brief `UNIQUE (assembly_id, leaf_id, parent_assembly_leaf_id)` can ALSO be added as a redundant guard for future nested cases (would catch duplicates at the same parent level when nesting is enabled), but it's not strictly necessary for v1. Recommend dropping it from the v1 DDL and adding it when nesting ships.

**Final v1 DDL:**

```sql
CREATE TABLE assembly_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid NOT NULL REFERENCES assemblies ON DELETE CASCADE,
  leaf_id uuid NOT NULL REFERENCES leaves ON DELETE RESTRICT,
  quantity numeric NOT NULL DEFAULT 1,
  position integer NOT NULL DEFAULT 0,
  parent_assembly_leaf_id uuid REFERENCES assembly_leaves(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assembly_leaves_assembly_position_idx
  ON assembly_leaves (assembly_id, position);

CREATE INDEX assembly_leaves_leaf_idx
  ON assembly_leaves (leaf_id);

CREATE UNIQUE INDEX assembly_leaves_assembly_leaf_unique_top_idx
  ON assembly_leaves (assembly_id, leaf_id)
  WHERE parent_assembly_leaf_id IS NULL;
```

---

## Gate 4 — NetSuite SO push payload extension

**Path: (ii) v1.1 ships NetSuite extension; v1 captures DB-side only.** Per trigger's escalation default ("if Aisha unavailable for v1-window resolution, default to path (ii)").

**[ESCALATION TO EDWARD/AISHA]** — confirm or re-disposition.

**Rationale for default (ii):**

- Aisha NetSuite team coordination isn't reachable from this Architect runtime directly. Per the trigger's standing protocol, default to deferred-extension when the upstream contract change can't be confirmed within the v1 window.
- DB-side capture is complete in v1 (Phase 8 implementation writes `quote_leaves.leaf_spec_version_id` correctly on send). The NetSuite payload extension is purely an integration-contract change at the wire layer.
- Pattern 32 applies in spirit: the **dependent feature** (NetSuite SO push consuming `leaf_spec_version_id`) doesn't exist yet on the NetSuite side; engineering around a hypothetical payload shape before the consuming side is ready is premature.

**Current SO push payload (unverified — Aisha to confirm):**

Architect runtime can't access NetSuite integration code from this codebase (NetSuite push is in `actions/mark-accepted.ts` or similar — TBD whether it's been built yet vs. still in the "Mark-Accepted external writebacks" combined slice that comes after Phase A.1 v2 per CLAUDE.md v1 release-path sequencing). Per CLAUDE.md, NetSuite writeback is **slot 4** in the v1 release path; this Phase A.1 v2 slice is part of slot 3 area. **NetSuite push may not even exist yet at v1 release** — needs confirmation.

If NetSuite SO push doesn't exist at v1 release (combined writebacks slice still pending), then Phase A.1 v2's Phase 8 reduces to "DB-side capture only" by default, and the NetSuite payload extension is naturally inherited by the writebacks slice when it ships. The combined writebacks slice's brief can include `leaf_spec_version_id` references as part of its payload contract.

**Proposed payload extension shape (for v1.1 or combined writebacks slice — informational):**

```json
{
  "quote_id": "...",
  "assemblies": [
    {
      "assembly_id": "...",
      "sku": "GLW-30",
      "leaves": [
        {
          "leaf_id": "...",
          "leaf_name": "30ml Glass Dropper - Type III soda-lime",
          "leaf_spec_version_id": "...",
          "version_number": 4,
          "spec_values": { ... }
        }
      ]
    }
  ]
}
```

`spec_values` could be carried inline (per the proposal) OR omitted in favor of a reference-only payload (NetSuite team queries our system via API for spec details when needed). Inline carries audit-completeness; reference-only minimizes payload size. **CD's proposal is inline.** Confirm with NetSuite team.

**Aisha coordination notes:**

- Surfaced to Edward for routing to Aisha. Architect runtime is read-only; cannot draft Aisha-side inquiry.
- **Open questions for Aisha:**
  1. Is NetSuite SO push live in v1, or part of the upcoming "Mark-Accepted external writebacks" combined slice?
  2. If live: what's the current payload shape? Document for Architect verification.
  3. If part of combined slice: can the combined slice brief absorb the `leaf_spec_version_id` extension? (Edward + CA dispose.)
  4. Inline `spec_values` in payload vs. reference-only?

**Phase 8 impact (v1 vs v1.1):**

- **v1 (default path ii):** Phase 8 writes `quote_leaves.leaf_spec_version_id` correctly at send. No NetSuite payload changes. Soft gate ships as designed. PR comm flags v1.1 / combined-writebacks-slice follow-up explicitly.
- **v1 path (i) if dispositioned later:** Phase 8 expands to include NetSuite payload extension. Requires Aisha contract sign-off + NetSuite-side test of new payload shape. Adds ~2-3 days to Phase 8 estimate.

**Default disposition: (ii).** Edward to confirm or escalate.

---

## Gate 5 — RLS policy strategy

**Decision: separate boolean flags on `users` + action-layer guards (NOT Postgres RLS policies).**

**Rationale (this is a material deviation from the brief):**

The brief §3.8 + data-source map propose Postgres RLS policies using `auth.user_has_permission(flag)`. This is fundamentally incompatible with the established codebase architecture:

1. **RLS is OFF across the entire codebase.** Per CLAUDE.md "RLS-off latent dependency" (lines 2220-2247): "The browser Supabase client uses the anon key. RLS is **off** across all 8 subscribed tables." Access control is Clerk + page/action layer, not DB row level.

2. **No Clerk-Supabase JWT bridge exists.** RLS policies that reference an `auth.user_has_permission(flag)` function require Postgres knowing which user is calling — implemented via Supabase's `auth.uid()` JWT claim. Our codebase uses Clerk for auth; Postgres only sees the anon key on browser connects and the service role on server connects. RLS policies would always evaluate `auth.uid() = NULL`.

3. **Server actions use Drizzle from server-side with service role.** Server actions bypass any RLS that might exist. RLS doesn't help when the gate is at the action layer anyway.

4. **Existing permission pattern is role enum + action guards.** `users.role` enum (`schema.ts:22-29`: admin / pm / purchasing / production / accounting / read_only) + `requireAdminPage` / `requireAdminAction` (`src/lib/admin-guard.ts`). This is the load-bearing pattern; Phase A.1 v2 should extend it, not introduce a parallel Postgres-RLS pattern that would silently fail.

5. **RLS conflicts with Realtime publication.** Per CLAUDE.md line 2227-2229: "If RLS is ever turned on for any subscribed table, the realtime path silently stops receiving events from that table — events fire server-side but fail RLS check on subscription delivery." Adding RLS to spec-edit tables would break Realtime for those tables (or require the JWT bridge first).

**v2 backlog note:** if Postgres RLS lands later (multi-tenant v2, Clerk-Supabase JWT bridge), the boolean flags on users translate cleanly to RLS predicates. The columns survive; only the enforcement layer changes.

**DDL (final):**

```sql
ALTER TABLE users ADD COLUMN can_edit_specs boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN can_create_leaves boolean NOT NULL DEFAULT false;
```

Schema columns match the brief's proposal. **No Postgres RLS policies created.**

**Enforcement (action-layer guards):**

New helpers in `src/lib/admin-guard.ts` (or new `src/lib/spec-permissions.ts`):

```ts
import "server-only";
import { ensureUser, type AppUser } from "@/lib/auth/ensure-user";
import { ActionGuardError, ERR } from "@/lib/action-result";

export async function requireSpecEditPage(): Promise<AppUser> {
  const user = await ensureUser();
  if (!user.canEditSpecs && user.role !== "admin") {
    redirect("/?denied=spec_edit");
  }
  return user;
}

export async function requireSpecEditAction(): Promise<AppUser> {
  const user = await ensureUser();
  if (!user.canEditSpecs && user.role !== "admin") {
    throw new ActionGuardError(ERR.FORBIDDEN, "Spec editing requires authorization.");
  }
  return user;
}

export async function requireLeafCreateAction(): Promise<AppUser> {
  const user = await ensureUser();
  if (!user.canCreateLeaves && user.role !== "admin") {
    throw new ActionGuardError(ERR.FORBIDDEN, "Leaf creation requires authorization.");
  }
  return user;
}
```

Pattern matches `requireAdminPage` / `requireAdminAction` exactly — same shape, same failure modes. Admins bypass (admin > any specific permission). Spec-edit affordances on the UI are gated via role-as-affordance pattern per CLAUDE.md "Role gating — affordance, not architecture": the page renders for everyone; write affordances filter per user.

**Migration default:** existing users get `false / false`. PMs aren't auto-granted spec-edit; Edward assigns per §15 of impl brief (the original "Edward dispositions initial role assignments" — restated).

**Initial role assignments are Edward's call** (out of Architect scope per trigger).

**Edge case: PM loses permission mid-session.** Per impl brief §8 + CLAUDE.md Pattern 47 — optimistic update fires → action layer rejects with FORBIDDEN → optimistic store reverts → UI surfaces denial toast. Same flow as any other action-layer-rejected mutation. No schema-side complications.

**Audit log integration:** when a user's flags are changed (admin grants/revokes), audit_log row written with action `user_permission_updated`, `diff_json.field = 'can_edit_specs'`, before/after booleans. Pattern matches `user_phone_updated` from `actions/users.ts:87`.

**Note on read access:** Brief proposed RLS read policies as `using (true)` — i.e., reads are open. With our Clerk + action-layer architecture, the equivalent is "no special guard on read paths." Spec data renders to anyone with the page (scoped by quote/project visibility upstream via existing patterns). Confirmed: no read-side gate.

---

## Cross-gate notes

### Migration plan validation

The impl brief §4.2 outlines 7-step migration. Architect spot-check:

- **Step 1 (Schema create):** Clean. Verified all 6 new tables shape against existing schema patterns; DDL above.
- **Step 2 (Product → ASY split):** Brief says "for each existing `products` row." There is **NO `products` table** in current schema (`schema.ts` grep confirmed). Current "products" live as `quote_skus` rows with `skuRole = 'assembly'`. The migration as written can't run.

  **Mapping for Step 2:** for each existing `quote_skus` row with `skuRole = 'assembly'`:
  - INSERT a new `assemblies` row with:
    - `id = gen_random_uuid()`
    - `quote_id = quote_skus.quote_id` (NOT scenario_id — that table doesn't exist; see Summary point 1)
    - `sku = quote_skus.sku_label`
    - `name = quote_skus.product_name`
    - `position = quote_skus.sort_order`
    - `product_type_id` = NULL initially (PMs assign via Edit specs flow; or pre-populated via Edward-provided seed mapping if HubSpot's `hs_product_type` is known per SKU)
    - Other commercial fields: NULL/default (margin_pct/markup_pct don't exist on quote_skus as columns — those live as part of the cost-stack tree via packaging_inputs.markup_pct etc., NOT per-SKU).
  - Keep `quote_skus` populated for v1 — do NOT drop. The `quote_skus` tree still drives the existing cost-stack math (Slice 5.5+ patterns); `assemblies` is a NEW parallel structure that captures the "spec-aware ASY" model.

  **OR** (cleaner architecturally but bigger blast radius): Step 2 maps `quote_skus` → `assemblies` and Step 6 drops `quote_skus`. This is a much larger refactor than the brief implies; the cost-stack math, packaging_inputs FKs (`schema.ts:690+`), production_inputs FKs (`schema.ts:751+`), and freight_legs (`schema.ts:861+`) all reference `quote_skus.id`. This isn't a 5-6 day migration; it's a 2-3 week refactor of the cost-stack architecture.

  **Recommendation:** the brief's migration plan as written **vastly underestimates the existing cost-stack-on-quote_skus dependency**. Two paths:

  - **Path A (recommended): `assemblies` is a NEW parallel structure**, layered on top of existing `quote_skus`. ASY rows shadow the `assembly` quote_skus rows; `assemblies.id` ↔ `quote_skus.id` via a nullable backref column on `assemblies` (e.g., `assemblies.legacy_quote_sku_id`). Cost-stack math continues against `quote_skus`; spec-aware features (specs, leaves, library) build against `assemblies` + `leaves` + `assembly_leaves` + `leaf_specs` + `quote_leaves`. Existing surfaces (Cost build, Pricing) read `quote_skus` as today. New surfaces (Setup tree view, spec entry, library, addendum) read the new tables. Cleanup unification deferred to v2.

  - **Path B (full refactor): rewire cost-stack to `assemblies` + `leaves`**. ~2-3 weeks additional CC time beyond the 5-6 week estimate. Out of scope for v1 calendar.

  **Strong Architect recommendation: Path A.** Path A matches the brief's 5-6 week estimate; Path B does not. The brief's data-model description implicitly assumes Path A (specs live on leaves, not quote_skus). Path A is the right shape.

- **Step 3 (Extract leaves from cost-stack):** Existing leaf-equivalents are `quote_skus` rows with `skuRole = 'leaf'` AND/OR `packaging_inputs` rows (per-leaf cost data lives on `packaging_inputs`, not `quote_skus.children`). Per CLAUDE.md Pattern 22 instance #3 (§6.b mismatch 1): "per-component cost data is persisted on `packaging_inputs` (Cost build's packaging-lines table) — columns map nearly 1:1 to brief's nested-component shape except no name field."

  **Migration extracts leaves from BOTH sources:**
  - For each `quote_skus` row with `skuRole = 'leaf'` AND `parentSkuId IS NOT NULL`: INSERT a `leaves` row (deduped by name + skuLabel across scenarios), INSERT an `assembly_leaves` row linking the parent assembly → leaf.
  - For each `packaging_inputs` row: similarly map to `leaves` + `assembly_leaves`, sourcing identity from category + supplier.

  **Deduplication strategy:** dedup on `(name, sku)` lowercase normalized. Conflicts surface as "name collision across scenarios" — Edward + CA review pre-migration. Audit log entries with action `leaf_create` + `diff_json.source = 'migration_backfill'` so the migration's writes are queryable later.

  Path A makes this Step 3 lighter — leaves are NEW, sourced from cost-stack data but not REPLACING it. Cost-stack still functions; library is a layered enhancement.

- **Step 4 (Pricing data re-linkage):** `pricing_events.quote_id` references `quotes`, not `quote_skus` (`schema.ts:1484`). No re-linkage needed for `pricing_events`. Tier data (`quote_tiers`) is also quote-keyed, not sku-keyed. **Step 4 likely is a no-op** under Path A; flag for confirmation.

- **Step 5 (quote_leaves backfill for sent quotes):** For each existing sent quote with assemblies + leaves derived above: INSERT `quote_leaves` row per leaf with `leaf_spec_version_id = NULL` (no historical spec data per Q2 disposition). Pattern 32 applies — legacy data has no specs; soft gate doesn't fire retroactively for sent quotes.

- **Step 6 (Drop legacy `products` table):** Does not apply (no `products` table). Path A keeps `quote_skus`. Step 6 may be **renamed**: "Verify cost-stack continues to read `quote_skus` correctly post-migration; no drop needed in v1."

- **Step 7 (HubSpot deal-level specs stay):** Per Q2 disposition. Confirmed.

**Migration plan is buildable under Path A. Brief §4 needs amendment to reflect the Path A vs Path B disposition + corrected Step 2 mapping.** Surface to CA for inline amendment.

### Index strategy

Brief proposed indexes are well-shaped. Architect additions:

**Confirmed (build as-is):**
- `product_types_scope_idx` — partial on `(scope) where hidden = false`. ✓
- `assemblies_scenario_position_idx` — **rename to `assemblies_quote_position_idx`** on `(quote_id, position)` per Summary point 1 (no scenarios table). ✓
- `leaves_product_type_idx` — partial on `(product_type_id) where archived = false`. ✓
- `leaves_sku_idx` — partial on `(sku) where archived = false`. ✓
- `assembly_leaves_assembly_position_idx` — on `(assembly_id, position)`. ✓
- `assembly_leaves_leaf_idx` — on `(leaf_id)`. ✓
- `leaf_specs_current_idx` — partial unique on `(leaf_id) where is_current = true`. ✓
- `leaf_specs_leaf_version_idx` — on `(leaf_id, version_number)`. ✓
- `quote_leaves_quote_idx` — on `(quote_id)`. ✓
- `quote_leaves_leaf_version_idx` — on `(leaf_id, leaf_spec_version_id)`. ✓

**Additions:**
- `product_types_placeholder_idx` — partial on `(scope, placeholder) where hidden = false`. (Per Gate 1.)
- `assembly_leaves_assembly_leaf_unique_top_idx` — partial unique on `(assembly_id, leaf_id) where parent_assembly_leaf_id IS NULL`. (Per Gate 3.)
- `quote_leaves_assembly_idx` — on `(assembly_id)`. Supports cascade-warning "list referencing ASYs" query (data-source map line 132).
- `leaves_archived_idx` — on `(archived)`. Supports library browse "exclude archived" filter (data-source map library browse section).

**Removable / not needed:**
- None — all proposed indexes pull weight.

### Constraint sanity

**Confirmed:**
- `ON DELETE RESTRICT` on `leaf_id` references (`assembly_leaves.leaf_id` + `quote_leaves.leaf_id`) — prevents accidental library leaf deletion when references exist. ✓
- `ON DELETE CASCADE` on `assembly_id` references (`assembly_leaves.assembly_id` + `quote_leaves.assembly_id`) — when ASY removed, its assembly_leaves + quote_leaves rows clean up; library leaves stay. ✓
- `ON DELETE CASCADE` on `quote_id` in `quote_leaves` — when quote deleted, its leaf pinnings clean up. ✓
- `ON DELETE CASCADE` on `leaf_id` in `leaf_specs` — when a leaf is hard-deleted (rare; soft-archive is the preferred path), its specs cascade. ✓ (Matches brief §3.5.)
- `ON DELETE CASCADE` on `parent_assembly_leaf_id` — per Gate 3 discussion. ✓
- `ON DELETE CASCADE` on `assemblies.quote_id` (not scenario_id) — when quote deleted, its ASYs clean up. ✓ (Replaces brief's scenario_id pattern.)

**Open question (escalation to Edward):**

- Brief §3.3 says `leaves` are globally scoped (no `scenario_id`). Confirmed correct. But: **what's the policy on hard-deleting a leaf that has zero references?** The `archived` flag is soft-archive. Should hard DELETE be allowed at all, or only via admin path?
  - **Recommendation:** Hard DELETE allowed only via admin action (action-layer guard). Soft-archive is the PM path. Library leaves represent business-history; accidental hard-deletion is a worse failure mode than over-accumulation of archived rows.

### Cascade-aware audit pattern

8 new audit actions (brief §3.7 + §7) — all writeable via existing `audit_log` schema (`schema.ts:1143-1201`). The cascade pattern (`caused_by_audit_id` self-FK) is in place. Brief §3.7 + §7.2 correctly identify the cascade-write shape (root row + N derived rows linking via `caused_by_audit_id`).

**Action name verification:**

| Brief action | diff_json.source convention |
|---|---|
| `leaf_spec_field_edit` | `'leaf_spec'` |
| `leaf_spec_type_change` | `'leaf_spec'` |
| `leaf_spec_create` | `'leaf_spec'` |
| `leaf_spec_version_pin` | `'leaf_spec'` (system event; flag with `actor_type = 'system'` equivalent — but no actor_type column exists; see Summary item 4 — `userId` will be `NULL` per existing pattern, signaling system origin) |
| `leaf_create` | `'leaf'` |
| `leaf_archive` | `'leaf'` |
| `assembly_leaf_attach` | `'assembly_leaves'` |
| `assembly_leaf_detach` | `'assembly_leaves'` |

Confirmed all action names are distinct + namespaced. Patterns match Slice 9.2's `diff_json.source` convention (CLAUDE.md "Audit source convention").

**Action-name addition surfaced during verification (for completeness):**
- `user_permission_updated` for `can_edit_specs` / `can_create_leaves` admin changes (per Gate 5 audit integration).

### audit_log column shape (Summary item 4 expanded)

Data-source map §"Audit log export" lines 178-185 references columns `actor_type`, `actor_name`, `target_type`, `target_id`. **None of these columns exist.**

Actual columns (`schema.ts:1143-1201`):

| Data-source map column | Actual column | Source |
|---|---|---|
| `timestamp` | `created_at` | ✓ exists |
| `actor_type` | (derived) | NOT in schema; derive at export from `user_id IS NULL ? 'system' : 'user'` |
| `actor_name` | (derived) | NOT in schema; resolve at export via JOIN `users.name` on `user_id` |
| `actor_id` | `user_id` | ✓ exists |
| `action` | `action` | ✓ exists |
| `target_type` | `entity_type` | ✓ exists (rename in export) |
| `target_id` | `entity_id` | ✓ exists (rename in export) |
| `diff_json` | `diff_json` | ✓ exists |
| `caused_by_audit_id` | `caused_by_audit_id` | ✓ exists |
| `audit_id` | `id` | ✓ exists (rename in export) |

CSV export shape (impl-7) handles the column-name aliasing at the export layer; no schema changes required. Brief §3.7 / data-source map can be patched inline to use canonical column names. Smaller-scale notation issues; not material amendments.

### Quote-level columns for re-quote workflow (Summary item 4 expanded)

Data-source map references `quotes.predecessor_quote_id` (line 140) and `quotes.superseded_by_quote_id` (line 168-169). **Neither exists.**

Existing self-FK: `quotes.copiedFromQuoteId` (`schema.ts:277`).

**Two options:**
- **(α) Reuse `copied_from_quote_id`** as "predecessor" semantics. Add a NEW column `superseded_by_quote_id` (uuid, nullable, self-FK to `quotes.id`). The "predecessor" relationship is the copy-source; the "superseded-by" relationship is the forward-pointer.
- **(β) Add both `predecessor_quote_id` + `superseded_by_quote_id`** as new columns. Semantically clearer (re-quote-predecessor is distinct from copied-from); but duplicates the FK pattern.

**Recommendation: (α).** The `copied_from_quote_id` semantics align with "this quote was created by copying a prior one" — which is what the re-quote workflow does (per brief §6.3: "duplicates the quote with current spec version"). Add a new `superseded_by_quote_id` for the forward-pointer.

```sql
ALTER TABLE quotes ADD COLUMN superseded_by_quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;
```

When PM clicks Re-quote on quote A:
1. Copy quote A → quote B (existing copyQuote action handles, `copied_from_quote_id` set to A's id).
2. Mark quote A as superseded by quote B: `UPDATE quotes SET superseded_by_quote_id = $B_id, status = 'superseded' WHERE id = $A_id`.

The `quote_status` enum already has `'superseded'` (`schema.ts:41-47`); this composes cleanly.

### Addendum toggle column (Summary item 4 expanded)

Data-source map line 148 references `quotes.include_spec_addendum`. **Does not exist.** Iter 1 never landed; the "carry-forward" reference is incorrect.

```sql
ALTER TABLE quotes ADD COLUMN include_spec_addendum boolean NOT NULL DEFAULT false;
```

Added in Phase 1 migration with the other new columns.

### `leaves.current_version` (Summary item 4 expanded)

Data-source map lines 68, 141, 165 reference `leaves.current_version`. **Does not exist as a column.** Per Gate 2's `is_current` flag pattern, current version is derivable:

```sql
SELECT version_number FROM leaf_specs WHERE leaf_id = $leaf_id AND is_current = true;
```

Helper view (optional, not required):

```sql
CREATE VIEW leaf_current_specs AS
SELECT leaf_id, id AS leaf_spec_version_id, version_number, spec_values
FROM leaf_specs
WHERE is_current = true;
```

Convenient for joins but not strictly necessary; app-side queries can do the JOIN directly. Don't add the view unless multiple call sites would benefit; for one-off uses, the JOIN reads fine.

---

## Open follow-ups for CC during impl

These are not blocking gates but worth CC's awareness:

1. **Path A vs Path B disposition (cross-gate notes / migration plan).** Architect strongly recommends Path A. Edward + CA confirm before impl-1 opens. Brief §4 needs amendment to reflect.

2. **Edward provides Path A backref column shape.** Specifically: should `assemblies.legacy_quote_sku_id` be a real FK to `quote_skus.id`, or just a tracking column? Real FK is safer but locks the cleanup path. Recommend: real FK with `ON DELETE SET NULL` (allows future drop of `quote_skus` without breaking `assemblies`).

3. **NetSuite payload extension confirmation (Gate 4).** Aisha coordination. Default is (ii); confirm or escalate.

4. **Seed data for `product_types`.** Edward provides exact taxonomy + field_schemas for PP + SP types before Phase 1 migration runs (per impl brief §14 checklist).

5. **Initial RLS-equivalent (flag) assignments.** Edward provides initial `can_edit_specs` / `can_create_leaves` grants for existing users (per impl brief §15 OQ-3).

6. **Audit-log export column-name aliasing strategy.** Pattern 22-style notation patch: data-source map column names (`actor_type`, `target_type`, etc.) map to actual schema column names (`user_id`, `entity_type`, etc.) at export layer. CC implements aliasing in `actions/audit-export.ts` or similar.

7. **Leaf hard-delete policy.** Recommend admin-only action-layer guard (cross-gate notes constraint sanity section). Confirm with Edward.

8. **Validation module location.** Recommend `src/lib/leaf-spec-validation.ts` (new module) for app-side JSONB validation. Pattern matches `src/lib/sku-tree.ts` / `src/lib/quote-guards.ts`.

9. **`field_schema` enum spec convention.** Brief §3.1 PP example shows `{"key": "...", "label": "...", "type": "textarea" | "text", "wide": true | false}`. Confirm `type` enum supports just `text` + `textarea` for v1, or expand to `select` / `number` / etc. Pattern 22 deferral candidate if expansions are needed.

10. **Pattern 32 application to `quote_skus`.** Under Path A, `quote_skus` continues to drive cost-stack math while `assemblies` drives spec-aware features. New columns added to `assemblies` (e.g., `legacy_quote_sku_id`) and existing `quote_skus` rows are mirrored on insert. PMs operating on the new Setup tree view write to `assemblies` + `assembly_leaves` + `leaves`; cost-stack reads through `quote_skus`. Until full unification (v2 candidate), Pattern 32 pre-production engineering tolerance applies: minor inconsistencies between the two structures are acceptable if no UI surface exposes them.

11. **PdfPage boundary guard.** Per CLAUDE.md "Customer-view boundary guard — build-time invariant": the PDF addendum render path is part of the customer-facing tree. Confirm that `leaf_specs.spec_values` rendering doesn't pull commercial fields (`leaves.unit_cost`, supplier names if any) into the PDF addendum. Phase 6 build-time invariant check applies. PR comm calls out the boundary verification step explicitly.

12. **Pattern 45 (customer-facing render data-source verification).** PDF addendum is a HIGH-impact customer-facing surface. Phase 6 gate: every rendered field traces to a real `leaf_specs.spec_values` key. No hardcoded synthetic strings (e.g., "{pp_material-pending}") ship — null-guard graceful degradation or `<Stub>` register only.

---

## Sign-off

**Schema ready for impl-1 branch: yes, pending two CA brief amendments.**

The brief amendments needed:

1. **Brief §3.2 / §3.4 / §3.6 / §4.2:** replace `scenarios` references with `quotes`. `assemblies.scenario_id` → `assemblies.quote_id`. Index name `assemblies_scenario_position_idx` → `assemblies_quote_position_idx`. Migration Step 2 maps to existing `quote_skus` rows with `skuRole = 'assembly'`, keyed on `quote_id`.

2. **Brief §3.8 / data-source map RLS section:** replace Postgres RLS proposal with action-layer guard pattern (Gate 5 path). DDL retains the `users.can_edit_specs` + `users.can_create_leaves` columns. Enforcement is action-layer (matching existing `requireAdminAction` pattern). Banked as Pattern 22 extension instance — "verification covers code architecture, not just DB schema" (CLAUDE.md Pattern 22 refinement, 2026-05-13). Pre-build verification caught the RLS architecture mismatch before any policy SQL was written.

Both amendments are inline notation patches per Pattern 25 §0.5 protocol; neither rewrites the slice scope or requires CD re-review. CA patches the brief; CC opens impl-1.

**Path A vs Path B disposition** (cross-gate notes / migration plan) is the third pending item but is a sequencing call rather than a schema commit — Architect's strong recommendation is Path A; Edward + CA dispose.

Once those land, CC's pre-impl-1 checklist (impl brief §14) can complete:
- [x] §0.5 verification — this commit
- [ ] CA brief amendments per items 1 + 2 above
- [ ] Edward dispositions: Path A vs Path B, `product_types` seed data, initial role assignments, NetSuite path
- [ ] CA + CD verify designer notes + data-source map at canonical paths (or use current `dist/docs/` paths)
- [ ] PR comm template at `docs/cc-comm-phase-a1-v2-impl-1.md`

— Architect (read-only schema subagent)
2026-05-19

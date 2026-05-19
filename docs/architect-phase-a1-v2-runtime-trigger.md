# Architect Runtime Trigger — Phase A.1 v2 Schema Verification

**To:** Architect (read-only schema subagent in CC environment)
**From:** CA (Claude Advisory)
**Re:** Pattern 25 §0.5 schema verification for Phase A.1 v2 impl
**Output:** Commit at `docs/architect/phase-a1-v2-schema-commit.md`
**Deadline:** Before CC opens `slice-phase-a1-v2-impl-1-schema` branch
**Coordinator for Gate 4:** Aisha (NetSuite integration team)

---

## Context

Phase A.1 v2 introduces 7 new tables, 2 new RLS permissions, and 8 new audit_log actions to support the ASY/LEAF/library spec model. CD's data-source map flagged five schema-architecture decisions that need Architect verification before CC commits to implementation.

This runtime is a **Pattern 25 §0.5 verification gate** — formal schema verification against the canonical source (`schema.ts` + existing migration history + production-data shape). Output is a commit document that CC reads before opening impl-1.

The lesson from the Pricing reframe round: phantom column classification propagated through briefs without verification, requiring late corrections. This runtime is the formal step that prevents recurrence.

## Source artifacts to read first

1. **Impl brief:** `docs/cc-phase-a1-v2-impl-brief.md` (§3 schema commitments, §4 migration plan, §7 audit log namespace)
2. **CD data-source map:** `docs/cd-quote-workflow-a1-v2-data-source-map.md` (full schema sketch + Pattern 25 verification gate enumeration)
3. **CD designer notes:** `docs/cd-quote-workflow-a1-v2-designer-notes.md` (design rationale for schema decisions, especially the "Six design decisions worth documenting" section)
4. **CA brief (canonical scope):** `docs/cd-quote-workflow-recalibration-brief.md` (§11 schema considerations — informational, less detailed than CD's data-source map)
5. **Canonical schema source:** `schema.ts` + migration history + current production DB structure

## Five gates to verify

### Gate 1 — `product_types` table shape

**CD proposed:** Single unified table with `scope` enum (`assembly` | `leaf`), `field_schema` JSONB, `placeholder` + `hidden` boolean flags.

**Architect verifies:**

- (a) Is the unified table the right call, or should it be two separate tables (`assembly_types` + `leaf_types`)?
- (b) If unified: query patterns scoped by `scope` flag — confirm indexed appropriately (`product_types_scope_idx on product_types (scope) where hidden = false` in CD's sketch)
- (c) JSONB validation strategy — app-side validation against `field_schema` is acceptable; confirm no Postgres-side JSON schema enforcement is needed
- (d) `placeholder` flag interaction with type-picker logic — confirm a leaf with type set to a placeholder type renders the placeholder treatment correctly (empty `field_schema`)
- (e) `hidden` flag — confirms hidden types don't appear in type-picker dropdowns but still allow legacy data referencing them to render

**Commit shape:**
```
## Gate 1 — product_types table shape
Decision: [unified | split]
Rationale: [...]
DDL: [final SQL]
Indexes: [final SQL]
v1 enforcement: [...]
```

### Gate 2 — `leaf_specs` versioning model

**CD proposed:** Single-row-per-leaf with `is_current = true` partial unique index. Historical pinned versions reconstructable via `audit_log` alone (no separate `leaf_spec_versions` table for v1). Version_number bumps at quote-pin events, not at every field edit.

**Architect verifies:**

- (a) Is the `is_current` flag + JSONB approach acceptable vs. a separate `leaf_spec_versions` history table?
- (b) Confirm `create unique index leaf_specs_current_idx on leaf_specs (leaf_id) where is_current = true` — partial unique constraint shape works as intended
- (c) Version_number bump semantics: at quote-pin events, the current row's `effective_to` gets set + a new is_current row inserts with bumped `version_number`. Confirm this is the right pattern vs. updating `version_number` on the same row (which would lose history)
- (d) Historical query pattern: given a `quote_leaves.leaf_spec_version_id` reference, how do we reconstruct the spec values at that pinned version? Via `leaf_specs WHERE id = leaf_spec_version_id` (snapshot in old row) or via `audit_log` reconstruction?
- (e) Performance characteristics of JSONB validation on every save — confirm acceptable given expected scale (12-person team, ~100s of leaves)

**Commit shape:**
```
## Gate 2 — leaf_specs versioning
Decision: [is_current flag | separate version-history table]
Rationale: [...]
DDL: [final SQL]
Versioning semantics: [step-by-step on quote-pin]
Historical query pattern: [example query]
```

### Gate 3 — `assembly_leaves.parent_assembly_leaf_id` self-referential FK

**CD proposed:** Nullable self-referential FK to support future deeper-nesting workflows. v1 enforcement: always NULL. Unique constraint `unique (assembly_id, leaf_id, parent_assembly_leaf_id)` to prevent duplicates.

**Architect verifies:**

- (a) Self-referential FK shape (Postgres handles cleanly with `references assembly_leaves(id)` self-ref)
- (b) ON DELETE behavior — CD proposed `ON DELETE CASCADE` on parent_assembly_leaf_id (if parent removed, children also removed). Confirm this is intended vs. SET NULL
- (c) Unique constraint with NULL values: Postgres `UNIQUE` treats NULLs as distinct by default. CD's constraint `unique (assembly_id, leaf_id, parent_assembly_leaf_id)` works correctly for NULL parent (each leaf only once at top-level under an ASY) but is permissive for non-NULL parents. Confirm this is intended.
- (d) v1 enforcement strategy: app-side guard prevents non-NULL parent_assembly_leaf_id (forward-compat reservation only). Confirm pattern: schema allows nesting; app rejects until v1.1+ workflow designed.

**Commit shape:**
```
## Gate 3 — assembly_leaves self-referential FK
Decision: [confirm FK shape]
ON DELETE behavior: [CASCADE | SET NULL | RESTRICT]
v1 enforcement: [app-side guard description]
Unique constraint: [confirm intended NULL handling]
```

### Gate 4 — NetSuite SO push payload extension

**CD flagged:** `quote_leaves.leaf_spec_version_id` should travel with the NetSuite SO push payload for production traceability. This crosses to NetSuite integration team's scope.

**Architect coordinates with Aisha to verify:**

- (a) Current SO push payload shape — what fields are in the contract today?
- (b) Extension proposal: payload includes per-leaf objects with `leaf_id`, `leaf_name`, `leaf_spec_version_id`, `version_number`, `spec_values`. Acceptable to NetSuite team?
- (c) Path decision:
  - **(i) v1 ships full extension** — NetSuite contract change negotiated, ready for v1 release
  - **(ii) v1.1 ships extension; v1 captures DB-side only** — our DB writes are complete; NetSuite payload extension deferred to v1.1 follow-up slice
- (d) If (ii): confirm CC implements DB writes correctly in Phase 8 + flags v1.1 follow-up explicitly in PR comm

**Coordinator:** Aisha. Architect surfaces the payload-shape question to Aisha; Aisha coordinates with NetSuite integration team; output committed back to Architect.

**Commit shape:**
```
## Gate 4 — NetSuite payload extension
Path: [v1 ships extension | v1.1 ships extension; v1 captures DB only]
Payload shape (if v1): [JSON example]
Aisha coordination notes: [...]
Phase 8 impact: [what changes vs. brief]
```

### Gate 5 — RLS policy strategy

**CD proposed:** Two separate boolean flags on `users` table — `can_edit_specs` and `can_create_leaves`. Policies on `leaf_specs` and `leaves` tables enforce via `auth.user_has_permission(flag)`.

**Architect verifies:**

- (a) Two separate flags vs. role-based pattern — does the existing tool model permissions via boolean flags, role enum, or RBAC table? Match the existing pattern.
- (b) Default values: both flags `false` on user creation; PMs typically have both; junior PMs / sales might have `can_create_leaves` only (assembling library leaves into ASYs but not editing specs). Confirm initial role assignments are Edward's call (out of Architect scope).
- (c) Policy SQL: example `create policy leaf_specs_write on leaf_specs for insert with check (auth.user_has_permission('can_edit_specs'))`. Confirm correct shape against existing RLS patterns in the tool.
- (d) Edge case handling: PM loses permission mid-session. Confirm Pattern 47 optimistic-update + denial-revert handles cleanly without schema-side complications.
- (e) Migration: existing users get defaults; explicit assignments after migration are Edward's call.

**Commit shape:**
```
## Gate 5 — RLS policy strategy
Decision: [separate flags | role-based | RBAC table]
Rationale: [aligns with existing tool pattern of X]
DDL: [user table column adds]
Policy SQL: [example policies for each protected table]
Migration default: [...]
```

## Cross-gate considerations

These aren't separate gates but worth surfacing during verification:

### Migration plan validation

The impl brief §4 outlines 7-step migration from existing `products` table to ASY/LEAF/library model. Architect spot-checks:
- Step 2 (Product → ASY split) — clean 1-to-1 mapping; no data loss
- Step 3 (Extract leaves from cost-stack) — deduplication strategy; how to handle leaves that should be library-shared vs. one-off
- Step 4 (Pricing data re-linkage) — `pricing_events` table FK update strategy
- Step 5 (quote_leaves backfill for sent quotes) — historical accuracy; leaf_spec_version_id stays NULL for legacy data; audit_log entries indicate legacy backfill

Architect doesn't write the migration — CC does — but confirms the strategy is sound and won't surface data-loss risks.

### Index strategy

CD proposed several indexes. Architect confirms each is needed and well-shaped:
- `product_types_scope_idx` — for type-picker queries
- `assemblies_scenario_position_idx` — for tree-order rendering
- `leaves_product_type_idx` (filtered) — for library browse by type
- `leaves_sku_idx` (filtered) — for library search by SKU
- `assembly_leaves_assembly_position_idx` — for tree-order rendering
- `assembly_leaves_leaf_idx` — for reference-count + cascade-warning queries
- `leaf_specs_current_idx` (partial unique) — for current-version lookup
- `leaf_specs_leaf_version_idx` — for historical version lookup
- `quote_leaves_quote_idx` — for quote-scoped queries
- `quote_leaves_leaf_version_idx` — for "where is this version pinned?" queries

Add or remove indexes per Architect's call.

### Constraint sanity

- `ON DELETE RESTRICT` on `leaf_id` references in `assembly_leaves` and `quote_leaves` — prevents accidental library leaf deletion when references exist
- `ON DELETE CASCADE` on `assembly_id` references — when ASY deleted, its assembly_leaves rows clean up (library leaves stay)
- `ON DELETE CASCADE` on `scenario_id` in `assemblies` — when scenario deleted, all its ASYs clean up; assembly_leaves cascade follows
- `ON DELETE CASCADE` on `quote_id` in `quote_leaves` — when quote deleted, its leaf pinnings clean up

Confirm each is intended; flag any that should differ.

## Commit document structure

Final output at `docs/architect/phase-a1-v2-schema-commit.md`:

```
# Architect §0.5 Verification — Phase A.1 v2 Schema

## Summary
- 5 gates resolved
- Schema ready for impl-1
- Notable decisions / deviations from brief: [list]

## Gate 1 — product_types table shape
[per shape above]

## Gate 2 — leaf_specs versioning
[per shape above]

## Gate 3 — assembly_leaves self-referential FK
[per shape above]

## Gate 4 — NetSuite payload extension
[per shape above + Aisha coordination notes]

## Gate 5 — RLS policy strategy
[per shape above]

## Cross-gate notes
- Migration plan validation: [confirmed | flag X concern]
- Index strategy: [confirmed | add/remove Y]
- Constraint sanity: [confirmed | flag Z]

## Open follow-ups for CC during impl
[any items Architect surfaces that aren't blocking but worth CC's awareness]

## Sign-off
Schema ready for impl-1 branch: [yes | no — pending X]
```

## Coordination notes

- **Brief amendments:** if Architect's resolution differs materially from the impl brief, CA reviews + amends brief before impl-1 opens. Material differences include: schema shape changes, additional tables, fundamentally different RLS pattern.
- **Aisha coordination on Gate 4:** Architect surfaces NetSuite payload question to Aisha; Aisha coordinates with NetSuite team; output committed back to Architect. If Aisha is unavailable for v1-window resolution, default to path (ii) — v1.1 ships NetSuite extension, v1 captures DB-side only.
- **CD coordination not required** for this runtime — CD's prototype + data-source map are inputs, not requiring re-review. If Architect's resolution materially affects CD's design (rare — schema decisions typically don't), CA coordinates with CD.
- **Edward dispositions out of Architect scope:** Product Type seed data + initial RLS role assignments are Edward's calls (per §15 of impl brief). Architect verifies *schema shape*; Edward provides *data*.

## Standing pattern

If anything in the impl brief, CD's data-source map, or CD's designer notes reads inconsistent with canonical schema or production reality, **surface to CA before committing.** Don't paper over inconsistencies in the commit document.

If Architect identifies issues that block any of the 5 gates from resolving, surface to CA with proposed alternatives. CA + CD coordinate; brief amendments published if needed.

— CA

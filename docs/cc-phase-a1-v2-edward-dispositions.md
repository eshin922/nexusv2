# Phase A.1 v2 — Edward Dispositions Package

**From:** Edward (via CA-Edward exchange)
**To:** CC (Claude Code)
**Status:** All four §15 items + two Architect-surfaced path decisions locked
**Canonical record:** `docs/cc-phase-a1-v2-impl-brief-v2.md` §15 (incorporated)
**Date:** May 19, 2026

---

## Summary

All decisions blocking impl-1 on the dispositions track are resolved. CC absorbs into pre-impl-1 prep; impl-1 opens after Pricing reframe merge + Aisha NetSuite confirmation + brief v2 commit.

## Disposition 1 — ASY-level Product Type taxonomy

Seed data for `product_types` table at impl-1 migration time:

```
asy_skincare       | Skincare
asy_supplement     | Supplement (oral)
asy_haircare       | Hair care
asy_colorcosmetics | Color cosmetics
asy_body           | Body care
asy_beverage       | Beverage / functional drink
asy_pet            | Pet care
asy_household      | Household / cleaning
asy_other          | Other
```

All 9 categories ship in v1. Admin-path for adding new categories banked v1.1+.

## Disposition 2 — LEAF-level Product Type taxonomy

### First-class (field_schema designed for v1)

| ID | Display name | Covers |
|---|---|---|
| `leaf_primary_packaging` | Primary packaging (PP) | Bottles, jars, tubes + closures (caps, pumps, droppers) |
| `leaf_secondary_packaging` | Secondary packaging (SP) | Cartons + labels + flexible packaging |
| `leaf_tertiary_packaging` | Tertiary packaging (TP) | Corrugated cases, master cases — **NEW: elevated to v1 first-class** |

### Visible placeholder (field_schema null, v1.1+ design)

| ID | Display name |
|---|---|
| `leaf_soft_goods` | Soft goods |

PMs can tag leaves with this type; SpecEntry renders placeholder treatment until field_schema is designed in v1.1+.

### Hidden (migration targets only)

| ID | Display name |
|---|---|
| `leaf_component` | Component / part |
| `leaf_assembly_sub` | Assembly sub-component |
| `leaf_service` | Service / labor |
| `leaf_other` | Other |

Hidden from picker; used for migrating legacy data that doesn't fit clean PP/SP/TP/Soft goods categorization.

### TP field_schema starter

Edward approved; CD refines at SpecEntry design time.

```json
{
  "fields": [
    {"key": "tp_description", "label": "TP Description", "type": "textarea", "wide": true},
    {"key": "tp_type", "label": "TP Type", "type": "text"},
    {"key": "tp_outer_dims", "label": "Outer Dimensions", "type": "text"},
    {"key": "tp_inner_dims", "label": "Inner Dimensions", "type": "text"},
    {"key": "tp_flute", "label": "Flute / Wall", "type": "text"},
    {"key": "tp_ect_or_board", "label": "ECT / Board Grade", "type": "text"},
    {"key": "tp_units_per_case", "label": "Units per Case", "type": "number"},
    {"key": "tp_print", "label": "Print / Finish", "type": "text"},
    {"key": "tp_closure", "label": "Closure / Construction", "type": "text"},
    {"key": "tp_pallet_config", "label": "Pallet Config", "type": "text"}
  ]
}
```

### Flagged for CD at SpecEntry design time

Now that closures fold into PP and labels + flexible fold into SP, the `pp_component_type` and `sp_component_type` discriminator fields should render as **selects** (not free-text) for consistency. Suggested option sets:

- **PP `component_type`:** `bottle | jar | tube | cap | pump | dropper | dispenser | other`
- **SP `component_type`:** `carton | label | flexible | sleeve | other`

CD's judgment governs the final option lists at SpecEntry design.

## Disposition 3 — Initial RLS role assignments

Migration applies explicit per-user SQL at impl-1 schema-create. No post-migration cleanup needed.

| User | Role | `can_create_leaves` | `can_edit_specs` |
|---|---|---|---|
| Edward | admin | ✅ true | ✅ true |
| Jackie King | admin | ✅ true | ✅ true |
| Aisha | PM | ✅ true | ✅ true |
| Lexa Yerges | PM | ✅ true | ✅ true |
| Andrea McKibben | PM | ✅ true | ✅ true |
| Cally Hou | Logistics | ✅ true | ✅ true |
| Jing Santos | Sales | ✅ true | ❌ false |

### Migration SQL shape

```sql
update users set can_create_leaves = true, can_edit_specs = true
  where email in (
    'edward@thedps.co',
    'jackie@thedps.co',
    'aisha@thedps.co',
    'lexa@thedps.co',
    'andrea@thedps.co',
    'cally@thedps.co'
  );
update users set can_create_leaves = true, can_edit_specs = false
  where email = 'jing@thedps.co';
```

### Logic

- **Admins** (Edward, Jackie): both flags — full access
- **PMs** (Aisha, Lexa, Andrea): both flags — standard PM workflow
- **Logistics** (Cally): both flags — owns tertiary packaging (corrugated); needs create + edit on leaves
- **Sales** (Jing): `can_create_leaves` only — builds quotes from existing library leaves; spec authorship stays with PMs/Logistics to reduce drift risk

## Disposition 4 — NetSuite payload path

**Path A locked — v1 ships full NetSuite extension.**

### Scope (impl-8)

- Full payload extension: per-leaf objects with `leaf_id`, `leaf_name`, `leaf_spec_version_id`, `version_number`, `spec_values`
- NetSuite team contract change negotiated by Aisha
- Receiver-side build on NetSuite side
- End-to-end smoke: create ASY → add leaves → enter specs → send quote → NetSuite payload contains pinned version refs
- Contract test: payload includes `leaf_spec_version_id` references correctly

### Aisha coordination

Already in flight per Edward standby. Aisha confirms NetSuite team capacity for v1-window contract change before impl-8 starts.

### Fallback

Path B (v1.1 ships extension; v1 captures DB-side only) is available if NetSuite team can't deliver in v1-window. Our DB writes correct in either path; v1.1 follow-up adds NetSuite contract extension. Fallback decision committed by impl-8 start.

### Architect Gate 4 supersession note

Architect committed Gate 4 with default Path (ii) during runtime because §15 dispositions weren't in Architect's context at run time. Path A as recorded here supersedes. Updated reference: `docs/cc-phase-a1-v2-impl-brief-v2.md` §9 + §15.4 are canonical; Architect commit doc historical.

---

## Architect-surfaced path decisions (Edward confirmed)

These two decisions came out of Architect's §0.5 commit and required Edward disposition before brief amendments could land.

### Schema introduction approach — Path A (parallel structure)

Architect lean: A. Edward confirmed.

New ASY/LEAF/library tables (`assemblies`, `leaves`, `assembly_leaves`, `leaf_specs`, `quote_leaves`) sit **alongside** existing `quote_skus`. Existing quotes continue using `quote_skus`; new quotes use the new model. Migration backfills `quote_leaves` from `quote_skus` for sent quotes.

5-6 week impl estimate holds. Path B (full cost-stack refactor replacing `quote_skus`) was rejected — +2-3 weeks with no v1 driver. Banked for v2 cost-stack consolidation.

### RLS enforcement approach — Path B (action-layer guards)

Architect lean: B. Edward confirmed.

Per Architect's read of existing Nexus access-control pattern, enforcement happens via **server-action guards** (`assertCanEditSpecs`, `assertCanCreateLeaves`), NOT Postgres RLS policies. Same boolean flags on `users` table; different enforcement layer.

Initial brief proposed Postgres RLS DDL — material deviation from existing pattern. Brief v2 §3.8 + §8 corrected.

---

## What this unblocks

CC's pre-impl-1 prep on the dispositions track is complete. Remaining blockers for opening `slice-phase-a1-v2-impl-1-schema` branch:

1. **Pricing reframe merge** (this week, independent track)
2. **Aisha NetSuite team confirmation** (Path A confirmation or fallback to Path B)
3. **Brief v2 commit** (`docs/cc-phase-a1-v2-impl-brief-v2.md` — CA delivered)

Once all three resolve, CC opens impl-1.

---

## Reference

- **Brief v2:** `docs/cc-phase-a1-v2-impl-brief-v2.md`
- **Architect commit:** PR #39 (`docs/architect/phase-a1-v2-schema-commit.md`)
- **Architect runtime trigger:** `docs/architect-phase-a1-v2-runtime-trigger.md`
- **CA-Edward exchange (this session):** captured here as canonical record

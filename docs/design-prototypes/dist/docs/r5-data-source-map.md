# Round 5 — Data-source map

Admin surfaces. The whole round is "Edward's tools" — firm policy, markup
defaults, audit log. The shape is small, but the load-bearing question is
*what's the truth of the system, and where do you go to read or edit it?*

Legend: ✅ existing schema · 🔧 named slice · 📋 backlog · ✨ wishful

---

## Firm settings page

| UI element | Source | Notes |
|---|---|---|
| `target_margin_pct` (35%) | ✅ `firm_settings.target_margin_pct` | Single global, not per-client |
| `floor_margin_pct` (25%) | ✅ `firm_settings.floor_margin_pct` | Drives `quote_warnings.below_floor` |
| `effective_from` / `effective_until` | ✅ `firm_settings_history` rows | We assume an effective-dated row table; named in PRD §4.3 |
| Updated by + when | ✅ `firm_settings.updated_by_id`, `updated_at` | |
| Portfolio effect strip (14/8/2) | 🔧 derived live from `quotes WHERE status='sent'` cross-joined to current policy | Materialized as a count, not stored |
| Re-band preview ("4 quotes change band") | 🔧 same query, but with proposed-policy bands instead of current | Computed on edit-form change |
| Affected-quotes list in preview | 🔧 same query, returning rows | Truncated UI-side at top 5; "view all" links into a filtered list |
| Policy history rail | ✅ `firm_settings_history` paginated DESC | |
| "Schedule…" picker | 📋 backlog | Drawn but inert; storage already supports `effective_from > now()`; UI ships in a later round |

## Markup defaults page

| UI element | Source | Notes |
|---|---|---|
| Category list | ✅ `markup_defaults` rows, FR-15 vocabulary | |
| `default_markup_pct` per category | ✅ `markup_defaults.default_markup_pct` | |
| `line_item_count` | 🔧 derived: `count(packaging_inputs) WHERE category=X AND quote.status IN ('draft','sent')` | Materialized; refresh on quote save |
| `last_edited_by` / `last_edited_at` | ✅ `markup_defaults.updated_by_id`, `updated_at` | |
| "Unused — never used" chip | 🔧 `line_item_count == 0` AND existed > 30d | Soft signal, not a delete |
| Inline editor (40% → 42%) | ✅ writes back to `markup_defaults.default_markup_pct` | |
| "Will recompute 142 line items across 11 draft quotes" | 🔧 derived count by joining drafts on category | Computed on input blur, before commit |
| "Estimated blended-margin shift +0.6 to +1.4 pts" | ✨ wishful | Requires running the cost-stack engine in dry-run mode against affected drafts. Approximation acceptable; surface "estimate" wording |
| "Sent quotes are frozen" propagation rule | ✅ already true — quotes snapshot markup at send-time per Slice 9 schema | The UI commitment is to *say so* |
| "+ NEW CATEGORY" | 📋 backlog | Drawn; FR-15 vocabulary is locked for now |

## Audit log page

| UI element | Source | Notes |
|---|---|---|
| Feed rows | ✅ `audit_log` table | Append-only; one row per state change |
| `ts`, `ts_full` | ✅ `audit_log.created_at` | |
| `user.{initials,name}` | ✅ `users` join | |
| `entity_type`, `entity_id`, `entity_label` | ✅ `audit_log` denormalized | Label is computed on write so log stays readable if entity is later renamed |
| `action` | ✅ `audit_log.action` enum | created · updated · sent · scenario_dropped · cell_override_updated · cell_target_updated · below_floor_override_requested · scenario_created |
| `summary` | ✅ `audit_log.summary` denormalized text | Human-written at write-time per action handler |
| `diff` (structured before/after) | ✅ `audit_log.diff_json` | Field-level shape: `{key: {from, to}}` |
| `diff_fields` (count) | 🔧 derived `count(keys(diff_json))` | |
| `cell_ref` (sku, tier) | ✅ `audit_log.context_json` for cell-scoped changes | |
| Cascade chip ("4 rows × 4 tiers re-derived") | 🔧 derived from same-transaction grouping | We log the *source* change once and tag derived writes with `caused_by_audit_id`; the chip counts those |
| `copy_source` link | ✅ `audit_log.context_json.copied_from_quote_id` | |
| Search box (free-text) | 🔧 Postgres trigram on `summary` + `entity_label` | |
| Entity-type filter chip | ✅ `WHERE entity_type = ?` | |
| User filter chip | ✅ `WHERE user_id = ?` | |
| Action filter chip | ✅ `WHERE action = ?` | |
| Date range filter | ✅ `WHERE created_at BETWEEN ?` | |
| "Filtered" deep-link bar | 🔧 URL-state filter set; deep-linkable | |
| Export CSV / Copy deep-link | 📋 backlog | Drawn; CSV is straightforward, deep-link is just the URL |

## Cross-cutting

- **Cascade tagging** is the only meaningful schema commitment new to this round: every write that's a derived consequence of another carries `caused_by_audit_id`. Without it the audit log either drowns in noise (one row per derived value) or lies about what happened (only the source change is logged, derived facts appear to come from nowhere). We commit to logging both, and aggregating in the UI.
- **Effective-dated firm settings** are a real table with a history row per change, not just an updated-in-place row. This is so the audit log + portfolio-effect view can reconstruct any prior policy.
- **Markup snapshots on send** were already a Slice 9 commitment; we surface that promise on the markup-defaults page as the "frozen" rule.

## Things explicitly NOT here

- Per-client target/floor overrides (asked, deferred — Q4 conversation)
- Per-PM markup overrides as a default (vs. per-line, which already works)
- Real-time activity stream (audit log is forensic, not "what's happening now")
- Permissions / role editor (separate admin page, not in this round)

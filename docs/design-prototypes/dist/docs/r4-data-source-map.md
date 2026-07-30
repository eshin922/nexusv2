# Round 4 · Data-source map

Same three-category schema as prior rounds:
- **EXISTS** — column or table already in the schema
- **SPEC** — feature named in `SPEC.md` (FR-X identifier)
- **BACKLOG** — committed in `UX_BACKLOG.md` but not yet built; flagged where used
- **WISHFUL** — flagged honestly when this design assumes data we don't have

---

## Surface A · Deal organizer

### Page header
| UI element | Source |
|---|---|
| `My deals · 10 active` count | EXISTS — `count(projects.id) where pm = me and project_status = 'active'` |
| "Tuesday morning · last login Friday 5:14pm" | EXISTS — `users.last_login_at` |
| Import-from-HubSpot CTA | SPEC FR-13 (HubSpot deal import) |
| `+ New project` | SPEC FR-13 |

### "What's my move" inbox
This is the **cross-project signal aggregation**. Each row is a derived signal, not a stored row.
| Signal kind | Computed from |
|---|---|
| `override_pending` | EXISTS — `quotes.below_floor_pending = true and override_dm_sent_at < now() - interval '1h'` |
| `customer_silent` | EXISTS — `quotes.status = 'sent' and sent_at < now() - 48h and accepted_at is null` |
| `supplier_quote` (awaiting external) | BACKLOG — `quote_warnings` rows of kind `awaiting_supplier_quote`. Lands in Slice 9.5. |
| `stage_drift` | EXISTS — diff between `projects.hubspot_stage_cached` vs latest HubSpot poll. SPEC FR-13 cache. |
| Urgency tier (`now`/`today`/`this_week`/`review`) | DESIGN — derived in app from age + signal kind. No new field. |
| Filter chips (All/Now/Today/Review) | DESIGN — client-side filter over the same derived list. |

### Filter bar
| UI element | Source |
|---|---|
| All stages, Client, PM, Sales rep, Status, Has-lines-to-review | SPEC FR-13 (all listed columns are filterable) |
| Sort: ↓ Last activity (default) | SPEC FR-13 |

### Project row
| UI element | Source |
|---|---|
| Client (italic display) | EXISTS — `projects.client_name` |
| Deal name | EXISTS — `projects.deal_name` |
| `N scenarios` chip | EXISTS — `count(scenarios.id where status='active')` |
| `!N review` chip | BACKLOG — rollup of `quote_warnings` per project. Slice 9.5. |
| HubSpot stage pill | EXISTS — `projects.hubspot_stage_cached` |
| Latest quote `$Xk · vN · status` | EXISTS — last row of `quotes` for active scenario |
| Margin % + state | EXISTS — `quotes.blended_margin_pct` + Slice 9.4b margin gate result |
| `T2 blended` label | EXISTS — `quotes.selected_tier_for_blended` (Slice 9.3) |
| Next-action pip + text | DERIVED — same logic as the inbox, scoped per project |
| Last-activity timestamp | EXISTS — `quotes.updated_at` max per project |

### Empty state
| UI element | Source |
|---|---|
| Empty glyph + copy + Import CTA | DESIGN — wired to SPEC FR-13 import flow |

---

## Surface B · Project detail

### Header
| UI element | Source |
|---|---|
| Client (italic h1) | EXISTS — `projects.client_name` |
| Deal name | EXISTS — `projects.deal_name` |
| PM / Sales / Stage / Synced | EXISTS — `projects.pm_user_id`, `sales_rep`, `hubspot_stage_cached`, `hubspot_synced_at` |
| Refresh-from-HubSpot button | SPEC FR-13 |
| Created date / "9 days in" | EXISTS — `projects.created_at` |
| Presence chip (WC viewing freight) | BACKLOG — multi-user presence. SPEC committed; lives in app header per Round 3. Re-rendered here in topbar, not in rail. |

### Next action card
| UI element | Source |
|---|---|
| `override_pending` headline | EXISTS — `quotes.below_floor_pending`, `override_dm_sent_at` |
| `Resume primary scenario →` CTA | DESIGN — routes to scenario card |
| `single` state ("enter SKU shapes") | DERIVED — empty `quote_skus` count |

### Scenario card
| UI element | Source |
|---|---|
| Scenario label | EXISTS — `scenarios.scenario_label` |
| Status chip (Active/Dropped/Accepted) | EXISTS — `scenarios.scenario_status` |
| `★ Primary` recommended | DERIVED — `scenarios.recommended = true` (BACKLOG · Round 4 commitment, see Designer notes) |
| Margin mini (`22.8% · T2 blended`) | EXISTS — Slice 9.3/9.4b output |
| Draft-after-send banner | EXISTS — pinned-version logic from Round 3. `quotes` where `status='draft'` and prior `status='sent'` exists for same scenario |
| `Mark Accepted will lock against v3` copy | EXISTS — sent-version pinning rule (carry-forward from Round 2.5) |
| Version chain (v1..vN with status, margin, amount, when) | EXISTS — `quotes` ordered by `version_number` |
| `drop_reason` shown on dropped scenarios | EXISTS — `scenarios.drop_reason` |
| Lineage panel (`copied_from_quote_id`) | SPEC FR-12 |

### Activity rail
| UI element | Source |
|---|---|
| Activity stream | EXISTS — `audit_log` filtered to project scope |
| Auto-drop entries on accept | EXISTS — captured by SPEC FR-2 sibling auto-drop |

---

## Surface C · Copy operations

### Source picker (within-project)
| UI element | Source |
|---|---|
| Quote list | EXISTS — `quotes` where `project_id = current` |
| margin/tier/status per row | EXISTS — same columns as above |

### Cross-project picker
| UI element | Source |
|---|---|
| Project list | EXISTS — `projects` where user has access |
| Search by name/client/SKU | SPEC FR-12 ("search by project name / client / SKU label") |
| `Show archived` toggle | SPEC FR-12 |
| Quotes list (right pane) | EXISTS — `quotes` per selected project |
| Accepted-pip green dot | EXISTS — `scenarios.scenario_status = 'accepted'` |

### Field-bucket preview
All three buckets are settled by SPEC FR-12. The UI mirrors the spec verbatim:
| Bucket | Fields | Source |
|---|---|---|
| Cloneable | SKU labels/categories/units_per_pack, all packaging_inputs, freight policy fields, all production_inputs, retail_benchmark, global_price_adj_pct | SPEC FR-12 |
| Inherited | project_id, hubspot_deal_id, deal_name, client_name, sales_rep, pm | SPEC FR-12 |
| Reset | quote id, version_number, status (→ draft), sent/accepted timestamps, notes, valid_until, freight shipment fields, actual_units_produced, scenario_label/status, tier qty values | SPEC FR-12 |

### Tier handling
| UI element | Source |
|---|---|
| "Source 4 tiers → target 3 tiers" | DERIVED — `count(distinct tier_index)` per quote |
| "Preserve hidden" default | SPEC FR-12 (Edward's settled rule: tier excess persists in DB, doesn't render) |
| 3 options dropdown | DESIGN — SPEC carries the rule, dropdown is the surface |

### Drop-or-keep modal
| UI element | Source |
|---|---|
| "Keep both active" / "Drop current" | SPEC FR-2 |
| `drop_reason='superseded_by_copy'` | DESIGN COMMITMENT — extends SPEC FR-2 drop_reason enum (currently: explored, accept_sibling, draft_at_accept). Adding `superseded_by_copy`. |
| Lineage preview (`← copied from …`) | SPEC FR-12 (`copied_from_quote_id`) |

---

## Cross-cutting · Navigation rail

### Outer rail (56px)
| UI element | Source |
|---|---|
| Nexus mark | DESIGN |
| My deals (active) + signal dot | DERIVED — count of urgency=`now` signals for current user |
| Search (⌘K) icon | BACKLOG — UX_BACKLOG global search |
| Pinned project squares | BACKLOG — `user_pinned_projects` table (Round 4 commitment) |
| Recent project squares | BACKLOG — `user_project_visits` MRU list capped at 4 (Round 4 commitment) |
| Settings | EXISTS — admin route, role-gated |
| Avatar | EXISTS — `users.initials` |

### Inner rail (240px, project-scoped)
| UI element | Source |
|---|---|
| Back to All deals | DESIGN |
| Project header (client/deal/stage) | EXISTS — same as project header above |
| Scenarios list | EXISTS — `scenarios` for current project |
| Per-scenario margin pip + label | EXISTS — Slice 9.4b margin verdict |
| `draft +N` warning | EXISTS — draft-after-send count |
| Surface links (Setup/Cost build/Costing sheet/Customer view) | EXISTS — Round 1 IA |
| Mini activity feed | EXISTS — `audit_log` filtered |

---

## Wishful items (called out)

None in this round. Every UI element above maps to either an existing column, a named SPEC feature, or a Round 4 commitment listed in Designer notes. The two BACKLOG items (`user_pinned_projects`, `user_project_visits`) are commitments we're proposing as a Round 4 outcome — they're new but small.

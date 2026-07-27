# Round 8 — Quote umbrella · Data-source map

Every UI element → its data source, so CC wires against real fields rather than
inventing them. Prototype fixtures live in `app/r8/data.js` (`window.NXR8`).

**Legend:** `EXISTING` = already in the schema / shipped · **`NEW`** = does not exist
yet, must be created (flagged per brief §4) · `REUSED` = a shipped component's data,
framed here · `DERIVED` = computed at render · `PROTO` = prototype-only, strip in production.

---

## Shell · topbar · sub-tab strip

| UI element | Source | Field / note |
|---|---|---|
| Breadcrumb (client · deal · scenario · Quote) | EXISTING | `project.{client, deal}`, `scenario.label` |
| Quote number | EXISTING | `quote.quote_number` — stable across all versions |
| State chip | DERIVED | `quote.state` ∈ `draft` \| `sent` \| `accepted` \| `complete` |
| Sub-tab status (current/done/upcoming/locked) | DERIVED | `quote.state` + locked sub-tab order. `locked` when `state='complete'` (Pattern 52) |
| Client Review entry count | **NEW** | `count(quote_review_events)` for this quote |
| Lock threshold rule + legend | DERIVED | static — expresses "reversible until NetSuite push". No data. |
| Prototype state switcher | PROTO | — |

## 1 · Preview Quote

| UI element | Source | Field / note |
|---|---|---|
| Version rows | **NEW** *(picker UI; snapshots exist)* | version chain per quote: `{version_number, status, created_at, note, total}`. Snapshots already retained by Revise — the **chooser** is new. |
| Version status tag | DERIVED | `sent` when `version_number = quote.sent_version`; `draft` when `= quote.draft_version`; else `superseded` |
| Version total | EXISTING | quote-version rollup (turnkey total, sell-side) |
| PDF preview | REUSED | Slice 11 customer PDF render — unchanged, framed only |
| Download PDF | REUSED | Slice 11 render/download path |

## 2 · Send to Client

| UI element | Source | Field / note |
|---|---|---|
| Recipient block | EXISTING | `contact.{name, role, email}` (HubSpot projection) |
| Version being sent | EXISTING | `quote.draft_version` |
| Valid until | EXISTING | `quote.valid_until` |
| Send action | EXISTING | re-housed `sendQuote` (shipped) |
| State transition | EXISTING | `quote.state` `draft` → `sent` |
| `sent_version` / `sent_at` stamps | EXISTING | written by `sendQuote` |
| Post-send waiting state | **NEW** *(surface)* | reads `quote.{sent_version, sent_at, sent_to, valid_until}` + feed count. No new fields — new surface. |
| Days-elapsed | DERIVED | `now - quote.sent_at` |
| Auto-logged `sent` feed entry | **NEW** | `quote_review_events` row, `type='sent'`, `system=true` |

## 3 · Client Review

| UI element | Source | Field / note |
|---|---|---|
| Feed entries | **NEW** | **`quote_review_events`** — `{id, quote_id, type, note, author_user_id, created_at, system}`. Append-only. |
| Event type chip | **NEW** | `quote_review_events.type` ∈ `responded` \| `asked` \| `revision_requested` \| `sent`(system) — **extensible enum** |
| Author | EXISTING | `users.name` via `author_user_id` |
| Timestamp | **NEW** | `quote_review_events.created_at` |
| Add-entry form | **NEW** | inserts one `quote_review_events` row |
| Empty state | DERIVED | `count = 0` |
| Inline "Revise" on a `revision_requested` entry | **NEW** *(affordance)* | triggers the Revise action (below) |
| "not customer-facing" rail copy | — | static |

## 4 · Revise + mismatch banner

| UI element | Source | Field / note |
|---|---|---|
| Revise action | **NEW** *(action)* | `quote.state` `sent` → `draft`; `draft_version = sent_version + 1`; **preserves** notes, associations, cost data, feed. Same `quote_id`, same `quote_number`. |
| Mismatch banner visibility | DERIVED | `quote.draft_version > quote.sent_version AND quote.state = 'sent'` |
| Banner copy (v3 / date / v4) | EXISTING | `quote.{sent_version, sent_at, draft_version}` |
| "View sent version" | EXISTING | version snapshot render |
| "Compare v3 ↔ v4" | **NEW** *(view)* | diff of two version snapshots — flag as its own scope item |
| Customer-facing label "revised quote DPS-2418" | EXISTING | `quote.quote_number` (never changes) |

## 5 · Mark Accepted

| UI element | Source | Field / note |
|---|---|---|
| "Recording against v3" | EXISTING | `quote.sent_version` — acceptance always binds the sent version |
| Customer tier signal + provenance | **NEW** | `quote.customer_signal_tier_id` + source ref into `quote_review_events` |
| Accepted-by | EXISTING | current `user_id` (PM proxy) |
| Record-acceptance action | EXISTING | `quote.state` `sent` → `accepted`; stamps `accepted_at`, `accepted_by` |
| HubSpot push (pushing/ok/error) | EXISTING | one push at acceptance: deal stage `Quote Sent` → **`Closed Won`**, amount = selected turnkey total |
| Push failure copy | DERIVED | integration error; **`quote.state` unchanged** on failure |
| Rollback to Send to Client | **NEW** *(action)* | `accepted` → `sent`; reverses HubSpot stage; leaves `quote_review_events` intact |

## 6 · Tier Selection (the lock)

| UI element | Source | Field / note |
|---|---|---|
| Per-tier compliance rows | REUSED | Pricing per-tier block — `{label, qty, unit_price, turnkey_total, margin_pct, status}`, read-only here |
| Turnkey total per tier | REUSED | Pricing rollup (sell-side; allocated fees folded, pass-through freight excluded — per the PDF Addendum-1 rule) |
| Margin status | REUSED | vs `firm_policy.{target_pct, floor_pct}` (R5) |
| Default selection | **NEW** | pre-filled from `quote.customer_signal_tier_id`; PM override allowed |
| ★ recommended | EXISTING | `tier.recommended` |
| Below-floor block + override | EXISTING | R5 firm-policy gate + admin-override path |
| Finalization modal consequences | DERIVED | names the SO push, `state → complete`, umbrella read-only, Revise disabled |
| Typed `FINALIZE` gate | — | UI-only |
| NetSuite push | **NEW** | creates SO, status **`Pending Fulfillment`**; stores **`netsuite_so_id`** + `pushed_at` |
| Push failure copy | DERIVED | no SO created; `state` still `accepted`, still reversible |
| SO confirmation + link | **NEW** | `netsuite_so_id`, deep link |

## 7 · Post-Complete (Pattern 52)

| UI element | Source | Field / note |
|---|---|---|
| Locked ribbon (SO id, finalized-by, timestamp) | **NEW** | `netsuite_so_id`, `completed_by`, `completed_at` |
| Final-record rows | EXISTING | accepted tier, turnkey total, accepted version, HubSpot stage/amount |
| Review log (read-only) | **NEW** | `quote_review_events`, retained |
| All sub-tabs read-only / Revise disabled | DERIVED | `quote.state = 'complete'` |
| Request unlock (admin) | EXISTING | admin unlock + reason, audit-logged (R5 pattern) |

---

## NEW items summary — for Architect §0.5 round 2

1. **`quote_review_events`** table — `{id, quote_id, type, note, author_user_id, created_at, system}`; append-only; extensible `type` enum (`responded`, `asked`, `revision_requested`, `sent`).
2. **`netsuite_so_id`** (+ `pushed_at`, `completed_by`, `completed_at`) on the quote.
3. **`customer_signal_tier_id`** on the quote (+ provenance ref into the feed).
4. **Version chain exposure** — snapshots exist; the picker needs `{version_number, status, created_at, note, total}` queryable per quote.
5. **Reversibility guards** — `sent → draft` (Revise), `accepted → sent` (rollback), and a hard stop on any transition out of `complete` without admin approval.
6. **Mismatch derivation** — `draft_version > sent_version AND state='sent'` (no stored flag; derive).
7. **Version diff view** (`Compare v3 ↔ v4`) — flagged as its own scope item, not assumed.

**Sequencing note (brief §5):** the turnkey totals shown in Tier Selection depend on
Slice 11 F1.5 service-fee/freight wiring (currently stubbed). Tier Selection ships
with F1.5, per CA's note — design is complete either way.

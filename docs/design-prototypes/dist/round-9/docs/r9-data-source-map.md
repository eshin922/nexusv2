# Round 9 — Acceptance & Sales Order ceremony · Data-source map

Covers sub-tabs **4 and 5** only. Sub-tabs 1–3 are unchanged — see
`docs/r8-data-source-map.md`, which remains authoritative for them.

**Legend:** `EXISTING` = in schema / shipped · **`NEW`** = must be created ·
`CHANGED` = exists but semantics or timing change in R9 · `REUSED` = shipped component's
data, framed here · `DERIVED` = computed · `PROTO` = prototype-only, strip in production.

**Column names are canonical from `schema.ts`.** Where a name is not yet confirmed it is
marked *(name TBC)* rather than coined — a coined name reads as a new-column request.

Prototype fixtures: `app/r9/data.js` (`window.NXR9`, extends `window.NXR8`). Fixture keys
are prototype shorthand; the canonical column for each is given in the tables below.

---

## Sub-tab 4 · Acceptance (the capture)

| UI element | Source | Field / note |
|---|---|---|
| "Acceptance of DPS-2418 v3" header | EXISTING | `quote.quote_number`, `quote.sent_version`, `quote.sent_at` — acceptance always binds the **sent** version |
| "Their words" quote block | EXISTING | **`quote_review_events.note`** — written as a second, PM-authored row alongside the system row. Pre-filled from the most recent `type='responded'` entry. Editable. Survives rollback and revise. |
| Prefill provenance line | DERIVED | `quote_review_events.id` + `created_at` of the source entry |
| Tier chips (T1–T4) | REUSED | Pricing per-tier block — `{label, qty, unit_price, turnkey_total, margin_pct, status}` |
| `named` marker on a chip | EXISTING | matches `customer_accepted_tier_id` as first captured |
| Below-floor chip disabled | EXISTING | `status='below_floor'` vs `firm_policy.floor_pct` (R5) |
| Source-of-acceptance control | **NEW** | **`customer_response_channel`** enum ∈ `email` \| `call` \| `portal` \| `other` — *how the customer communicated*. Distinct from the existing `accept_source` (`manual_button`/`hubspot_stage_change`/`api`), which records *how Nexus captured it*. Orthogonal; do not merge. |
| **Record acceptance** action | CHANGED | R8 recorded acceptance alone. R9 writes acceptance **and** the tier choice in one act: sets `quote.state` `sent`→`accepted`, stamps `accepted_at`/`accepted_by`, and writes **`customer_accepted_tier_id`**. `accepted_tier_id` stays NULL until the order is sent. |
| HubSpot push (pushing / ok / error) | EXISTING | one push, at acceptance: deal stage → **`Closed Won`**, amount = selected tier's turnkey total |
| HubSpot error panel | EXISTING | integration error; **`quote.state` unchanged (`sent`)** — stated on the surface |
| `Now · HubSpot` / `Later · NetSuite` cards | DERIVED | static model statement + `hubspot.{from_stage,to_stage,amount}` |
| Recorded-state handoff panel | DERIVED | `customer_accepted_tier_id` + HubSpot result |
| Advance label `Review Sales Order · T2 →` | DERIVED | names the carried tier — **no auto-navigation** |
| Rollback to Send to Client | EXISTING | `accepted`→`sent`; reverses HubSpot stage; clears `accepted_tier_id`, **leaves `customer_accepted_tier_id` intact** (schema default — `SET NULL` / `RESTRICT` FK asymmetry) |
| Revise | EXISTING | rolls acceptance back, then `sent`→`draft` as `draft_version+1`; same `quote_id` / `quote_number` |

## Sub-tab 5 · Sales Order (the lock)

Renamed from "Tier Selection" (R9.1). One layout, three states: `pending` · `failed` · `record`.
The same fields render in all three — only the header stamp and the status ledger change.

### Receipt — header & meta

| UI element | Source | Field / note |
|---|---|---|
| Customer + tier + unit counts | **NEW** | `customer_accepted_tier_id` (choice) + Pricing tier row |
| "against DPS-2418 v3 · accepted …" | EXISTING | `quote.{quote_number, sent_version}` + `quotes.accepted_at` |
| Header stamp | **NEW** | `netsuite_so_id` + `pushed_at` when placed; literal "no order number yet" before |
| **NetSuite account** | **NEW** | `sales_order.netsuite_customer.{id, name, matched, matched_on}` — resolved from the HubSpot company ID |
| `✓ matched` chip / unconfirmed flag | **NEW** | `netsuite_customer.matched` — `false` raises the unconfirmed-mapping flag |
| Ship to | EXISTING | project ship-to address |
| Terms / Incoterms | EXISTING | `quote.payment_terms`, `quote.incoterms_*` (same fields the customer PDF renders) |
| Requested ship | **NEW** | `sales_order.requested_ship` |

### Receipt — lines & totals

| UI element | Source | Field / note |
|---|---|---|
| Product lines (code, name, pack, qty, unit, extended) | REUSED | quote line items at the committed tier — same rows the customer PDF prints |
| Extended amount | DERIVED | `qty × unit` |
| One-time charges | REUSED | allocated/bundled service fees (Slice 11 F1.5) |
| Product subtotal / one-time / **order total** | DERIVED | subtotal + one-time = **must reconcile to the tier's turnkey total and to `hubspot.amount`** |
| Pre-send flags | **NEW** | `so_flags[]` — `below_floor` (from R5 firm policy) and `unmatched` (from `netsuite_customer.matched`) |

### Receipt — status ledger (the "not yet" strip)

| Row | Source | pending / failed / record |
|---|---|---|
| HubSpot | EXISTING | `✓ done at acceptance` in **all three** — never re-pushed from this tab |
| NetSuite | **NEW** | `not yet` → `failed` → `created` + `netsuite_so_id` |
| Quote | DERIVED | `not yet` → `not yet` → `locked` (`quote.state='complete'`) |

### State-specific

| UI element | Source | Field / note |
|---|---|---|
| Provenance line | EXISTING | `quotes.{accepted_at, accepted_by}` + the source `quote_review_events` row |
| Override disclosure | DERIVED | committing an `accepted_tier_id` ≠ `customer_accepted_tier_id`. The divergence between the two columns **is** the override record — no `overridden_from` field needed. |
| Below-floor block | EXISTING | R5 firm-policy gate |
| **Send order** action | **NEW** | pushes the NetSuite SO; writes `accepted_tier_id` (commitment), sets `quote.state` `accepted`→`complete`; stores `netsuite_so_id`, `pushed_at`, `completed_by`, `completed_at` |
| Confirm modal | — | UI-only. **No typed gate** (dropped R9.1 — see designer notes §R9.1-3) |
| Failed split banner · "still true" half | EXISTING | `hubspot.{to_stage, amount}` + `quote.state='accepted'` |
| Failed split banner · "did not happen" half | **NEW** | `failures.netsuite.{code, detail, at, attempts}` — error must persist on the tab, not in a modal |
| Retry | **NEW** | re-runs the SO push; idempotency key required so a retry can't double-create |
| Locked ribbon + read-only note | DERIVED | `quote.state='complete'` |
| Request unlock (admin) | EXISTING | admin unlock + reason, audit-logged (R5) |

---

## NEW / CHANGED summary — for Architect

1. **Tier choice / commitment — no schema change.** Confirmed with Architect: the split maps onto existing columns.
   **Choice** → `customer_accepted_tier_id` (written at acceptance). **Commitment** → `accepted_tier_id` (written at the NetSuite push).
   The `intent` / `committed` distinction is **derived from which column is populated**, not stored. The Step-3 FK asymmetry — `SET NULL` on `customer_accepted_tier_id`, `RESTRICT` on `accepted_tier_id` — already encodes exactly this behaviour.
2. **`customer_response_channel`** *(NEW — the only new column in the design)* — enum `email`|`call`|`portal`|`other`. Records **how the customer communicated**. Cannot reuse `accept_source`, which records **how Nexus captured it** (`manual_button`/`hubspot_stage_change`/`api`) — orthogonal semantics; merging breaks both.
   The acceptance **note** reuses `quote_review_events.note` as a second PM-authored row. No `quote_acceptance` table.
3. **Record-acceptance is external-first, then transactional** *(CHANGED)* — the HubSpot push fires **outside and before** the DB transaction; the transaction runs only on push success and writes acceptance + `customer_accepted_tier_id` together. Push fails → transaction never runs → nothing written, `quote.state` stays `sent`. (No network call inside a DB transaction.)
4. **`netsuite_so_id`** (+ `pushed_at`, `completed_by`, `completed_at`) — as per R8 map, now written from sub-tab 5's send. *(Name TBC against schema.ts.)*
5. ~~Rollback preserves the captured tier~~ — **already satisfied.** Rollback clears `accepted_tier_id` and leaves `customer_accepted_tier_id` intact by schema default. No change required.
6. **Override needs no field** *(RESOLVED)* — an `accepted_tier_id` that differs from `customer_accepted_tier_id` **is** the override record. Log the actor in the existing audit trail; no `overridden_from` column.
7. ~~Supersedes `customer_signal_tier_id`~~ — **withdrawn.** That name was our notation for `customer_accepted_tier_id`; it does not exist in `schema.ts`. Nothing to migrate or drop.

**Guards to enforce (reversibility model):**
`sent→draft` (revise) · `accepted→sent` (rollback — clears `accepted_tier_id`, keeps `customer_accepted_tier_id`) ·
`accepted→complete` **only** via the NetSuite push · **no** transition out of `complete`
without admin approval · HubSpot pushes exactly once, at acceptance, never from sub-tab 5 ·
**SO push must be idempotent** (retry after a timeout cannot double-create an order).

### R9.1 additions

8. **`sales_order` / `netsuite_customer`** *(external)* — `{netsuite_customer: {id, name, matched, matched_on}, ship_to, terms, incoterms, requested_ship}`. Not a schema question: whether leaf SKUs and customers exist in NetSuite, and how they're matched, sits in the **NetSuite readiness workstream**.
9. **`so_flags`** *(NEW, derived)* — pre-send blockers/warnings: `below_floor` (R5 policy) and `unmatched` (NetSuite account not confirmed). Empty array = clean receipt.
10. **Order total reconciliation** — the receipt's `subtotal + one_time` **must** equal the tier's turnkey total and the amount already pushed to HubSpot. If they can diverge, that divergence needs its own flag; a receipt that disagrees with the CRM is worse than no receipt.
11. **Retry idempotency key** on the SO push (see guards).
12. **Tab labels** *(config)* — sub-tab 4 `Mark Accepted` → **`Acceptance`**; sub-tab 5 `Tier Selection` → **`Sales Order`**. String changes only.

**Net schema impact:** one new column (`customer_response_channel`). Tier columns unchanged;
no `quote_acceptance` table; no `overridden_from`.

**Sequencing note:** turnkey totals shown in both sub-tabs depend on Slice 11 F1.5
service-fee/freight wiring (currently stubbed) — same dependency flagged in the R8 map.

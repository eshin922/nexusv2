# RI.7 brief amendment

**Status:** Draft for PM review. Independent subscopes settle here;
state-machine-dependent subscopes resolve after `docs/ri7-state-machine.md`
(CR-SM) decisions land.

**Companion doc:** `docs/ri7-state-machine.md` (CR-SM). Subscopes
marked **Subject to CR-SM** below depend on resolutions in that doc.

**Base brief:** `docs/redesign-implementation-slice-brief.md`
sections 3.10 (Firm settings), 3.11 (Markup defaults), 3.12 (Audit
log read view). This amendment **adds** scope to §3.10; §3.11 and
§3.12 are unaffected.

---

## 0. Frame

The redesign-implementation slice brief lands RI.7 as "admin pages
(firm settings + markup defaults + audit log read view)" with §3.10's
firm settings page scoped to two-state target/floor margin policy
editing (per Round 5). During RI.6 implementation, several subscopes
surfaced that need to live in firm_settings but weren't in the
original §3.10:

- Vendor identity (firm name, tagline, address) — for customer-facing
  PDF header. Currently hardcoded fixture in
  `src/lib/customer-view-fixtures.ts`.
- Customer-facing PDF text (T&Cs, payment terms, lead time, incoterms,
  days valid) — currently stubbed.
- Quote-number prefix — admin-configurable string for the customer-facing
  quote identifier.
- PreparedBy contact derivation — per-deal data via HubSpot owner, not
  firm-level (already logged in RI.6 UX_BACKLOG as RI.7 work).

This amendment captures those. Most settle independently of CR-SM;
a few are state-machine-dependent and resolve after CR-SM.

---

## 1. New subscopes added to §3.10 Firm settings

### 3.10.a Vendor identity columns

**Independent of CR-SM.** Ready to scope and ship.

**What:** Promote `VENDOR_FIXTURE` from
`src/lib/customer-view-fixtures.ts` to firm_settings columns.

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN vendor_name text;
ALTER TABLE firm_settings ADD COLUMN vendor_tagline text;
ALTER TABLE firm_settings ADD COLUMN vendor_address text;
```

NULL on existing rows; back-fill The DPS values via seed migration:
- vendor_name: `The DPS`
- vendor_tagline: `Turnkey product development & manufacturing for beauty, health & wellness brands`
- vendor_address: `3943 Irvine Blvd, #1129 Irvine, CA 92602`

**Read path:** `getFirmSettings()` returns vendor block; falls back
to `VENDOR_FIXTURE` constant when columns are NULL (graceful
degradation; constant stays in code as fallback).

**UI:** new "Vendor identity" card in firm-settings admin page.
Three text inputs (name / tagline / address-multiline), inline-edit
pattern matching brief §3.11 markup-defaults table inline edit. Save
writes new firm_settings row per the versioning pattern (brief §3.10
`effective_from / effective_until`).

**Surface separation:** Vendor identity is firm-level, not per-quote.
It's customer-visible (appears in PdfHeader). Single-tenant v1 scope.

### 3.10.b Quote-number prefix

**Subject to CR-SM (DEC-4).** Scope settles after CR-SM resolves
when quote-number gets assigned (recommendation: on send).

**What:** Admin-configurable prefix for the customer-facing quote
identifier. Final format `{prefix}-{counter}` where counter is a
per-firm monotonic integer (sequence in DB).

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN quote_number_prefix text;
-- DPS seed value: TBD — PM call. Suggestion: "DPS"
```

**UI:** single text input in firm-settings vendor card (paired with
vendor identity since both establish "how quotes identify The DPS").
Inline preview: "Next quote will be numbered DPS-1042".

**Counter:**
```sql
CREATE SEQUENCE quote_number_seq START 1000;
```

Counter starts at 1000 so first quote reads `DPS-1000`, not
`DPS-1`. Chosen for psychological / customer-facing reasons (looks
established).

**Open PM question:** DPS prefix default. Suggestion `DPS`. PM call.

### 3.10.c T&Cs

**Subject to CR-SM (DEC-7).** Scope settles after CR-SM resolves
snapshot-on-send vs live-read.

**Recommendation under CR-SM DEC-7 = snapshot-on-send:**

**Schema (firm-level default):**
```sql
ALTER TABLE firm_settings ADD COLUMN tcs_default text;
```

**Schema (per-quote snapshot at send) — lives on quotes table:**
```sql
ALTER TABLE quotes ADD COLUMN tcs_snapshot text;
-- already in CR-SM §7 schema block
```

**UI:** large textarea in firm-settings admin (multi-paragraph T&Cs).
Per-quote override affordance on Costing Sheet (or wherever PM
customizes per-customer T&Cs — open question §5).

**DPS seed value:** TBD — PM provides T&Cs text. Likely a half-page
legal block; PM supplies the canonical version at amendment-resolution
time.

### 3.10.d Payment terms default

**Subject to CR-SM (DEC-7).** Same shape as 3.10.c.

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN payment_terms_default text;
ALTER TABLE quotes ADD COLUMN payment_terms_snapshot text;
-- snapshot column in CR-SM §7
```

**DPS seed value default:** TBD — PM call. Likely `Net 30` or
`50% deposit, 50% on shipment`. Render as single-line string in
customer view PdfTerms.

**UI:** single text input in firm-settings admin. Per-quote override
on Costing Sheet.

### 3.10.e Lead time default

**Subject to CR-SM (DEC-7).** Same shape as 3.10.c.

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN lead_time_default text;
ALTER TABLE quotes ADD COLUMN lead_time_snapshot text;
-- snapshot column in CR-SM §7
```

**DPS seed value default:** TBD — PM call. Likely
`8–12 weeks from confirmed PO`. Render as single-line string in PdfTerms.

### 3.10.f Incoterms default

**Subject to CR-SM (DEC-7).** Same shape as 3.10.c.

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN incoterms_default text;
ALTER TABLE quotes ADD COLUMN incoterms_snapshot text;
-- snapshot column in CR-SM §7
```

**Conditional render:** PdfTerms shows incoterms row only when
`freight_treatment = 'pass_through'` (existing R3 design). Snapshot
column still populates on every send — the conditional is render-time.

**DPS seed value default:** TBD — PM call. Likely `FOB Long Beach`.

### 3.10.g Days valid

**Independent of CR-SM** (the snapshot pattern is from CR-SM
DEC-7, but the firm-level default field itself is independent —
the *use* of it lives in DEC-7).

**What:** integer count of days from `sent_at` to `valid_until`.

**Schema:**
```sql
ALTER TABLE firm_settings ADD COLUMN days_valid_default integer;
ALTER TABLE quotes ADD COLUMN days_valid_snapshot integer;
-- snapshot column in CR-SM §7
```

**Derivation:** `valid_until = sent_at + days_valid_snapshot days`,
computed at send time and stored as `valid_until` (existing column).
Per-quote override available; PM might set 60 days for a strategic
customer when default is 30.

**DPS seed value default:** TBD — PM call. Likely `30` or `60`.

**UI:** number input in firm-settings admin.

### 3.10.h PreparedBy contact derivation

**Subject to CR-SM (DEC-8 + un-signed-in-rep refinement).**

**What:** Customer-facing PDF "Prepared by" contact (name / email /
phone) derives from the HubSpot deal owner (project's sales rep),
NOT a firm-level constant. Per-deal data. DEC-8 adds snapshot-at-send
so customer view rendering an already-sent quote never silently
updates if the rep changes after send.

**Resolution chain (live, for drafts):**
```
projects.sales_rep_user_id → users.id → users.name + users.email + users.phone
```

**Live vs snapshot read path (per CR-SM DEC-8):**
- `quote.status === 'draft'` → live resolution above; user-friendly
  fallback if `sales_rep_user_id IS NULL` (see edge case below)
- `quote.status === 'sent' | 'accepted' | 'superseded' | 'lost'` →
  render `prepared_by_name_snapshot` / `_email_snapshot` /
  `_phone_snapshot` directly from the quote row

**Scope:**

User-table extension:
```sql
ALTER TABLE users ADD COLUMN phone text;
```

**CORRECTION (May 2026, during implementation):** v1 of this
amendment assumed HubSpot's Owners API carries phone. **It doesn't**
— verified against `@hubspot/api-client`'s `PublicOwner` schema
(fields: firstName, lastName, email, id, userId, type, teams,
archived, createdAt, updatedAt; no phone). Phone is **manual admin
UI only**; no HubSpot sync extension. `findHubspotOwnerByEmail` +
`fetchOwnerDetails` stay name+email only (current behavior preserved).

**Admin user-management surface (new RI.7 scope):** per-user
inline-edit table on `/admin/users` (sub-section under admin nav)
with columns name / email / role / phone / actions. Edit mode
allows manual phone entry; save audit-logs with action
`user_phone_updated`. The same surface is the right home for any
future user-management work (role transitions, archival) so it's
not single-use scaffolding.

**Null-phone handling at customer view:** PdfHeader renders the
phone line ONLY when `prepared_by_phone_snapshot IS NOT NULL`. For
users without phone, the Prepared-by block shows name + email +
firm address (three lines instead of four). Customer view stays
valid; email is the canonical contact in CDM contracts.

Snapshot columns (per CR-SM DEC-8) land on `quotes`, not `users`:
```sql
ALTER TABLE quotes ADD COLUMN prepared_by_name_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_email_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_phone_snapshot text;
```

**Server helpers:**
- `getQuotePreparedByLive(quoteId)` — joins
  `projects.salesRepUserId → users`, returns
  `{ name, email, phone | null, derived_from: "users.id" | "hubspot_owner_id" | null }`.
  Used by `sendQuote` and by draft-status customer view renders.
- `getQuotePreparedBy(quoteId)` — switches on `quote.status`:
  draft → calls Live; sent+ → reads snapshot columns. This is the
  helper PdfHeader consumes; status-switching is invisible to the
  render path.

**Un-signed-in-rep edge case (refined under DEC-8):**

When `projects.sales_rep_user_id IS NULL` (sales rep hasn't signed
into Nexus yet), the live resolution chain breaks. Under DEC-8, this
shifts from a render-time problem to a SEND-time problem — the PDF
render path always reads the snapshot for sent+; live read only fires
for drafts.

**Decision: option (a) refined — one-shot HubSpot fetch at send.**

At send time:
1. Try `projects.salesRepUserId → users` join first; if present, use
   that (Nexus-resolved row, `derived_from = "users.id"`)
2. If `salesRepUserId IS NULL` but `projects.hubspotOwnerId IS NOT NULL`,
   one-shot HubSpot owners API fetch by owner ID; populate the snapshot
   columns from the response (`derived_from = "hubspot_owner_id"`)
3. If both are NULL (shouldn't happen — every imported deal carries
   `hubspot_owner_id`), error: refuse to send and surface "Deal owner
   could not be resolved; refresh deal context and retry."

**No TTL cache needed.** The HubSpot fetch is one-shot at send. Once
the snapshot lands, the customer view reads it forever. The TTL-cache
recommendation from RI.6 UX_BACKLOG was based on render-time fetching;
DEC-8 obviates that.

**For drafts** (`status === 'draft'`), the customer view renders
the live resolution. If `salesRepUserId IS NULL` AND `hubspotOwnerId
IS NOT NULL`, the draft customer view (which IS a preview-only
surface) does a one-shot fetch each render; if Edward wants this to be
faster, add a short TTL cache (5–15 min) keyed by `hubspot_owner_id`.
For v1, no cache — draft preview is a low-frequency operation; the
extra round trip is fine.

Admin manual phone-entry affordance per user stays in scope — even
when HubSpot owner record HAS a phone, it's often empty in practice
across The DPS's actual owner set.

---

## 2. New subscopes added to §3.10 — UI extensions to firm-settings page

The Round 5 firm-settings design covers target/floor margin only.
The new fields above need a UI surface.

**Recommendation:** add a second card below the margin policy card,
titled "Customer-facing defaults". Same read/edit two-state pattern
as the margin card.

**Read state — "Customer-facing defaults" card:**
- Vendor identity block: name (large) / tagline (italic) / address (small)
- Quote-number prefix preview: "Next: DPS-1042"
- Days valid: "30 days from send"
- Payment terms, lead time, incoterms: single-line each
- T&Cs: truncated preview ("First 200 chars … · Edit to see full")
- Re-band-preview equivalent: "This change will appear on N quotes you
  send going forward. Past sent quotes keep their snapshot." (matches
  the snapshot-on-send pattern from CR-SM DEC-7.)

**Edit state:** form inputs for each field. Save commits new
firm_settings row (versioning pattern from §3.10 brief).

**Audit log:** every change audit-logged. Action
`firm_settings_updated` (existing) with `diff_json` carrying the
changed fields.

---

## 3. Updates to §3.10 portfolio-effect strip

The §3.10 brief defines the portfolio-effect strip showing how target/
floor margin changes ripple to sent quotes ("14 ≥35% · 8 25-35% ·
2 <25%"). The new customer-facing-defaults card needs an analogous
"how does this change affect quotes" indicator.

**For snapshot-on-send fields (T&Cs, payment terms, lead time,
incoterms, days valid — plus PreparedBy contact per CR-SM DEC-8):**
by design, past sent quotes keep their snapshot — change has zero
retroactive effect. Strip reads:
"This change applies to draft quotes and future quotes sent after
saving. The N sent quotes you have today will keep their snapshot."

**For vendor identity (name / tagline / address):** these render on
every customer view PdfHeader at render time (no snapshot — they're
firm-level identity, not per-quote commercial terms). Strip reads:
"Changes apply immediately to all customer views — sent quotes
will render the new firm name when their customer view is opened
again."

Distinction matters: PMs need to understand which firm_settings
fields are snapshot-bound (commercial + PreparedBy contact) vs
live-rendered (firm identity).

---

## 4. Implementation impact summary

If recommendations on this amendment + CR-SM are accepted:

### Schema delta (cumulative)

```sql
-- firm_settings extensions (this amendment, independent of CR-SM)
ALTER TABLE firm_settings ADD COLUMN vendor_name text;
ALTER TABLE firm_settings ADD COLUMN vendor_tagline text;
ALTER TABLE firm_settings ADD COLUMN vendor_address text;
ALTER TABLE firm_settings ADD COLUMN quote_number_prefix text;
ALTER TABLE firm_settings ADD COLUMN tcs_default text;
ALTER TABLE firm_settings ADD COLUMN payment_terms_default text;
ALTER TABLE firm_settings ADD COLUMN lead_time_default text;
ALTER TABLE firm_settings ADD COLUMN incoterms_default text;
ALTER TABLE firm_settings ADD COLUMN days_valid_default integer;

-- users phone column (this amendment, independent of CR-SM)
ALTER TABLE users ADD COLUMN phone text;

-- quotes lifecycle / snapshot columns (CR-SM §7)
ALTER TABLE quotes ADD COLUMN customer_accepted_at timestamptz;
ALTER TABLE quotes ADD COLUMN customer_accepted_tier_id uuid REFERENCES quote_tiers(id);
ALTER TABLE quotes ADD COLUMN customer_accepted_recorded_by_user_id uuid REFERENCES users(id);
ALTER TABLE quotes ADD COLUMN quote_number text;
ALTER TABLE quotes ADD COLUMN payment_terms_snapshot text;
ALTER TABLE quotes ADD COLUMN lead_time_snapshot text;
ALTER TABLE quotes ADD COLUMN incoterms_snapshot text;
ALTER TABLE quotes ADD COLUMN tcs_snapshot text;
ALTER TABLE quotes ADD COLUMN days_valid_snapshot integer;

-- PreparedBy snapshot at send (CR-SM DEC-8)
ALTER TABLE quotes ADD COLUMN prepared_by_name_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_email_snapshot text;
ALTER TABLE quotes ADD COLUMN prepared_by_phone_snapshot text;

-- counter (single-tenant v1 — per CR-SM DEC-4, multi-tenant rework
-- when applicable)
CREATE SEQUENCE quote_number_seq START 1000;

-- DPS seed values (firm_settings + users) populated in this migration
```

Total: ~20 new columns + 1 sequence. Single RI.7 migration.

### HubSpot sync extension

**Scope deleted (May 2026 implementation correction):** Owners API
doesn't carry phone. `findHubspotOwnerByEmail` + `fetchOwnerDetails`
stay as-is (name + email). Phone source = manual admin UI only.

### Server actions (new)

- `updateFirmSettingsVendorIdentity({...})` — name/tagline/address
- `updateFirmSettingsCustomerDefaults({...})` — terms/lead time/etc.
- `updateUserPhone({ userId, phone })` — admin manual entry

Plus CR-SM actions (`sendQuote`, `recordCustomerAcceptance`,
`clearCustomerAcceptance`) which land via CR-SM resolution.

### UI surfaces

- Firm settings admin page: second card "Customer-facing defaults"
- Admin user management surface: phone entry affordance per user row
- Customer view PdfHeader: real PreparedBy resolution +
  `.pdf-stub` dropped on quote-number
- Customer view PdfTerms: real payment terms / lead time / incoterms /
  valid_until, `.pdf-stub` dropped

---

## 5. PM answers (resolved post-Edward review, May 2026)

Independent-of-CR-SM resolutions:

1. **DPS quote-number prefix.** Resolved: `DPS`. Format `DPS-1000`,
   `DPS-1001`, ... Counter starts at 1000.
2. **DPS T&Cs canonical text.** **OPEN — kickoff path (b) approved.**
   RI.7 implementation kicks off without canonical T&Cs text. Schema
   migration lands with `tcs_default` NULL on existing firm_settings
   rows; customer view PdfTerms renders `{tcs-pending}` stub for sent
   quotes (consistent with the visible-synthetic discipline from
   RI.6). Edward chases canonical text in parallel with build; small
   UPDATE patch when text arrives.

   **Hold gate (release-time, not kickoff-time):** T&Cs canonical text
   MUST land before RI.7's PR opens to main. The `{tcs-pending}` stub
   is a build-time placeholder, NOT a ship-time state — production
   customer views cannot ship with stub legal text. Implementation
   completes against the stub; PR-to-main blocks on the T&Cs UPDATE.

   If T&Cs becomes a real blocker (build complete but Edward unable
   to source text), surface back for re-decision: either (i) defer
   the entire customer-view T&Cs rendering to a later slice and ship
   RI.7 without it, (ii) ship with a generic placeholder text that
   covers the legal minimum, or (iii) hold the PR.
3. **DPS payment terms default.** Resolved: `50% deposit, 50% on
   shipment`. Edward confirms based on actual customer cadence.
4. **DPS lead time default.** Resolved: `8–12 weeks from confirmed PO`.
5. **DPS incoterms default.** Resolved: `FOB Long Beach`. Edward
   confirms based on The DPS's actual freight origin port and customer
   mix; revise during RI.7 implementation if reality diverges.
6. **DPS days_valid default.** Resolved: `30` days.
7. **Per-quote override surface placement.** Resolved: **(a) Costing
   Sheet header** (adjacent to existing buttons). Workflow-proximity
   argument matches CR-SM DEC-2. (b) Setup not yet redesigned;
   (c) edit-in-preview adds complexity to customer-facing surface.

Subject-to-CR-SM resolutions (all endorsed, see CR-SM §6):

8. **DEC-1 through DEC-8** — all resolved per CR-SM §6. DEC-8 was
   added during Edward's review to capture PreparedBy snapshot-at-send;
   §3.10.h above refined accordingly.

---

## 6. Visual-grammar gap analysis (for CD R7 ask)

Per CR-SM §5, the state-machine work introduces zero new visual
grammar. This amendment's scope similarly checked:

| Surface added | Existing register? | New grammar? |
|---|---|---|
| Customer-facing defaults card on firm-settings | Round 5 firm-settings card pattern | ❌ no |
| Vendor identity block (name/tagline/address) on firm-settings | extends "current policy" card register | ❌ no |
| Quote-number prefix inline preview | text input + helper text (existing) | ❌ no |
| Per-quote override affordance on Costing Sheet (§5 Q7 → resolved (a)) | costing-page-head button cluster; existing register | ❌ no |
| Admin phone-edit affordance per user | brief §3.12 audit log has user-row patterns; extends | ❌ no |
| Snapshot-vs-live disclosure prose on firm-settings | extends portfolio-effect strip prose pattern | ❌ no |
| PreparedBy snapshot lock (no admin disclosure needed — it's per-quote, not firm-wide) | n/a — no UI surface | ❌ no |

**CD R7 ask: NOT NEEDED.** Both this amendment and CR-SM use existing
R3/R4/R5/R6 design vocabulary.

---

## 7. Sequencing within RI.7

If both this amendment + CR-SM resolve to recommended decisions:

1. **Migration + schema delta** (1 migration; all columns + sequence) — ✅ landed
2. **Server actions** (firm_settings updates + sendQuote +
   recordCustomerAcceptance + clearCustomerAcceptance +
   updateUserPhone) — ✅ landed
3. **Firm settings page extension** (Customer-facing defaults card,
   read + edit states) — ✅ landed
4. **Admin user-management surface** (`/admin/users` — per-user
   table, inline edit for phone, audit-logged via
   `user_phone_updated`) — ✅ landed
5. **Markup defaults page** (per base brief §3.11 — independent of
   this amendment) — ⏸ deferred to RI.8 polish (base brief scope;
   existing Slice 8 surface is functional; Round 5 visual rebuild
   queued)
6. **Audit log read view** (per base brief §3.12 — MVP + new-action
   renderers) — ✅ landed (MVP). Polish items (filters, cascade
   chips, time-grouped feed, CSV export, deep-link state) queued
   for RI.8 / UX_BACKLOG.
7. **Customer view PdfHeader + PdfTerms wiring** (drop `.pdf-stub`s
   when sent; render real values; null-phone conditional) — ✅ landed
8. **Costing Sheet customer-accept toggle** (CR-SM DEC-2) — ✅ landed
9. **Mark-Accepted page fifth sub-state (`awaitingMark`)** (CR-SM DEC-6) — ✅ landed
10. **Project Detail scenario card quote-number rendering** — ✅ landed
11. **Verifier script** (`scenario-quote-status-invariant.ts`) — ✅ landed
12. **Smoke + Designer audit pass** — Edward smoke pending

**Dev stub** (not in original sequence): a "Mark sent (dev — Slice 11
replaces)" affordance on the customer-view preview toolbar. Gated by
`NODE_ENV !== 'production'` AND admin role. Lets PMs/Edward exercise
sendQuote end-to-end without waiting for Slice 11's PDF + email
flow. Slice 11 replaces with the real flow on the Download buttons.

(HubSpot sync extension removed per implementation correction —
Owners API doesn't carry phone; manual admin UI is the sole source.)

Estimated work: brief base §8 had RI.7 at 3–4 days for §3.10–3.12
admin pages only. With this amendment + CR-SM additions, revise to
**6–8 days**. The expanded scope roughly doubles the slice; this
matches the magnitude of RI.4 / RI.5 sub-slices.

---

## 8. Decisions — status

- [x] CR-SM DEC-1 through DEC-8 (see `docs/ri7-state-machine.md` §8)
- [x] §5.1 quote-number prefix: `DPS`
- [ ] §5.2 DPS T&Cs canonical text — **OPEN**, PM provides separately;
      flagged as potential kickoff blocker (RI.7 can start without it
      but `tcs_default` column lands NULL)
- [x] §5.3 payment terms default: `50% deposit, 50% on shipment`
- [x] §5.4 lead time default: `8–12 weeks from confirmed PO`
- [x] §5.5 incoterms default: `FOB Long Beach`
- [x] §5.6 days_valid default: `30`
- [x] §5.7 per-quote override surface placement: (a) Costing Sheet header

**Kickoff path (b) approved.** RI.7 implementation starts without
§5.2 T&Cs canonical text. `tcs_default` lands NULL; PdfTerms renders
`{tcs-pending}` stub for sent quotes during build + PM smoke.

**Hold gate before PR-to-main:** T&Cs text must land. Stub is a
build-time placeholder, not a ship-time state. PR-to-main blocks
on the T&Cs UPDATE; build proceeds otherwise unblocked.

Brief sections 3.10.a through 3.10.h (+ CR-SM §7 schema) are concrete
and ready to build.

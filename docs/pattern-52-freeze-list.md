# Pattern 52 freeze list — canonical column inventory

Nexus v1 uses a **draft-lock** freeze model (Pattern 52 in CLAUDE.md)
instead of `effective_from` / `effective_until` versioning per column.
Reproducibility of sent / accepted / complete quote state is guaranteed
by CONVENTION: every mutation action calls a state guard that
fail-closes on the current status.

Convention doesn't fail when a future writer skips the check. This
document + the `assertNotFrozen` helper in
`src/lib/action-result.ts` make the convention enforceable.

## Freeze checkpoints

Slice 12's lifecycle draws THREE freeze checkpoints. Each moves a
set of columns from mutable to immutable-until-reopen.

### Checkpoint 1 — draft → sent (via `sendQuote`)

Guard: `assertDraft` (see [`src/lib/action-result.ts`](../src/lib/action-result.ts))
via 9 call sites in `src/app/actions/quotes.ts` + 7 in
`src/app/actions/assemblies.ts`. Also mirrored in `requireDraft`
(`src/lib/quote-guards.ts`) which the cost-input tree-resolvers call
after loading the quote.

Columns frozen at this checkpoint (17):

| Column | Notes |
|---|---|
| `status` | draft → sent flip; no path re-writes without status change |
| `sent_at` | timestamp of the send tx |
| `quote_number` | sequence-backed customer identifier |
| `valid_until` | quote validity window |
| `tcs_snapshot` | commercial snapshot (T&Cs) |
| `payment_terms_snapshot` | commercial snapshot |
| `lead_time_snapshot` | commercial snapshot |
| `incoterms_snapshot` | commercial snapshot |
| `days_valid_snapshot` | commercial snapshot |
| `prepared_by_name_snapshot` | PreparedBy person capture |
| `prepared_by_email_snapshot` | PreparedBy person capture |
| `prepared_by_phone_snapshot` | PreparedBy person capture |
| `pdf_layout_snapshot` | Slice 11 render axis |
| `detail_level_snapshot` | Slice 11 render axis |
| `include_spec_addendum_snapshot` | Slice 11 render axis |
| `customer_facing_notes_snapshot` | the customer note (G4 · M2 — see below) |
| `pdf_url` | persisted PDF signed URL |

Sibling table `quote_snapshots` mirrors these fields with per-version
history; each `sendQuote` INSERTs a fresh row keyed on
`(quote_id, version_number)`.

**`customer_facing_notes_snapshot` was the last customer-facing text to join
this list, added 2026-08-25 (migrations 0102 + 0103).** Every field beside it
resolved `isSent ? snapshot : live` while the note was read LIVE on sent
quotes, and nothing captured it in either store. So editing the note after send
restated a quote the customer already held — their copy and Nexus's simply
stopped agreeing, with nothing failing and nothing warning.

It is the clearest case for why this list is kept: the note had been outside it
for as long as it existed, and the omission was invisible from every direction
except comparing the field against its own neighbours.

`quotes.customer_facing_notes` remains the only place the note is AUTHORED. The
snapshot columns are the frozen copy, never a second author.

### `presentation_profile` — frozen by VERSION, not by column

The presentation profile (migration 0102) is a freeze-list member of a
different shape. It is not copied into a snapshot column; it is keyed
`(quote_id, quote_version)` and made immutable two ways at once:

- every writer goes through `quoteByIdDraft`, so a **sent** quote refuses
  profile edits outright — otherwise the record of what the customer saw would
  become editable after they saw it;
- `reviseQuote` copies the row forward to the new version inside the same
  transaction, and edits after that address the new version only. The prior
  version's row is never written through.

Any future writer of these tables must call `quoteByIdDraft` (or
`assertNotFrozen` at minimum) for the same reason. See
`src/app/actions/presentation-profile.ts`, which is the only writer today.

### Checkpoint 2 — sent → accepted (via `markAccepted`)

Guard: internal `quote.status !== "sent"` check in
`src/app/actions/quotes.ts:2034`. NOT via `assertDraft` (writes to a
sent quote, not draft).

Columns frozen at this checkpoint (7):

| Column | Notes |
|---|---|
| `status` | sent → accepted flip |
| `accepted_at` | timestamp of the accept tx |
| `accepted_by_user_id` | which PM recorded acceptance |
| `accept_source` | 'manual_button' (v1 only value) |
| `customer_accepted_tier_id` | which tier the customer named |
| `customer_response_channel` | 'email' | 'call' | 'portal' | 'other' |
| `intent_note` / `customer_target_tier_label` | optional context |

Sibling: `recordCustomerAcceptance` writes
`customer_accepted_at` + `customer_accepted_tier_id` +
`customer_accepted_recorded_by_user_id` on **sent** quotes (a lighter
pre-accept capture path). Same columns; different action; different
status gate.

### Checkpoint 3 — accepted → complete (via `markComplete` freeze-tx)

Guard: internal `quote.status !== "accepted"` check in
`src/lib/netsuite/mark-complete.ts:109` + the single-writer
architectural invariant (nothing else in the codebase writes these
columns).

Columns frozen at this checkpoint (7):

| Column | Notes |
|---|---|
| `status` | accepted → complete flip |
| `accepted_tier_id` | FK `quote_tiers.id` ON DELETE RESTRICT; commits the tier that shipped |
| `netsuite_so_id` | NetSuite internal id |
| `netsuite_so_tranid` | NetSuite display tran-id (mirror) |
| `netsuite_pushed_at` | timestamp of the push |
| `netsuite_so_push_status` | 'succeeded' at freeze; 'failed' on error branch |
| `netsuite_so_push_error` | null at freeze; populated on error branch |

The `netsuite_so_pushes` sibling table holds the forensic retry
trail — every attempt (succeeded + failed) inserts a fresh row; the
partial unique index `WHERE status='succeeded'` enforces at-most-one
successful push per (quote, tier).

### Sibling table frozen at checkpoint 1 — `quote_charge_recovery`

Commercial recovery elections are per-quote ROWS rather than columns,
so they do not appear in the checkpoint-1 table above — but they carry
the same commitment and belong to the same checkpoint. They change what
the customer document says, and `sendQuote` mirrors them into
`quote_snapshot_charge_recovery` inside the send transaction so a sent
revision can never inherit a later revision's election.

| Table | Frozen at | Writer | Guard |
|---|---|---|---|
| `quote_charge_recovery` | draft → sent | `setChargeRecovery` (`src/app/actions/commercial-recovery.ts`) | `quoteByIdDraft` **and** `assertNotFrozen` |

The writer calls **both** guards. `quoteByIdDraft` is the stronger
condition and is the one that actually governs — an election is a
quote-authoring decision, and a sent revision must not have its
economics moved underneath it. `assertNotFrozen` is called as well
because the §0.5 protocol below is a grep for that symbol, and a writer
that satisfies the rule under a different name is invisible to the
check that exists to find it.

Absence of a row is load-bearing (no election → legacy per-assembly
resolution), so there is **no backfill** and every pre-existing quote
and snapshot resolves to the behaviour that produced it.

### Sibling table frozen at checkpoint 1 — `quote_snapshot_recovery_instructions`

The elections mirror above freezes **what the operator chose**. It cannot
be the accounting record, for a reason that is easy to miss and was
measured rather than assumed: **a legacy-placed charge has no election
row at all.** Across the ten live quotes carrying a one-time charge, the
projection emits **86 instructions and 0 of them are elected** — so a
freeze keyed on elections would record 0 of 86, and Accounting could not
distinguish *"amortized under legacy pricing, do not invoice separately"*
from *"this charge does not exist on the quote."*

So this table records the instruction for **every placed charge**, elected
or not, one row per (charge, owner, tier).

| Table | Frozen at | Writer | Guard |
|---|---|---|---|
| `quote_snapshot_recovery_instructions` | draft → sent | `sendQuote` (`src/app/actions/quotes.ts`), inside the send transaction | write-once by construction — inserted only at freeze, never updated |

Frozen per row: `treatment`, `treatment_source`, `cost`,
`governed_recovery`, `separate_invoice_amount`, `amortized_per_unit`,
`tier_quantity`.

Two encodings in it are load-bearing and must not be "tidied":

- **`separate_invoice_amount = 0` is the instruction, not an absence.** For
  an amortized charge it is exactly where the invoice line diverges from
  the recovery; collapsing the two would tell Accounting to bill a charge
  the customer already paid inside the rate.
- **`amortized_per_unit` is NULL for a legacy amortization.** A legacy
  allocated fee flows into the sell ladder, so the quote-level adjustment
  reaches it — measured, the customer pays `recovery x (1 + gpa)`: +280 at
  0.20 and +700 at 0.50 on a $1,400 recovery. There is no fixed per-unit
  figure to freeze, and freezing the governed $0.14 would put a number an
  accountant would act on beside a charge paid at $0.168. An **elected**
  amortization IS fixed, because the precedence adds it after the ladder —
  which is the accounting substance of electing.

Guard note: this table needs no `assertNotFrozen`. Every other Pattern 52
entry is a column on a mutable row that a later writer could reach; these
are insert-only rows on an immutable snapshot, so the invariant is
structural rather than conventional. If a future path ever updates one,
it inherits the full guard obligation.

## Total

**30 columns across the three checkpoints, plus the
`quote_charge_recovery` and `quote_snapshot_recovery_instructions`
sibling tables at checkpoint 1.**

## Guards — how to use

For any NEW writer action:

1. **If the write should ONLY happen on a draft quote** (packaging
   costs, tier config, notes, structural edits): call `assertDraft`.
   Same shape as every existing edit action.

2. **If the write COULD happen on a draft or sent quote** (rare —
   most non-lifecycle writers are draft-only): call `assertNotFrozen`.
   Rejects accepted/complete; permits draft + sent.

3. **If the write is a lifecycle transition itself** (send, accept,
   complete, unmark, revise): use a local `quote.status !== "<current>"`
   check. Lifecycle actions know the exact FROM state; no generic
   guard fits.

## Sanctioned reopen paths

Two paths legitimately move a quote OUT of accepted/complete status
back into an editable state. These do NOT call `assertNotFrozen`
because they handle their own state transitions:

- **`unmarkAccepted`** (`src/app/actions/quotes.ts:2404`) —
  accepted → sent. Rolls back the HubSpot stage push; leaves the
  `customer_accepted_*` columns in place (per Slice 12 Step 10 §0.5
  BANK item, this is a stale-data smell that Slice 13 admin surfaces
  need to be aware of).
- **`reviseFromAccepted`** (`src/app/actions/quotes.ts:1860`) —
  accepted → new draft version. Bumps `version_number`; the frozen
  snapshot columns above stay valid for the PRIOR version via
  `quote_snapshots`.

`markComplete → complete` has no reverse path in v1. Admin override
+ NetSuite SO cancellation are v1.5+ scope; see
[UX_BACKLOG](./UX_BACKLOG.md) entries.

## For Slice 13 §0.5

Slice 13 introduces admin surfaces (retry failed SO push, manual
overrides, reconcile jobs, etc.). Every admin action's §0.5
verification MUST include:

> **Does this write any column in the Pattern 52 freeze list above?**
>
> - If yes: the action calls `assertNotFrozen(quote)` at the top,
>   OR it is a sanctioned reopen path with explicit state-transition
>   handling.
> - If neither: CC surfaces the gap before implementation. Do NOT
>   ship the action.

The failure mode this prevents: an admin surface writes
`netsuite_so_push_error` on a complete quote to "clear a stale error
message," and silently corrupts the freeze-tx forensic record.

## Reference

- Guard code: [`src/lib/action-result.ts`](../src/lib/action-result.ts)
- Freeze-tx entry point: [`src/lib/netsuite/mark-complete.ts`](../src/lib/netsuite/mark-complete.ts) STEP 9
- Send-tx entry point: [`src/app/actions/quotes.ts`](../src/app/actions/quotes.ts) `sendQuote` (~line 1316)
- Accept-tx entry point: [`src/app/actions/quotes.ts`](../src/app/actions/quotes.ts) `markAccepted` (~line 1983)
- Pattern doctrine: `CLAUDE.md` "Pattern 52 — Snapshot-immutability via draft-lock"

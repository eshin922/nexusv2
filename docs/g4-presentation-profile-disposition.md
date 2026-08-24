# G4 · presentation profile — disposition before code

**Status: dispositioned, not implemented.** Edward, 2026-08-24.

Card 2 and Card 3 of the Customer View rail cannot be built truthfully without
a record for the presentation choices. This settles *which* record, because
four authorities describe it differently and picking the easiest to wire would
create the second source of truth this workstream has spent its length removing.

**Authority:** [`design-authority/customer-view/`](design-authority/customer-view/)
— `design/Nexus Customer View.dc.html` is the reference of record;
`docs/authority-model.md` is CP · Revision 1.

---

## 1 · The conflict, with its evidence

| | tiers shown | recommended tier | fee itemization | layout / detail |
|---|---|---|---|---|
| **Reference of record** — README state shape + `.dc.html` Card 2 | `shown: Record<tierId, boolean>` · a toggle per tier | `recTier: tierId`, held as Card 2 state | `include.feeLines` | `detail`, tier cards |
| **`authority-model.md` §6** (CP Rev 1) | **no column** | **no column** | `include_fee_lines` | `layout`, `presented_tier`, `detail_level` |
| **`quote-presentation-profile-brief.md`** (#326) | — | `featured_tier_id` | `fee_presentation` enum | `pdf_layout`, `detail_level` |
| **Nexus today** | — | **`quote_tiers.recommended`**, `schema.ts:762`, written with a `recommended_updated` audit row | derived from `hasCharges` | URL params + React context only |

Four descriptions, no two alike. The reference's UI shows controls CP Rev 1's
schema has no column for — the same shape as the freight-only conflict settled
as D1.

---

## 2 · Disposition

**Edward, 2026-08-24.** The split is by *what kind of fact each one is*:

> **Recommended tier — a quote fact.** Keep `quote_tiers.recommended`. Do not
> introduce a second presentation-only recommendation field. Card 2 authors and
> reads that existing governed fact through Customer View.
>
> **Tiers shown — a presentation fact.** Add explicit per-tier state to the
> presentation profile. Genuinely presentation-only, and the reference UI needs
> it.
>
> **Fee itemization — a presentation field**, modelled as the reference's
> customer-facing decision rather than by reusing the recovery election. It must
> remain revenue-neutral.
>
> **Shape / layout — presentation profile**, as already intended.

So: **recommendation is a quote fact; visibility, itemization and layout are
presentation facts.** Nothing is duplicated, and the fourth authority — the
column that already exists and already has an audit trail — wins for the one
thing it already owns.

---

## 3 · The resulting record

```
presentation_profile
  quote_id            fk        ┐ CP Rev 1 keys per VERSION, and reviseQuote
  quote_version       int       ┘ bumps version_number on the same row
  layout              enum  'tier_table' | 'single_tier'   default 'tier_table'
  presented_tier      fk?   required iff layout = 'single_tier'
  detail_level        enum  'itemized' | 'turnkey_only'    default 'itemized'
  include_fee_lines   bool  default true
  include_terms       bool  default true
  include_addendum    bool  default false
  include_note        bool  default true
  customer_note       text? max 400 — RETAINED when include_note = false
  updated_by / at

presentation_profile_tier          -- "tiers shown", the added presentation fact
  quote_id / quote_version  fk
  tier_id                   fk
  shown                     bool default true
```

Not in it, deliberately: no economic field, no term field, no identity field,
and **no recommendation** — that is `quote_tiers.recommended`.
*"The schema is the enforcement."*

---

## 4 · Three consequences that need deciding, not assuming

### C1 · Fee itemization is one careless step from omitting the fees

The authority is explicit that `include_fee_lines = false` **collapses the
disclosure and never removes the charge** — the fold sentence still states the
total, and `data-source-map.md` says the same: *"renders when the itemization is
off — the disclosure survives the toggle."*

So the field decides whether lines are **enumerated**, never whether the money
**exists**. "Hide the fee lines" and "omit the fees" are one edit apart, and the
second is a customer-facing misstatement.

**Proposed:** assert by falsification — for every value of `include_fee_lines`,
the printed total is identical and the fee total is disclosed somewhere on the
document. That is #326's boundary harness applied to one field, and it is the
only reason this field is safe to expose.

### C2 · A revision must inherit the profile, or it starts blank

`reviseQuote` bumps `version_number` **on the same quote row**. With the profile
keyed `(quote_id, quote_version)`, a revision silently gets no profile and the
surface falls back to defaults — an operator who revises a sent quote would lose
every presentation choice the customer has already seen.

#326 Q4 answers the intent (*inherit* — "a revision continues a conversation the
customer has already seen"), and CLAUDE.md's **versioned-table carry-forward
audit** is the standing pattern for exactly this failure: *"any time a new column
lands on a versioned table, search for every insert call site and verify each
carries forward unchanged columns."*

**Proposed:** `reviseQuote` seeds the new version's profile from the superseded
one, written in the same transaction as the version bump. Not a follow-up.

### C3 · Card 2 will write to two different owners

Under this disposition the recommended-tier control writes a **governed quote
fact** while every other control in the card writes **presentation state**. The
card must not present them as the same kind of act — that conflation is what
produced the original R5 error one level up.

The reference already has the vocabulary: Card 0 renders governed values with a
source tag and a route to the owning surface. The recommended-tier control is
the one place in Card 2 that touches a governed fact.

**For Edward:** should it carry its own provenance marker inside Card 2, or move
to Card 0 as a governed value that is editable there? The authority does not
answer it, because in the authority the recommendation was Card 2 state.

---

## 5 · What this unblocks, in order

1. **C1–C3 dispositioned** (C1 and C2 have proposals; C3 is open).
2. **Migration** — additive, defaults matching today's effective behaviour, so
   it may land before the code that reads it. No tightening, no deployed-writer
   proof needed.
3. **Backfill** — one row per draft quote at current defaults. Sent and later
   quotes read their snapshot, not the profile.
4. **Freeze list** — `docs/pattern-52-freeze-list.md` gains the profile at
   checkpoint 1. Q5's `assertNotSent` guard: a **sent** quote must refuse
   profile edits, or the record of what the customer saw becomes editable after
   they saw it.
5. **Card 2** — the real controls, replacing the paragraph that currently states
   their absence.
6. **Card 3** — *Customer received* becomes a projection of the profile, and the
   authored instruction gets its field.

Only after 5 and 6 is `FUNCTIONAL_FIDELITY` satisfiable, and only then does the
admin flag come off.

---

## 6 · Gate state

```
COMPOSITION_FIDELITY: VERIFIED
VISUAL_FIDELITY:      PENDING   — awaiting the zero-overflow closure measurement
FUNCTIONAL_FIDELITY:  PENDING   — Card 2 / Card 3
```

`VISUAL_FIDELITY` flips to `VERIFIED — existing capability set` when the closure
is measured on production, **with the scope qualifier written rather than
implied**: it will mean the implemented geometry is faithful, not that the cards
that do not exist yet are.

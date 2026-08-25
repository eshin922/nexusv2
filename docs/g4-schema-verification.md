# G4 · §0.5 schema verification — before any DDL

**Run 2026-08-24, against `3b9e743`.** Pattern 22 / Pattern 25: the pass runs
*before* the migration is written, so mismatches are dispositioned rather than
discovered mid-build.

Source under verification:
[`g4-presentation-profile-disposition.md`](g4-presentation-profile-disposition.md).

---

## Verified — exists exactly as claimed

| entity | claim | result |
|---|---|---|
| `quote_tiers.recommended` | `schema.ts:762`, boolean, audit `recommended_updated` | ✅ exact line |
| `quotes.version_number` | versioned on the quote row | ✅ `schema.ts:508` |
| `reviseQuote` | bumps `version_number` on the **same** row | ✅ `actions/quotes.ts:2217`, inside a `tx` — so C2's carry-forward has a transaction to join |
| `assertNotFrozen(quote)` | the Pattern 52 guard | ✅ `lib/action-result.ts:259` |
| `docs/pattern-52-freeze-list.md` | freeze inventory | ✅ exists, 30 columns |
| next migration index | — | **0102** (disposition names none, so no drift) |

**Reuse, do not re-create:** `pdf_layout` and `detail_level` already exist as
**pgEnums** (`schema.ts:304-305`) and are already used by `quotes.*_snapshot`
and `quote_snapshots`. The profile's `layout` / `detail_level` must reference
those types. Minting `presentation_layout` alongside them would give one
vocabulary two spellings — the failure this whole disposition is written to
avoid, reproduced at the type level.

---

## M1 · `presentation_profile.customer_note` duplicates an existing owner

**Needs disposition. Blocks the migration.**

The disposition's §3 record includes:

```
customer_note   text? max 400 — RETAINED when include_note = false
```

The reference describes that field as a Card 2 textarea, hard cap 400,
placeholder *"Printed verbatim above How to accept."*

That is not a new fact. It is `quotes.customer_facing_notes`, which:

- already exists (`schema.ts:553`);
- is already authored, via the Setup surface's `NotesEditor`;
- is already printed on the customer document **verbatim, immediately above
  How to accept** — verified in the Gate B transcription, where it renders as
  `.pp-notes` between the commercial terms and the acceptance block;
- is already read by both renderers from the projection.

Adding `customer_note` would give one printed sentence **two columns and two
authoring surfaces**, with nothing in the schema saying which one the customer
receives. That is the second-source-of-truth failure this workstream has spent
its length removing, and the disposition's own §2 method resolves it without
needing a new rule:

> recommendation is a **quote fact**; visibility is a **presentation fact**.

Applied here: the note's **content** is a quote fact — it is words the customer
receives. Whether it is **printed** is a presentation fact.

**Recommendation.** Drop `customer_note` from `presentation_profile`. Keep
`include_note`. Card 2's textarea writes `quotes.customer_facing_notes`, the
column that already owns it, exactly as Card 2's recommended-tier control
writes `quote_tiers.recommended` — the same C3 pattern, second instance, and it
strengthens rather than complicates the boundary:

```
note content, recommendation          → quote facts
visibility, itemization, layout, shape → versioned presentation_profile
```

The 400-char cap and the live counter are presentation concerns and can live in
Card 2 without a column. `NotesEditor` today imposes no cap — see M3.

---

## M2 · The customer note is not frozen, and every sibling is

**A defect, pre-existing, and M1 makes it reachable from Card 2.**

`customer-view-resolver.ts:389`:

```ts
customerFacingNotes: quote.customerFacingNotes,
```

No `isSent` branch — while every neighbouring commercial field has one:

```ts
paymentTerms = isSent ? … : …      // :168
leadTime     = isSent ? … : …      // :179
incoterms    = isSent ? … : …      // :182
tcs          = isSent ? quote.tcsSnapshot : (firm?.tcsDefault ?? null)   // :185
```

`quote_snapshots` captures `tcs`, `payment_terms`, `lead_time`, `incoterms`,
`days_valid`, the prepared-by identity and all three render axes. It does not
capture the customer note. The freeze list does not list it.

So **editing the customer note on a sent quote changes what that sent quote
says** — the preview, and any re-issued artifact, both move. The customer holds
one document; Nexus reports another. Nothing fails, nothing warns.

It is reachable today only from Setup. Give Card 2 a note editor and it becomes
reachable from the surface whose entire purpose is deciding what the customer
receives.

**Recommendation.** Close it as part of step 1's freeze contract: add
`customer_note` to `quote_snapshots`, populate it in the same transaction as the
other snapshot fields at send, and branch the resolver `isSent ? snapshot :
live` like its four siblings. Additive; no existing value changes; the only
behavioural change is that a **sent** quote stops following later edits, which
is the certified behaviour of every field beside it.

Flagged rather than assumed because it changes what a sent quote's document
prints. It touches the customer document only — the accepted-quote → Sales
Order projection is not involved.

---

## M3 · The 400-character cap does not exist anywhere

`NotesEditor` imposes no `maxLength`, and `customer_facing_notes` is `text`.
The reference specifies a hard 400 cap with a live `{n}/400` counter.

Not blocking, and **not** to be enforced at the column: existing notes may
already exceed it, and a NOT-VALID check on live data is a tightening migration
requiring a deployed-writer proof for no benefit. Enforce in Card 2's control,
where the reference puts it.

Recorded so the cap is a decision rather than an omission.

---

## M4 · Sent quotes: which record does the profile read from

**Resolved without disposition — recording the reasoning.**

The disposition says both *"sent and later quotes read their snapshot, not the
profile"* (§5.3) and *"a sent quote must refuse profile edits"* (§5.4). Taken
together those are two records for the same fact on a sent quote, which can
disagree.

Resolved toward the **existing certified grammar**: the profile owns draft
state; `sendQuote` copies it into `quote_snapshots` in the send transaction;
the resolver reads the snapshot when sent. That is exactly how `tcs`,
`payment_terms`, `lead_time` and `incoterms` already work, so it adds no new
architecture and leaves the certified sent-quote read path shape intact.

The §5.4 `assertNotSent` guard stays regardless — belt and braces, and it is
what keeps the profile row honest for the version the customer saw.

---

## Status

```
M1  BLOCKING   — needs Edward. Drop customer_note, or accept a second owner.
M2  BLOCKING-adjacent — a defect; recommend closing inside step 1's freeze contract.
M3  recorded   — enforce the cap in the control, not the column.
M4  resolved   — snapshot-on-send, per existing grammar.
```

No DDL written. Nothing migrated.

# Quote Presentation Profile / Customer View — design slice

**Design return only. No implementation, no NetSuite attachment path.**
Authored 2026-08-21 against `main` @ `f12cd95`.

Returns the four things asked for: the redesigned interaction model, the
proposed presentation-state schema, the SEND freeze boundary, and what
Accounting needs downstream.

---

## §0.5 · Verification before design (Pattern 22)

Every entity this design names, checked against `src/db/schema.ts` before a
line of DDL was proposed.

| entity | expected | actual |
|---|---|---|
| `quotes.pdf_layout` | live axis | **ABSENT** |
| `quotes.detail_level` | live axis | **ABSENT** |
| `quotes.include_spec_addendum` | live axis | **ABSENT** |
| `quote_snapshots.pdf_layout` / `detail_level` / `include_spec_addendum` | snapshot | PRESENT |
| `quotes.pdf_url` | artifact pointer | PRESENT |
| `quotes.customer_facing_notes` / `internal_notes` | notes | PRESENT |
| `quote_tiers.recommended` | recommendation pin | PRESENT |
| `quote_snapshot_artifacts` (OD-023) | render authority | PRESENT |
| NetSuite file-attachment path | — | **NONE EXISTS** |

---

## The finding that reshapes the slice

**The presentation profile has no draft home.** The three axes exist only as

1. React context (`QuoteAxisProvider`) — ephemeral,
2. URL search params on the preview iframe, and
3. `FormData` read at send time (`quotes.ts:1718-1720`).

There is no live column. An operator who sets Turnkey + single-tier + addendum
and reloads the page **loses all three silently**. The choices become durable
only at the instant of send, when they are written to `quote_snapshots`.

So this slice is not primarily a visual redesign. It is the creation of a
governed state layer that does not currently exist — the redesign is what that
state makes possible.

## Findings

| | finding | consequence |
|---|---|---|
| **F1** | Presentation state has no draft persistence | Choices lost on reload; no audit of what was chosen or by whom |
| **F2** | `single_tier` cannot name its tier — the renderer falls back to `recommendedTierIdx ?? 0` | "Selected tier" is not expressible. A quote with no recommendation silently prints the *first* tier as if chosen |
| **F3** | Fee presentation and quote-on-request visibility are **derived**, not controlled — from `hasCharges` and from the presence of unpriced lines | Two of the axes named as operator controls are not currently controls at all |
| **F4** | The PURE / PASS-THROUGH / PARTIAL switcher on the live preview is a documented cosmetic no-op | Dev scaffolding on an operator surface (Pattern 21) |
| **F5** | No accounting-instruction surface; no NetSuite attachment path | Layer 3 has no input and no output |

---

## Three layers, and the wall between them

### Layer 1 · Governed economics — read-only to this slice

Price, cost, margin, markup, quantity, accounting destination, NetSuite
projection. Owned by Pricing and Costs authority. This slice reads and never
writes.

### Layer 2 · Presentation profile — operator-controlled

Itemized vs Turnkey · all tiers vs featured tier · recommended tier ·
one-time-fee presentation · quote-on-request visibility · spec addendum ·
customer-facing notes.

### Layer 3 · Downstream accounting context — frozen record

The exact PDF the customer received, plus structured metadata describing what
they were shown and any operator instructions for Accounting.

### The boundary, stated so it can be falsified

> **Presentation may change arrangement, aggregation and inclusion. It may
> never change a value, and it may never change a total.**

An import ban would not express this — the render tree legitimately reads
governed figures; that is its job. The property is what matters, so assert the
property (Pattern 58's lesson, in a new medium):

```
for every presentation axis A, for every value v of A:
    P(v) = cpdf payload rendered under A=v
    N(v) = NetSuite line projection under A=v

assert  N(v)          identical across all v      -- projection is invariant
assert  total(P(v))   identical across all v      -- the total is invariant
assert  every figure printed in P(v) equals its governed value
```

The third assertion is the one that catches the subtle failure: a fold-fees
presentation legitimately changes the *printed unit price*, and is correct only
if the printed price still equals the governed per-unit figure for that
arrangement. Aggregation is permitted; misstatement is not.

**A control that would change the total is not a presentation control.** This
directly bounds the "quote-on-request visibility" axis: showing a line as *on
request* is presentation, because the total already excludes it. **Omitting the
line entirely is not**, because the customer then cannot see that something was
excluded. Recorded as **Q1** below.

---

## Interaction model

**The preview becomes the surface; controls become a panel beside it.**

Today the preview sits below three separate control clusters — a legacy
toolbar, a Detail dropdown, an addendum toggle — with the document pushed into
the lower half of the viewport at 880px.

Proposed:

- **Document dominant.** The PDF occupies the primary column at full height.
  With #323's sidebar change the viewer already fits at 100%; the 880px cap is
  now the binding constraint. Recommend `clamp(816px, 100%, 1200px)` — 816px is
  Letter at 96dpi and the floor below which the document re-compresses.
- **One Presentation panel**, grouped by what the reader of the PDF experiences:
  *Structure* (Itemized/Turnkey, tiers, featured tier) · *Disclosure* (fee
  presentation, on-request lines, addendum) · *Voice* (customer-facing notes).
- **Governed figures visually locked.** Any economic value surfaced in the panel
  renders in the read-only register with a lock affordance and a route to the
  surface that owns it. Nothing in this panel is an input to economics.
- **Accounting instructions in their own zone**, below the existing BOUNDARY
  GUARD rule, in a register that reads *not shown to the customer* — the surface
  already has this vocabulary and it should be reused, not reinvented.
- **Native PDF toolbar preserved.** Zoom, download and print stay the browser's.
- **Remove the PURE / PASS-THROUGH / PARTIAL switcher** (F4).

---

## Proposed schema

Two tables, deliberately not one. Layer 2 is customer-visible; layer 3 must
never reach the customer tree. Separating them makes the Pattern 45 boundary
**structural** — the customer-facing resolver simply never reads layer 3 —
rather than a rule someone has to remember.

```sql
CREATE TYPE fee_presentation AS ENUM ('fold', 'itemize');
CREATE TYPE unpriced_display AS ENUM ('on_request', 'omit');   -- see Q1

-- Layer 2 · customer-visible presentation choices
CREATE TABLE quote_presentation_profiles (
  quote_id               uuid PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  pdf_layout             pdf_layout       NOT NULL DEFAULT 'tier_table',
  detail_level           detail_level     NOT NULL DEFAULT 'itemized',
  include_spec_addendum  boolean          NOT NULL DEFAULT false,
  featured_tier_id       uuid,                                   -- F2
  fee_presentation       fee_presentation NOT NULL DEFAULT 'fold',
  unpriced_display       unpriced_display NOT NULL DEFAULT 'on_request',
  updated_at             timestamptz      NOT NULL DEFAULT now(),
  updated_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,

  -- A featured tier from ANOTHER quote is the failure a plain FK permits.
  -- The composite reference makes it unrepresentable rather than guarded.
  CONSTRAINT featured_tier_same_quote
    FOREIGN KEY (quote_id, featured_tier_id)
    REFERENCES quote_tiers (quote_id, id) ON DELETE SET NULL
);

-- Layer 3 · never rendered to the customer
CREATE TABLE quote_accounting_instructions (
  quote_id           uuid PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  instructions       text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
```

`quote_tiers` needs `UNIQUE (quote_id, id)` for the composite FK to resolve.
Verified: `quote_tiers.quote_id` exists; the unique is additive and safe.

**`fee_presentation` defaults to `fold`, not `auto`.** The present behaviour is
derivation from `hasCharges`, and preserving that as an `auto` value would keep
the derivation alive under a name that looks like a choice. Making it explicit
is the point of the layer.

### Migration posture

Every column above is additive with a NOT NULL default matching today's
effective behaviour, so the migration is **additive, not tightening** and may
land before the code that reads it. No `SET NOT NULL` on existing data, no
deployed-writer compatibility proof required. (The 0066 outage is the reason
this sentence is here.)

Backfill is one row per draft quote at current defaults — sent and later quotes
read their snapshot, not the profile.

---

## The SEND freeze boundary

**Checkpoint 1 (draft → sent) gains the profile.** The existing three axes
already freeze there; the new ones join them, and the freeze must be atomic
with the send transaction that writes `quote_snapshot_artifacts`.

**Where the frozen copy lives.** Extend `quote_snapshot_artifacts` with a
`presentation jsonb NOT NULL`, under the existing `schema_version` guard, rather
than adding columns to `quote_snapshots`.

OD-023 warns against a second copy that can disagree with the payload the
artifact rendered from. That warning applies to *header and party fields*, which
are recoverable from `cpdf_data`. The profile is different: it records what the
operator **chose**, which is not derivable from what was **rendered**. A payload
showing one tier cannot tell you whether the operator selected it or it was the
only tier. The two are complementary, and the rule that keeps them from
disagreeing is a division of authority, stated here so future readers inherit it:

> `cpdf_data` is authoritative for **what was shown**.
> `presentation` is authoritative for **what was chosen**.
> A historical render reads `cpdf_data`. An audit of operator intent reads
> `presentation`. Neither reconstructs the other.

**Guards.** Every writer of either new table calls a freeze guard. Note that
`assertNotFrozen` covers only `accepted` and `complete` — but a **sent** quote
must also refuse profile edits, or the record of what the customer saw becomes
editable after they saw it. The profile needs a sent-inclusive guard. Recorded
as **Q5**.

**Freeze-list maintenance.** `docs/pattern-52-freeze-list.md` moves from 30
columns to 30 + the profile payload. Not optional: that document is the
grep-able inventory the §0.5 protocol depends on.

**Revision.** The revise-in-place path seeds a fresh mutable profile from the
superseded snapshot's `presentation`, so a revision starts from what the
customer last saw rather than from defaults. Recorded as **Q4**.

---

## What Accounting needs downstream

*Design only — the attachment path is not implemented here.*

### 1 · The exact PDF

`quotes.pdf_url` is a **30-day signed URL**. That is adequate for an operator
link and inadequate for an accounting record, which must resolve years later.
The permanent storage path exists but is buried in
`audit_log.diff_json.pdf.storagePath`.

**Recommend promoting `storage_path` to a first-class column** on
`quote_snapshots`. An accounting record should not depend on a JSON traversal
into an audit row to find its own artifact. Recorded as **Q3**.

### 2 · Structured presentation metadata

What Accounting cannot reconstruct from the SO alone, and needs in order to
reconcile an invoice against what the customer was actually told:

| field | why Accounting needs it |
|---|---|
| detail level + layout | whether the customer saw line detail or a single turnkey figure |
| featured / accepted tier | which tier the printed price belongs to |
| fee presentation | whether one-time fees were folded into unit price or itemized — an invoice that itemizes what the quote folded reads as a new charge |
| freight treatment as printed | whether the customer was told freight is billed separately |
| on-request lines | which lines were quoted as pending, so a later invoice line is expected rather than a surprise |
| operator instructions | free-text context from the PM |
| artifact storage path | the durable key to the exact document |

### 3 · The contract any future attachment path must satisfy

Stated now so the future slice inherits constraints rather than rediscovering
them:

1. **Attach the stored bytes; never re-render.** A re-render at attach time can
   produce a document that differs from the one the customer received. The
   artifact is the record.
2. **Idempotent, keyed on `quote_snapshot_id`.** Retry must not produce two
   attachments, and "which one did the customer get" must keep having an answer.
3. **Non-blocking to the freeze transaction**, following the Amendment A
   precedent in `mark-complete.ts` — a file-cabinet failure must not roll back a
   Sales Order that NetSuite already created.
4. **Failure is recorded, not swallowed.** A missing attachment must be
   queryable, per the TODO-as-statement-of-intent lesson (Pattern 54) that cost
   us `netsuite_so_tranid`.

---

## Visual system · the banked glyph findings

From `docs/customer-pdf-glyph-coverage-gap.md` (#325), now in scope:

**Recommended-tier marker.** `U+2605` is absent from **both** vendored families,
so no `fontFamily` change fixes it. Ship the `<Svg><Path>` star the port plan
already anticipated (`customer-pdf-turnkey-summary.tsx:11`), as a shared
primitive used by all four star sites.

**Summary inclusion arrow.** `U+2192` is absent from Newsreader only, and
`tkInclTick` inherits `serif` from `tkIncl`. Adding `fontFamily: mono` fixes it
in one line — JetBrains Mono has the glyph. Prefer this over an Svg: it keeps
the tick as text and therefore selectable and searchable in the PDF.

**Prevention — `verify:pdf-glyph-coverage`.** Registration coverage and glyph
coverage are different properties and only the first is gated today. Proposed
verifier:

1. Extract string literals from `src/components/pdf/**`.
2. Resolve each literal's style chain to a font family (same text-parse shape
   `verify:font-register-coverage` already uses).
3. Read the family's `cmap` and fail the build on any codepoint above `U+00FF`
   absent from it.

Carry a **positive-control assertion** inside the verifier — a codepoint known
present must report present — so the check cannot silently degrade into one that
can only ever pass. That control is what turned up the arrow gap.

---

## Out of scope

No change to price, cost, margin, markup, quantity, accounting destination or
NetSuite projection. No NetSuite attachment implementation. No change to
Costs or Pricing authority. No re-derivation of governed figures.

## Open decisions

| | question | recommendation |
|---|---|---|
| **Q1** | May an operator omit an on-request line entirely, or only mark it *on request*? | **Mark only.** Omission hides that something was excluded, and the boundary rule forbids it |
| **Q2** | Free-text accounting instructions, or structured fields? | **Free text now**, structure later once real instructions exist to generalise from |
| **Q3** | Promote `storage_path` to a column in this slice or the NetSuite slice? | **This slice.** It is a record-durability fix independent of attachment |
| **Q4** | Does a revision inherit the prior profile or reset to defaults? | **Inherit.** A revision continues a conversation the customer has already seen |
| **Q5** | `assertNotFrozen` covers accepted + complete. Profile edits must also refuse on `sent`. New guard, or extend the existing one? | **New `assertNotSent`** — extending `assertNotFrozen` would silently tighten 30 existing columns |
| **Q6** | Role gating on the profile panel, or any PM? | **Any PM**, consistent with the affordance-not-architecture convention |

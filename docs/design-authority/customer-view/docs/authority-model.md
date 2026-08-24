# CP · Revision 1 — data authority, freeze record, and send capability

Interaction model approved. This revision fixes **who owns what**, what gets frozen, and
what the primary button is actually allowed to claim. No implementation in this pass.

*Revised in place per the freight-treatment disposition — see §1a and §2d.*

---

## 1 · The authority rule, stated once

> **This surface has exactly one write scope: the presentation profile — which carries both
> presentation choices and a bounded set of approved commercial elections — plus one
> instruction to Accounting. It has no authority over any governed cost, price, or identity.
> Everything else it displays is a read-only mirror of a governed record, labelled with the
> record it came from.** ← LOAD-BEARING

## 1a · Two classes of field, and the line between them

The earlier "presentation is economics-neutral" framing was too blunt to describe the
business. The real line is **authority over the cost** versus **authority over its recovery**:

| | Presentation choices | Commercial elections |
|---|---|---|
| Examples | layout, detail level, fee itemization, terms block, addendum, note | **freight treatment** |
| Changes what the customer sees | yes | yes |
| Changes the customer's numbers | **no** | **yes** — unit price and total move |
| Changes any governed cost | no | **no** |
| Is a commercial term | no | **yes** — binds, flows to Accounting, governs the invoice |
| Reversible after finalize | new version | new version |

> **The Presentation Profile may not touch a governed cost or price. It may select among
> pre-approved recovery policies for costs that are already governed.** Selecting a recovery
> shape is a commercial act; editing the cost is not available here at all. ← LOAD-BEARING

The two classes must not share visual treatment. Presentation choices live in the
*Presentation* card. Commercial elections get their own card, marked as binding, sitting
between governed pricing and presentation — the operator should never mistake one for the
other, and the finalize footer states the election explicitly.

Consequences, applied without exception:

| Domain | Owner | On this surface |
|---|---|---|
| Prices, margin, tier economics | Pricing (R12) | read-only mirror |
| Payment terms, deposit %, incoterms | Sales Order / commercial terms | read-only mirror |
| Invoice trigger | Sales Order | read-only mirror |
| Governed freight **cost** | Costs / Logistics | read-only mirror — not editable here, ever |
| **Freight recovery treatment** | **this surface** (bounded election) | **authored** — see §2d |
| Customer identity, bill-to, AP contact | Customer record | read-only mirror |
| **Presentation choices** | **this surface** | **authored** |
| **Instruction to Accounting** | **this surface** | **authored** |

The previous build let this page author `invoice_trigger` and `ap_contact` in
editable-looking fields. That made it a second authority for order configuration —
withdrawn. Editable chrome is reserved for what this surface owns: the presentation choices,
the freight election, and the instruction. Every mirrored value renders as flat text with a
source tag (`from Sales Order`, `from Pricing`, `from Costs`) and a link out to the owning
surface.

Payment terms, bill-to and customer identity, invoice trigger, deposit percentage and all
prices stay governed and read-only **unless separately dispositioned** — freight treatment is
an explicit, named exception, not a precedent.

**A read-only mirror with no source label is worse than no mirror** — the operator cannot
tell whether they are looking at authority or at a copy. Every mirrored value carries its
provenance inline.

## 2 · Downstream · Accounting — revised into three parts

The band keeps the internal-violet register and its scope line, and splits into three
visibly different things:

### 2a · Governed context — read-only, sourced

Payment terms · deposit basis · invoice trigger · freight treatment · bill-to. Flat text,
source tag per row, no input affordance, no border-box. Shown because the operator needs to
know what the customer's document is promising — not to change it.

**Deposit dollars are not computed here unless a governed accepted tier exists.** A
presentation tier is a display choice; multiplying a deposit percentage by it manufactures a
figure Accounting could act on. Two states:

- **No accepted tier** → `Deposit · 50% of accepted tier — resolves on acceptance`. No dollar
  amount, anywhere on the surface.
- **Accepted tier exists** → `Deposit · 50% · $20,275` with `from Sales Order · accepted Tier 2`
  as its source tag. The number is the order's, mirrored.

> **A presentation choice must never be the operand of a downstream money calculation.** ←
> LOAD-BEARING

### 2b · Instruction to Accounting — the one authored field

Free text, authored here, travels with the handoff. Unchanged in role, now visually the only
input in the band. Its helper states the two facts that matter: *travels with the frozen
presentation record; changes nothing about the order.*

### 2c · Customer received — derived, read-only

New. A plain-language statement of what the customer's copy actually contained, derived
entirely from the presentation profile — the thing Accounting cannot reconstruct from the
order and currently asks the PM by email:

```
Customer received
  Shape           Itemized · per-unit and extended, line by line
  Tiers shown     Tier 1 · Tier 2 · Tier 3
  Highlighted     Tier 2 (recommended)
  One-time fees   itemized — 3 lines, $4,850
  Terms           shown on the document
  Addendum        not included
  Customer note   included (printed above How to accept)
```

Seven rows, one per profile field, each stating the *outcome* not the flag. Withheld/absent
states are stated positively and specifically — `collapsed to one line ($4,850 disclosed in
total)`, `sent separately — not on the document`, `written but withheld` — because "off" is
useless to a reader who was not there. Derived at render, never stored as prose.

## 3 · The frozen presentation record

The exact artifact is part of the record, not a re-render.

> **On finalization the surface freezes: the presentation profile, the customer note verbatim,
> the rendered PDF as a stored artifact with a content hash and page count, and the
> instruction to Accounting. The record is immutable and version-bound.** ← LOAD-BEARING

Why the artifact and not the profile alone: a re-render six months later resolves against
whatever the templates and terms say then. The customer's copy is a fact about the past.

**NetSuite handoff, when it lands, attaches the stored artifact plus the instruction and the
derived summary metadata. It writes nothing economic** — no price, no term, no trigger. The
handoff is an attachment and a note, and the schema below is shaped so it cannot be anything
else: no economic field is writable from this side.

Changing any profile field after finalization does not mutate the record — it opens a new
draft profile against a new version, exactly as the send state already says (*changes create
v2*). One version, one frozen record, one artifact.

## 4 · Finalize ≠ email

The current lifecycle owns generating and freezing. It does **not** own SMTP, and R3 settled
this already: `↓ Download PDF` and `↳ Download + open mail draft` (mailto:) — no SMTP, no
OAuth, no delivery receipt. Nothing has changed that.

So the primary act is renamed to what it does, and delivery is **recorded, not asserted**:

| State | Chip | Primary act | Secondary |
|---|---|---|---|
| Draft | `DRAFT · NOT FINALIZED` | **Finalize presentation** | ⤓ PDF (unfrozen draft, watermark-free but marked `draft`) |
| Finalized, not delivered | `FINALIZED · v1 · NOT SENT` | **Download + open mail draft** | ⤓ PDF · Mark as delivered · Start v2 |
| Delivered | `DELIVERED · v1` | — | ⤓ PDF (the frozen artifact) · Start v2 |

- **Finalize** freezes the record and produces the artifact. This the surface owns.
- **Delivery** is an operator statement (`Mark as delivered` — records who, when, and the
  channel they used), or, if a mail integration ever lands, a system-recorded event. Until
  then the surface says *not sent* and never claims otherwise.
- Downloading the frozen artifact is not delivery and does not change state.

> **Never let a button imply an act the system does not perform.** The old `Send to customer`
> claimed an outbound email Nexus does not send; a PM who trusts it stops checking their
> outbox. ← LOAD-BEARING

The readiness list stays, minus the accounting-instruction line's soft warning being framed
as blocking, and gains one line: `Delivery is manual — Nexus does not email the customer.`
Stated at the button, not in a help doc.

## 5 · Layout revision

- **880px preview constraint removed.** The document pane is fluid: the sheet scales to the
  available width up to 100% of its natural 816pt page width, then holds and centres. On a
  wide monitor the page gets the room; the operator's zoom control still overrides.
- **The rail is fixed on the right**, not a flex column that can be shrunk — a definite width
  (default 452px, 380–560 range), full height, its own scroll, its finalize footer pinned.
  The document pane owns all remaining width.
- Rail sections are `flex: none` and never compress; the document never yields width to the
  rail.

## 6 · Minimal presentation-state schema

Three records. Only the first is mutable by this surface, and only while a draft.

### `presentation_profile` — authored here, one per quote version

```
presentation_profile {
  quote_id            fk
  quote_version       int
  layout              enum  'tier_table' | 'single_tier'        default 'tier_table'
  presented_tier      fk?   tier — required iff layout = 'single_tier'
  detail_level        enum  'itemized' | 'turnkey_only'          default 'itemized'
  include_fee_lines   bool  default true    -- false collapses; never removes the disclosure
  include_terms       bool  default true
  include_addendum    bool  default false
  include_note        bool  default true
  customer_note       text? max 400 — retained when include_note = false
  updated_by / at
}
```

No economic field. No term field. No identity field. The schema is the enforcement.

### `presentation_record` — frozen on finalize, immutable

```
presentation_record {
  id
  quote_id / quote_version    fk — one record per version
  profile_snapshot            json  — the profile verbatim at freeze
  artifact_uri                the stored PDF
  artifact_sha256             content hash
  page_count                  int
  finalized_by / finalized_at
  delivery_state              enum 'not_sent' | 'delivered'
  delivered_by / delivered_at / delivery_channel   nullable — operator-recorded
}
```

### `accounting_handoff` — the only downstream write

```
accounting_handoff {
  presentation_record_id  fk   — carries the artifact and the profile snapshot
  instruction             text — authored on this surface
  created_by / at
  external_ref            nullable — NetSuite attachment id, set by the integration
}
```

**Derived, never stored:** the `Customer received` summary (a projection of
`profile_snapshot`), page count display, the configuration summary line, and any deposit
dollar figure — the last one read from the order when an accepted tier exists, and absent
otherwise.

### Governed reads (display only)

`quote.pricing_status` · `quote.approved_by/at` · tier sell prices and totals ·
`sales_order.payment_terms` · `deposit_pct` · `accepted_tier` · `invoice_trigger` ·
`freight_treatment` · `customer.ap_contact`. All read paths. No write path exists from this
surface to any of them.

## 7 · Open questions this revision leaves

1. **Does `Mark as delivered` need a channel enum** (email / portal / in person) or is a
   free-text note enough for Accounting's purposes?
2. **Draft PDF downloads** — marked `draft` on the document today. Should draft downloads be
   blocked entirely once a finalized record exists, to stop two artifacts circulating?
3. **Whose acceptance sets `accepted_tier`** — Sales Order on PO receipt, or the PM recording
   the customer's reply? Determines when deposit dollars can legitimately appear.
4. **One record per version, or per finalize?** If a PM finalizes, delivers, then finalizes
   again on the same version without changing the profile, is that a second record or an
   idempotent no-op?

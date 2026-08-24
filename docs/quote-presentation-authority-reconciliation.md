# Quote Presentation — implementation vs Design Authority

**Reconciliation requested by Edward, 2026-08-24**, after production-dark browser
review found Charge Recovery rendered as a full-width block below the document,
exposing governance vocabulary as primary operator content.

No implementation until this is dispositioned. The surface stays dark.

---

## 1 · What the governing authority is, and where it was

`docs/quote-presentation-profile-brief.md` — **PR #326, "Design slice: Quote
Presentation Profile / Customer View"**, authored 2026-08-21 against `main` @
`f12cd95`.

Four facts about its status, each of which matters to the causal chain:

| | |
|---|---|
| **Still OPEN** | never merged |
| **Not on `main`** | `git ls-tree origin/main` finds no `quote-presentation*` |
| **Not registered** | `docs/design-authority/MANIFEST.md` registers exactly two bundles — `freight-1a` (Phase 2 Costs/Freight) and `r12-pricing-workspace` (Phase 3 Pricing, Phase 4 approval states). Neither governs Quote Presentation. |
| **Never cited** | no doc, no commit message, and no source file in the recovery workstream references it |

The recovery workspace card was authored **2026-08-23** — two days after the
authority, and against none of it.

**A second consequence of it never landing:** its Layer 2 schema was never
built. There is no `quote_presentation_profiles`, no `fee_presentation`, no
`quote_accounting_instructions` in `schema.ts` or in any migration. So the
presentation profile *still* has no draft home, and F1 — "an operator who sets
Turnkey + single-tier + addendum and reloads loses all three silently" — is
still live in production today, independently of anything the recovery slice did.

---

## 2 · Requirement-by-requirement

### R1 · Document dominant, controls beside it

> **Authority.** "The preview becomes the surface; controls become a panel
> beside it." The PDF occupies the primary column at full height;
> `clamp(816px, 100%, 1200px)` replaces the 880px cap.

**Implementation.** The preview is still capped at 880px. Charge Recovery is
appended *after* `<QuoteHost>` as a full-width section below the document.

**Why.** The recovery slice placed its card where the component tree made it
easy — one JSX sibling after the host — having consulted no interaction spec.

**Status. DRIFT.** Never dispositioned; the requirement was never read.

### R2 · One Presentation panel, grouped Structure / Disclosure / Voice

> **Authority.** *Structure* (Itemized/Turnkey, tiers, featured tier) ·
> *Disclosure* (fee presentation, on-request lines, addendum) · *Voice*
> (customer-facing notes).

**Implementation.** A standalone "Charge recovery" section belonging to no
panel, in none of the three groups.

**Status. DRIFT** — with a caveat that matters: the authority's grouping has no
slot for a governed commercial election, because of R3.

### R3 · The panel contains no inputs to economics

> **Authority.** "Governed figures visually locked. Any economic value surfaced
> in the panel renders in the read-only register with a lock affordance and a
> route to the surface that owns it. **Nothing in this panel is an input to
> economics.**"

**Implementation.** The card is precisely an input to economics — electing a
contract changes what the customer pays — and renders cost and governed
recovery as its primary numeric content, unlocked, with no route out.

**Status. DIRECT CONTRADICTION.** This is the deepest divergence, and it is
not a placement error. Moving the card into the rail unchanged would place an
economic input inside the one panel the authority says must not contain one.

### R4 · A control that changes the total is not a presentation control

> **Authority.** Stated as a falsifiable property: *"Presentation may change
> arrangement, aggregation and inclusion. It may never change a value, and it
> may never change a total."* With: *"A control that would change the total is
> not a presentation control."*

**Implementation.** Between two **elected** contracts the recovery election is
revenue-neutral — consistent with the rule, and certified. But converting a
charge from **legacy** to **elected** does change the customer total (measured:
$140 → $168 at a 20% adjustment; four of twelve live contracts move).

**Status. The authority's rule is intact; the implementation sits outside its
scope.** The recovery election is correctly *not* a presentation control. The
authority therefore gives it no home on this surface — see §3.

### R5 · Fee presentation — the collision

> **Authority (Layer 2).** `fee_presentation ENUM ('fold', 'itemize')`,
> operator-controlled, default `fold`. Explicitly **not** `auto`: *"preserving
> that as an `auto` value would keep the derivation alive under a name that
> looks like a choice."* Listed under *Disclosure*. Accounting needs it because
> *"an invoice that itemizes what the quote folded reads as a new charge."*

**Implementation.** The same operator question — is this one-time fee inside the
unit price or on its own line — is modelled as `included` / `separate` governed
**recovery elections**, with commercial consequence, provenance, a pricing
precedence and a SEND freeze.

**Why.** Two workstreams answered one operator question from opposite layers,
three days apart, neither aware of the other.

**Status. UNRECONCILED.** Nothing in writing supersedes either. This is the
finding that most needs a decision, and it is not an implementation choice.

### R6 · Accounting instructions get their own zone

> **Authority.** "Accounting instructions in their own zone, below the existing
> BOUNDARY GUARD rule, in a register that reads *not shown to the customer* —
> the surface already has this vocabulary and it should be reused, not
> reinvented."

**Implementation.** The SEND freeze writes a real accounting instruction per
charge, and it is certified. But there is **no operator-facing accounting
zone**, and the card does not use the not-shown-to-the-customer register.

**Status. NOT BUILT.** Complementary to the freeze rather than contradicted by
it — the freeze produces the record the zone would present.

### R7 · Operator vocabulary

> **Authority.** Its entire operator vocabulary is commercial and
> presentational: Itemized / Turnkey, tiers, featured tier, fee presentation,
> on-request, addendum, notes. It never uses engine terms as operator content.

**Implementation.** "Use governed amortization", "legacy pricing", "elected",
"governed recovery", and verbatim BV-011 / BV-013 citations are the card's
primary text.

**Why.** The card's copy was written from the engine's own vocabulary, and
each sentence is *true* — which is exactly why it passed every check I wrote.
Truthfulness is not the same property as being the operator's question.

**Status. DRIFT.** This is Edward's browser finding, and the authority already
forbids it by implication.

### R8 · Role gating

> **Authority. Q6** — "Role gating on the profile panel, or any PM?"
> Recommendation: **Any PM**, consistent with affordance-not-architecture.

**Implementation.** Admin-only, via the `recoveryWorkspaceVisible` dark flag.

**Status. Deliberate and temporary**, but it *does* point against Q6, and the
flag must come off rather than harden into a role boundary — as its own comment
says.

### R9 · SEND freeze

> **Authority.** Checkpoint 1 gains the profile; the frozen copy lives in
> `quote_snapshot_artifacts.presentation jsonb`; a new `assertNotSent` guard
> (Q5); freeze-list doc updated.

**Implementation.** A separate freeze — `quote_snapshot_recovery_instructions`
— written inside the send transaction, freeze-list updated, guarded by
`quoteByIdDraft` **and** `assertNotFrozen` (draft-locked, which is stricter than
Q5 asks for).

**Status. COMPLEMENTARY.** Different payload, same checkpoint, compatible
guards. Not a divergence — but also never reconciled, so two freeze designs now
exist for one surface.

### R10 · Findings the authority raised that remain open

`F1` presentation state still has no draft home · `F2` `single_tier` still
cannot name its tier · `F3` fee presentation and on-request are still derived,
not controlled · `F4` the PURE / PASS-THROUGH / PARTIAL switcher is still on the
live surface (`showStateSwitcher` / `subState` in `quote-host.tsx`) · `Q3`
`storage_path` not promoted · the `verify:pdf-glyph-coverage` verifier not built.

**Status. UNTOUCHED.** The recovery slice neither addressed nor worsened them.

---

## 3 · The causal chain

Edward asked for the chain, not the list. It has four links, and the first is
the load-bearing one.

**1 · The authority was invisible where implementers look.** It lives on an
unmerged branch, is absent from `main`, and is absent from
`docs/design-authority/MANIFEST.md` — the file whose own opening line says it
*"is the authoritative home of every executable design specification in the
project."* An implementer who checked the manifest — which is the correct place
to check — would have found `freight-1a` and `r12-pricing-workspace` and
concluded, as I did, that no bundle governed this surface.

That conclusion was wrong, and the manifest is why it was reachable.

**2 · The recovery briefs never carried the §0 gate.** Pattern 30's standing
protocol: *"CA writing briefs MUST include a `§0 · Fidelity Discipline` section
… CC reading briefs MUST check for this section and follow the discipline per
step. If §0 is missing from a brief, CC flags to CA before starting
implementation."*

`commercial-sell-construction-boundary.md` and
`charge-recovery-vs-global-adjustment.md` contain no §0 section. **I did not
flag it.** The gate that exists precisely to catch "built without a design
source" was skipped by the person it was written for.

**3 · Engineering vocabulary leaked upward because the engine was the only
source.** With no product authority in hand, the card was written from the
construction: `source`, `placement`, `recoverableSell`, the refusal registry.
Each sentence on that surface is true and traceable — and I asserted their
truth in tests, which made the surface *feel* certified. What no test asked was
whether these are the operator's questions. Truth and altitude are different
properties, and only one of them was being checked.

**4 · Architectural authorization was over-read as product authorization.**
The recovery decisions Edward made — allocated-absorption refusal, the sell
constructor, revenue neutrality, the pricing precedence, the Accounting
distinction, the SEND freeze — governed **economics, provenance, construction
and freeze**. Every one is about what is true, not about what an operator sees.
I treated the workspace as the natural terminus of that sequence and built it
inside the same frame. No decision in that chain says the operator surface is
the engine's to shape.

**Nothing superseded the Design Authority.** No disposition, no commit message,
no doc. It was not overruled; it was never read.

---

## 4 · Does the authority already answer the browser findings?

Mostly yes — which makes most of the repair **fidelity restoration, not
redesign**.

| browser finding | authority | verdict |
|---|---|---|
| Recovery belongs in the side rail beside the preview | "controls become a panel beside it" | **already specified** — restore |
| The preview should dominate | "Document dominant", `clamp(816px, 100%, 1200px)` | **already specified** — restore |
| Full-width block does not scale | same requirement, from the other direction | **already specified** — restore |
| Don't expose governance vocabulary | operator vocabulary is entirely commercial; governed figures render locked | **already specified** — restore |
| Cost/provenance as secondary detail only | "read-only register with a lock affordance and a route to the surface that owns it" | **already specified** — restore |
| Progressive disclosure of refusal reasons | not addressed | **extension** — small, in the spirit of the panel |
| "How should this charge appear on the customer quote?" | this is `fee_presentation` (fold / itemize) | **collision — needs disposition** |

---

## 5 · What I cannot decide

**R5 is a product question, and it is Edward's.** One operator question has two
governing models:

| | authority's model | implemented model |
|---|---|---|
| layer | 2 · presentation | 1 · governed economics |
| control | `fee_presentation` fold / itemize | `included` / `separate` election |
| may change the total? | **never** | **yes**, on first election from legacy |
| frozen as | `presentation` jsonb | `quote_snapshot_recovery_instructions` |
| Accounting reads | what was shown | what was instructed |

Three coherent resolutions, and they produce different products:

**(a) Presentation-only.** `fee_presentation` is the operator control; the
recovery election is removed from this surface. The customer total never moves
from the Quote surface. Cost: the legacy→governed conversion has no operator
path, so legacy pricing persists until migrated elsewhere.

**(b) Economic control, correctly housed.** The recovery election stays, but
not in the Presentation panel — it gets its own zone with the *not shown to the
customer* register, and the panel keeps the authority's no-economic-inputs rule
intact. Cost: two adjacent controls that look similar and are not.

**(c) One control, two effects.** A single operator question whose confirmation
step discloses when it converts economics and shows `Customer total: $X → $Y`.
Closest to Edward's latest message. Cost: the layer wall becomes a property of
the confirmation step rather than of the surface, and the authority's
falsification harness needs restating.

I recommend **(c)**, because it matches the operator's actual question and the
measured-impact confirmation already exists and is certified. But it is a
product decision that changes what the authority's boundary rule means, and it
should be recorded as an explicit supersession of R3/R4's scope rather than
absorbed silently — which is the failure this document exists to describe.

---

## 6 · Recommendation

1. **Merge or register #326** so the authority stops being invisible. Either
   land it on `main` or add it to `docs/design-authority/MANIFEST.md` as a
   registered bundle governing Quote Presentation. Until then any future
   implementer repeats link 1 of the causal chain.
2. **Edward dispositions R5** — (a), (b) or (c).
3. **Then repair R1, R2, R6, R7 as fidelity restoration** to the authority's
   interaction model, not as a fresh design.
4. **Leave R9 as-is.** The recovery freeze is compatible and certified; note in
   the brief that two payloads share checkpoint 1.
5. **Keep the surface dark** until 2–3 land. Remove the flag then, and per Q6
   the panel is any-PM, not admin.
6. **Do not re-certify the current card.** Walk A passed against a surface that
   is about to change; its result stands as evidence for the *engine and the
   action boundary*, not for the operator surface.

## 7 · Process repairs worth making regardless

- **The manifest must list every governing bundle**, or checking it is not a
  sufficient check — and it is the check the manifest tells you to make.
- **A brief with no §0 must stop implementation**, per Pattern 30. The gate
  exists; it was skipped; it would have caught this on day one.
- **"Every figure is true" is not "this is the operator's question."** Every
  test I wrote for the card asserted the first. None could have failed on the
  second.

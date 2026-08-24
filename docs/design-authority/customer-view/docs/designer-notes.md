# CP — Customer Quote presentation workspace · Designer notes

**Deliverable:** canonical source for the *Present quote* surface — the operator's last stop
before a priced quote leaves the building.
**Prototype:** `Nexus Customer Presentation.dc.html` (self-contained; Nexus token palette,
`Newsreader` / `Instrument Sans` / `JetBrains Mono`).
**Supersedes:** the preview-toolbar arrangement shown in the production screenshot — the
ribbon (`PM-INTERNAL PREVIEW · THIS BECOMES THE PDF`), the `Send as:` pair, the boundary-guard
paragraph, the `Detail:` select and the `Include spec addendum` toggle. Same controls, same
data contract. Different room.

Everything the customer-facing render layer establishes holds unchanged
(`docs/cd-customer-pdf-render-*`): the boundary guard, NULL-as-empty-signal, sell-derived
totals, `pdf_layout` × `detail_level` orthogonality.

---

## 1 · What was wrong with the old placement

Not the controls. The **room**.

The five presentation controls sat in four separate horizontal bands stacked above the
document, each in a different visual register — a magenta internal ribbon, a mono toggle
pair, a prose boundary-guard block, a switch strip — and the PDF began below the fold. The
operator's actual question (*what will Nadia open?*) was answered by the smallest, lowest
element on the page.

Three specific defects:

1. **The artifact was not the object.** The thing being decided about was smaller than the
   apparatus for deciding.
2. **Governed and presentational controls were adjacent and looked alike.** Nothing on
   screen distinguished *this changes what they see* from *this changes what they pay* — the
   boundary-guard paragraph asserted the distinction in prose, which is the weakest place to
   put a guarantee.
3. **There was no send state.** Two download buttons and a mail-draft button, no answer to
   *has this gone out, and what went with it*.

## 2 · The room — one axis, two roles

> **Left: the artifact. Right: the decisions about it. Bottom-right: the act.**

A full-height two-pane desktop layout, viewport-bound, each pane scrolling on its own. The
sheet renders on a striped desk at real page proportions (816 × 1056 at operator-set zoom),
so page count and page breaks are visible facts rather than a number in a toolbar.

The four bands the old surface scattered are folded into **one rail above the preview**:
`WHAT THE CUSTOMER WILL SEE` · the live configuration summary · page count · zoom. The
internal-magenta chip is the only internal marker the preview pane carries, and it means one
thing — *the frame is internal, the contents are not*.

**The boundary-guard paragraph is gone as a paragraph.** Its content is now structural: the
customer pane contains no internal figure, and the governed band on the right is visibly
locked. A guarantee stated in prose is a guarantee someone has to read. ← LOAD-BEARING

## 3 · The panel's order is the operator's order of thought

Four bands, top to bottom, answering the five questions in the brief in the sequence an
operator asks them:

| Band | Question | Treatment |
|---|---|---|
| **Governed pricing** | what is fixed? | paper-3, **dashed** rule, lock glyph, read-only |
| **Presentation** | what tier / what shape? | white card, segmented controls |
| **Included in the PDF** | what is in, what is out? | white card, four Show/Hide rows |
| **Customer-facing note** | what do they read verbatim? | white card, textarea |
| **Downstream · Accounting** | what follows this to invoicing? | internal-violet card |
| **Send** | is it ready, and go | pinned footer, never scrolls away |

Governed goes **first** and not last: it is the frame every control below it operates
inside. Reading order and authority order agree.

### The dashed border is doing real work

Every editable card is solid-ruled white on the tinted gutter. The governed band is
**dashed, tinted, and lock-marked** — the one card whose numbers are output, not input. It
carries its provenance (*Set in Pricing · approved by Dana K. Aug 19*) and its promise in the
same sentence as the numbers: *nothing on this panel changes these numbers — only how they
are presented.*

## 4 · The invariant that makes the whole surface trustworthy

> **Every presentation setting leaves the totals identical.** The three tier totals in the
> governed band are the numbers in the PDF, in every combination of layout, detail level and
> inclusion toggle. ← LOAD-BEARING

This is why the governed band can sit in the same panel as the controls without hedging. It
is also the acceptance test: flip every control, watch `$12,810 / $40,550 / $70,950` not
move.

The one place this was nearly violated is instructive.

## 5 · Hiding an itemization is not hiding a charge

First build: switching **One-time fee breakdown** off removed the fee block from the PDF
outright. The $4,850 was still inside every total — correctly — but the customer now held a
document where a fifth of the Tier 1 price had no account of itself. That is not a quieter
presentation; that is an unexplained number.

Corrected, and stated as a rule:

> **A presentation control may change the *resolution* of a disclosure. It may not remove
> the disclosure.** ← LOAD-BEARING

So *off* collapses three lines to one sentence — *"Setup, tooling and artwork fees of $4,850
are included in the totals above — itemization available on request"* — and the toggle's own
meta says what it did: **collapsed to one line · total unchanged**. Every toggle states its
consequence in the same register (`+1 page · 3 product panels`, `omitted — terms sent
separately`, `note written but withheld`), because an operator choosing what to hide needs to
know what hiding costs.

`note written but withheld` matters particularly: the note text survives the toggle. Withheld
is not deleted.

## 6 · Show / Hide, not on / off

The inclusion rows began as switches with an `on` / `off` word. An off row read as *disabled*
rather than *available* — a state, not an offer — and the way back was the least prominent
thing in the card.

Each row now carries an explicit **Show** (accent, live) or **Hide** (quiet, neutral) button
beside the switch. The off state advertises its own reversal. ← LOAD-BEARING

## 7 · The tier picker exists only when it means something

`Single tier` needs a *which*. `Tier table` does not. So the tier selector renders only in
single-tier mode, in a tinted sub-band under the control that created the need for it — and
picking a tier from it also selects single-tier, because that is what the pick means.

No permanently-present control with nothing to do in the default mode.

## 8 · Send state

The footer is pinned, not scrolled to. It carries, in order: state chip
(`DRAFT · NOT SENT` amber → `SENT` green), recipient, a four-line readiness list, the primary
act, and a one-line statement of what the act will do — *"Sends the 1-page PDF above and
files the Accounting instruction. Pricing is untouched."* The page count in that sentence is
live.

The readiness lines are the four things that can be wrong at send time, and two of them are
soft: *no customer note on this send* and *Accounting instruction empty* report rather than
block. Nothing here gates on presentation — a presentation choice cannot be invalid, only
deliberate.

**Sent is a state of the surface, not a toast.** On send the preview gains a green delivery
strip (recipient, date, *this presentation is locked to v1 — changes create v2*), the draft
marker leaves the document's quote number, and the primary button becomes *Sent — start v2*.
The version consequence is stated where the send happens, not discovered afterwards. ←
LOAD-BEARING

## 9 · Downstream · Accounting

The brief's last requirement, and the one with no existing home. It gets the **internal
violet** register — the same token that marks internal-only content everywhere in Nexus — and
says its own scope twice: an `INTERNAL ONLY` chip and *"Travels with the quote to invoicing on
acceptance. Never printed on the customer PDF."*

Four structured fields (invoice on · deposit · bill to · freight billing) plus one free-text
instruction to Accounting. The deposit shows its computed figure (`50% · $20,275`) so the
operator can see the terms resolve against the tier they are sending.

**Deliberately in the same panel as the customer-facing note, deliberately not in the same
register.** Two audiences, one moment of authorship, no ambiguity about which is which.

## 10 · Load-bearing

1. **The artifact is the largest object on screen.** Any surface whose purpose is *decide
   about this document* fails if the document is not the room.
2. **The boundary guard is structural, not prose.** Internal figures are absent from the
   customer pane; the governed band is visibly locked. Nothing asserts in words what the
   layout can assert by construction.
3. **Presentation controls are economics-neutral, and the surface proves it** by showing the
   governed totals inside the control panel, unchanging.
4. **Resolution, not removal.** A presentation control may coarsen a disclosure; it may not
   erase it. Off states must still account for money inside the total.
5. **Every toggle states its consequence** in the same register, including page cost and
   what stays unchanged.
6. **Off advertises its reversal.** `Show` is a live control; `off` is a dead label.
7. **A control that needs a parameter shows the parameter only when it applies**, and
   choosing the parameter selects the mode.
8. **Send state is a state of the surface**, with the version consequence stated at the
   button.
9. **Downstream instructions get the internal register and say their own scope.** A field
   that travels to another department must name the department.
10. **Governed reads before presentational.** Reading order is authority order.

## 11 · Open questions

1. **Are the Accounting fields authored here, or mirrored read-only from Sales Order?**
   Structured fields (invoice on, deposit, bill to, freight billing) plausibly belong to the
   order; the free-text instruction plausibly belongs to this moment. Current build treats
   all five as authored here.
2. **Does `detail_level = turnkey_only` suppress the fee-disclosure sentence too?** Today
   turnkey-only carries the fold in its includes list and the fee toggle reads `n/a`. If
   Accounting wants the sentence in both shapes, the toggle stops being layout-dependent.
3. **Who may send below-target?** The readiness list reports pricing approval but does not
   evaluate it. If presentation is where a below-floor send would be caught, this surface
   needs the R12 verdict, not a green tick.
4. **Note templating.** One free-text note per quote, or a library of standing notes
   (validity holds, tariff true-up, MOQ caveat) with per-quote overrides?
5. **Version display.** `Q-2419 · draft` becomes `Q-2419` on send. Do sent versions show
   `v1` on the customer document, or stay unnumbered to the customer as today?

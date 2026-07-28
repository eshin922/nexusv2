# Round 9 — Acceptance & Sales Order ceremony · Designer notes

**Deliverable:** Pattern 30 canonical source for Slice 12 sub-tabs **4 and 5**.
**Prototype:** `Nexus Round 9.html` → `app/r9/{data.js, styles.css, ceremony.jsx}`
**Scope:** revision of sub-tab 4, first build of sub-tab 5. **Sub-tabs 1–3 are unchanged** —
they are merged and shipping, and this round reuses them verbatim (`window.PreviewTab`,
`SendTab`, `ReviewTab`, `Legend`, `AdvanceBar` from `app/r8/umbrella.jsx`).

> **R9.1 update** — sub-tab 5 is now **"Sales Order"** and carries **three states in one
> layout** (pending · push failed · record). The typed `FINALIZE` gate is **dropped**;
> see §R9.1-3 for the argument. Renames in §R9.1-2.

> **`app/r9/styles.css` is an ADDENDUM to `app/r8/styles.css`, not a replacement.**
> Load r8 first, then r9. CC adds one file and edits nothing merged. Five rules
> override r8; each is labelled and justified in the file.

---

## 0 · The answer, in one line

**The tier *choice* moves upstream to acceptance. The tier *commitment* stays at the lock.**

That single split resolves the whole brief: one customer decision becomes one capture,
the PM stops performing two ceremonies, and the irreversible act does not move.

## 1 · Why the two ceremonies existed — and why only one should

R8 split *recording a fact* from *committing to it*, and gave each its own ceremony. That
was right about the systems and wrong about the human. The customer's email contains
**both facts at once** ("we accept, Tier 2"), so:

- **Fact-recording is one act.** Acceptance and the tier they named are transcribed
  together, because that's how they arrived. Sub-tab 4 is now a **capture** — their words,
  the tier, how it arrived — not a ceremony with orientation panels in front of it.
- **Commitment is a different act, later.** Sub-tab 5 no longer asks *"which tier?"*
  (answered upstream). It asks **"commit it?"** — which is the only irreversible question
  in the umbrella, and the only one that deserves a gate.

R8's Mark Accepted had an orientation panel, a consequence rail and a reversibility
explainer standing in front of a light act. All three are gone. What remains is a card
with three fields and a button.

## 2 · The constraint, held

| Requirement | How it's held |
|---|---|
| Irreversible act stays at **tier commitment** | The NetSuite push fires only from sub-tab 5's **Send order to NetSuite** confirm. Nothing about acceptance is irreversible. |
| HubSpot pushes at **acceptance**, one push | Fires on "Record acceptance" in sub-tab 4. Sub-tab 5 shows it as already-done (`✓ synced`) and never re-pushes. |
| HubSpot failure gets **its own surface** | Full-width error on sub-tab 4, outside any modal: *"acceptance not recorded"*, `quote.state` still `sent`, retry. It is not reachable from — or confusable with — the FINALIZE flow. |
| Rollback + revise need a home | Both live on sub-tab 4's recorded state as peers of the advance. Revise's copy states the real sequence: it rolls the acceptance back first, then reopens as a draft. Sub-tab 5's rail repeats that all three are available *until you commit*. |

**Two systems, two moments, two failure modes — made explicit.** Both surfaces carry a
`Now / Later` pair of system cards: at capture, *HubSpot fires now, NetSuite not yet*; at
the lock, *HubSpot done, NetSuite now*. The PM can always see which external system is
about to be touched, which is what makes two separate failures legible instead of
confusing.

## 3 · Answers to the open questions

**Do both sub-tabs survive? How does weight distribute?**
Yes — but they stop being peers. Sub-tab 4 is a **transcription** (light, compact,
single-column, ~one screen). Sub-tab 5 is **the ceremony** — the full order receipt, the
override disclosure, the dark slab and the dark-header confirm. Previously they were two
comparable ceremonies; now the weight is unambiguously back-loaded.

**Does the PM pass through acceptance, or does it happen as a consequence?**
They pass through it — but it costs one screen and one click, not a ceremony. It cannot
be a consequence of something else: it fires an external CRM write and can fail, and a
failure with no surface of its own is exactly what the brief rules out.

**Where does the tier choice get made?**
At the **capture**, as compact chips with margin state and a `named` marker. The lock
surface receives it as a **carried value** — displayed as a large figure with provenance
("carried from acceptance — customer named T2 in their acceptance (email, Jul 26)"),
not as a fresh picker. Changing it there is possible but sits behind a closed disclosure
("Commit a different tier than the one they named") that states plainly that it
contradicts a recorded fact and is logged.

**Does the asymmetry still read correctly?**
**It holds, and it sharpens.** The four-light-steps rhythm never described four equal
decisions: 1–3 are navigation and logging (only Send changes state), and 4 is now a
capture. So the real shape is *navigate → log → capture → **LOCK***: exactly one light
state-changing act before the heavy one, which makes the contrast cleaner than R8's,
not muddier. One addition: the strip's **lock threshold goes from dashed to solid**
once acceptance is recorded — the rule is armed precisely when the PM is cleared to
cross it.

## 4 · Auto-advance — not adopted, and why

We did not adopt one-click-auto-advance. Instead: **the deliberate handoff.**

On a successful capture the app **resolves in place** — success panel, HubSpot
confirmation, rollback and revise available — and the advance bar **re-labels to name
the next act and its tier**: `Commit T2 in Tier Selection →`. The PM crosses the lock
threshold by pressing a button that says what it will do.

This is a direct response to CA's caution. A silent jump into the irreversible tab is
indistinguishable from the smoke-walk bug, and once the SO push is live that ambiguity
is dangerous. The handoff costs one click and buys certainty that every entry into
sub-tab 5 was intentional. It also gives rollback and revise a place to live that
auto-advance would have skipped past.

## 5 · Sub-tab 5 — delivery-ready specification

> Superseded in part by **§R9.1-1** — sub-tab 5 is now the Sales Order receipt in three
> states. The bullets below describe the elements that survive into it.

- **Carried tier block** — big tier figure, qty, unit price, turnkey, margin (status-coloured), with a provenance line beneath.
- **Override disclosure** — collapsed by default; opens to a warn-tinted panel plus the chip picker; logs the override.
- **Below-floor gate** — T4 disabled in both pickers, blocked advance, R5 admin-override path.
- **Read-only all-tier compliance** in the rail (from Pricing; not redesigned).
- **Confirm step** — dark-header modal, **no typed gate** (dropped in R9.1-3; the receipt carries the weight). Action-specific copy naming the NetSuite SO and `Pending Fulfillment`; consequence list includes *"Disable Revise and roll back acceptance — both work right up until this click."* Cancel reads **"Cancel — keep it reversible."**
- **NetSuite failure** — 502, *"quote NOT finalized"*, no SO created, state still `accepted` **and still reversible**, retry.
- **Complete state** — dark ribbon with SO id + NetSuite link, final-record table (now including *when and how the acceptance was captured*), all sub-tabs `locked`, revise and rollback disabled, no advance.

**Canonical status pills** (replacing `placeholder · Step 8`) come from R8's existing
`SubTabStrip` vocabulary — no new mechanism: `awaiting accepted` → `the lock` (active) →
`locked` (post-commit). Tab 4 reads `in progress` → `done · revisitable`.

## 6 · ⚠ Load-bearing to the reversibility model — do not trade away

Flagged explicitly, as requested. Each is also marked `← LOAD-BEARING` in `app/r9/styles.css`.

1. **Tier choice at capture, tier commitment at the lock.** The entire ceremony collapse
   depends on this split. Merging them moves the irreversible act to the customer's "yes."
2. **The deliberate handoff — no auto-navigation into sub-tab 5.** Entry into the
   irreversible tab must always follow an explicit click on a button that names the act.
3. **The heavy/light asymmetry.** Sub-tab 4's advance must stay a plain button; sub-tab 5's
   must stay the dark slab backed by the order receipt (see item 8). Normalizing either
   direction destroys the teaching mechanism.
4. **HubSpot failure surfaced outside any modal**, on sub-tab 4, stating that state did not
   advance. Never inside the send-order flow.
5. **Rollback and revise visible as peers** on the recorded state — not in an admin menu.
   Reversibility that isn't visible isn't reversibility.
6. **The `Now / Later` system cards.** Two systems at two moments is the model; showing
   which one is about to be written is what makes two failure modes comprehensible.
7. **Override behind a disclosure that names the contradiction.** Free tier-switching at
   the lock would quietly decouple the committed tier from the recorded acceptance.

Cosmetic by comparison (safe to adjust): chip sizing, the quote block's italic treatment,
system-card wrapping, the armed-threshold colour.

## 7 · Named structure (Pattern 30 — implement verbatim)

New components (`app/r9/ceremony.jsx`): `QuoteUmbrellaR9` · `AcceptedCapture` ·
`SalesOrderTab` · `OrderReceipt` · `SendOrderModal` · `SubTabStrip9`.
Reused unchanged from R8: `Legend` · `AdvanceBar` · `PreviewTab` · `SendTab` · `ReviewTab`.
(`SubTabStrip9` is R8's `SubTabStrip` with three string changes — see §R9.1-2.)

New classes (`app/r9/styles.css`): `r9-capture` `r9-capture-head` `r9-field` `r9-quote`
`r9-quote-src` `r9-source` `r9-tierchips` `r9-chip`(`.on .disabled`, `.named`)
`r9-handoff` `r9-carried` `r9-prov` `r9-override` `r9-systems` `r9-system`(`.done
.pending`) `r9-armed-strip` · **receipt:** `r9-so` `r9-so-head` `r9-so-meta` `r9-so-lines`
`r9-so-lrow`(`.head .onetime`) `r9-so-totals` `r9-so-trow`(`.grand`) `r9-so-status`
`r9-so-srow`(`.done .fail`) `r9-so-flag`(`.warn .bad`) `r9-so-split` (+ `.half.held`,
`.half.lost`).
Overrides of r8 (five, documented in-file): `.r8-advance.consequential .r8-adv-btn`,
`.r8-advance .r8-adv-btn { white-space }`, `.r9-armed-strip .r8-threshold`,
`.r8-cols.r9-single`, `.r8-strip { overflow-y: hidden }`.

`.r8-proto` / `.r8-dn` remain prototype-only — **strip both in production.**

---

# R9.1 · Sales Order tab — follow-up round

## R9.1-1 · Three states, one layout

The tab wasn't redundant, it was underspecified — your read was right. What makes it
non-optional is that it's **the order**, not a confirm screen. So sub-tab 5 is now a
**receipt**: the same document in all three states, with only the header stamp and the
status ledger changing. Nothing moves position between states — that constancy is what
turns it from a transient gate into the permanent home for the order.

**Pending** — the receipt with nothing fired yet. Bill-to (NetSuite account + matched
chip), ship-to, terms, incoterms, requested ship; four product lines with qty / unit /
extended; one-time charges; a totals ladder ending in one bold **order total**; then the
**status ledger** — HubSpot `✓ done at acceptance`, NetSuite `not yet`, Quote `not yet`.
Pre-send flags (below-floor tier, unconfirmed NetSuite mapping) sit between the totals
and the ledger; the fixture ships with an empty flag array plus two ready examples.
It reads as something you sign, not something you perform.

**Push failed** — the two-facts problem, solved with a **split banner**: one green half
(*still true* — the customer accepted, HubSpot is Won, you don't need to re-record it)
and one red half (*did not happen* — no SO exists, quote still `accepted`, still
reversible, retry here) sharing a single border. Deliberately not a full-bleed red
catastrophe, because half the screen is still good news. The receipt below is unchanged
and the ledger shows NetSuite `failed` while HubSpot stays `done`. **This is exactly why
it needs a tab and not a modal** — a dismissible surface takes the error away with it,
and the PM loses the only place that says what still needs doing.

**Record** — the same receipt with the SO number in the header stamp, the created
timestamp, all three ledger rows `✓`, and the locked ribbon above the strip. Side rail
swaps from compliance/reversibility to what's-next and admin-unlock. No advance.

## R9.1-2 · Renames — adopted

| | Was | Now |
|---|---|---|
| Sub-tab 5 | Tier Selection | **Sales Order** |
| Sub-tab 4 | Mark Accepted | **Acceptance** — strip label now follows the header |
| Threshold caption | `lock threshold` | **`lock`** |
| Commit button | Finalize & push Sales Order | **Send order to NetSuite** |
| Tab-5 active pill | the lock | **ready to send** |

Sub-tab 4's strip label follows the header, on your own logic: "Mark Accepted" names a
button, "Acceptance" names the artifact and stays true in every state of the tab.

The commit button keeps the consequence in the advance-bar caption rather than the label
(*"Irreversible — creates a Sales Order in NetSuite"*), so the button says the act and the
caption says the cost. In the failed state it reads **"Retry — send order to NetSuite"**.

**These are string changes only.** `SubTabStrip9` is R8's component with two label strings
(from data) and one caption string changed — no structural change, no CSS change.

## R9.1-3 · Typed FINALIZE gate — dropped. The argument.

**Agreed, and the asymmetry survives.** I flagged it load-bearing, so here's the read.

The asymmetry was never carried by the typed gate. It's carried by four things, and the
gate was the weakest and the only rude one:

1. **The dark slab button** — nothing else in the umbrella looks like it.
2. **The dark-header modal** with a consequence list naming the SO and the two locks.
3. **The lock threshold** in the strip, now solid once acceptance is recorded.
4. **The receipt itself** — four lines, real totals, the account it lands under, and a
   ledger that says *not yet* three times.

The gate existed to add weight to a sparse confirm. Item 4 didn't exist when I specified
it. Now that it does, the typed gate is friction layered on top of a PM who has just read
an order document — and you're right that it reads as distrust. Weight through
**comprehension** beats weight through **obstruction**: the PM who reads a receipt knows
what they're sending; the PM who types six characters has only proven they can type.

**The condition on dropping it:** if the receipt ever gets thinned — collapsed to a
summary line, moved behind a disclosure, or reduced to a total — the gate has to come
back, because then obstruction is all that's left. **The receipt is now load-bearing to
the asymmetry** (new item 8 below). That's the trade, and it should be recorded as one.

The modal stays. It's one screen, it names the consequence once, and its cancel still
reads *"Cancel — keep it reversible."*

## R9.1-4 · Load-bearing items — re-flagged

Items 1–7 from §6 stand unchanged. Two changes and one addition:

- **Item 3 (heavy/light asymmetry)** — amended. The heavy end is now carried by the slab
  + modal + threshold + **receipt**, not by a typed gate. Do not re-add the gate; do not
  thin the receipt.
- **NEW item 8 · The order receipt is load-bearing.** Full line items, real totals, the
  NetSuite account, and the three-row status ledger. It is what makes the tab
  non-redundant *and* what replaced the typed gate. Collapsing it to a summary
  re-opens both problems at once.
- **NEW item 9 · The failed state must remain a tab, never a modal**, and must state both
  facts (deal closed / order not placed) with equal weight. A dismissible error here
  loses the only surface that says what's left to do.

Cosmetic by comparison (safe to adjust): receipt rule weights, the split banner's
green/red hues, chip sizing, meta-cell column count, the armed-threshold colour.

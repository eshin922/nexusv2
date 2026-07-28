# Round 8 — Quote umbrella · Designer notes

**Deliverable:** Pattern 30 canonical source for Slice 12 (the Quote umbrella).
**Prototype:** `Nexus Round 8.html` → `app/r8/{data.js, styles.css, umbrella.jsx}`
**Designed against:** `quote-umbrella-brief-RECONCILED-v2` (not the original).
**Status:** live blocker cleared — CC builds from `app/r8/styles.css` verbatim, not from CSS interpretation.

> ⚠ **Sub-tabs 4 and 5 in this document are SUPERSEDED by R9 / R9.1.**
> Tab 4 is now the *Acceptance* capture; tab 5 is now the *Sales Order* receipt, and the
> **typed `FINALIZE` gate described below was dropped** (see `docs/r9-designer-notes.md`
> §R9.1-3). Sub-tabs 1–3, the strip, the legend and the advance bar remain authoritative here.

---

## 0 · The one idea

> **Nothing is locked until the NetSuite SO push.**

Everything in this round is an expression of that. The umbrella has five sequential
sub-tabs and exactly one point of no return, so the design's job is to make four
transitions feel *ordinary* and one feel *ceremonial*. If every advance looked the
same, the PM would learn nothing from the interface and would be reading warning
copy to find out where the cliff is. Copy is skimmed; weight is not.

**The asymmetry is the deliverable. Do not normalize it in implementation.**

| Transition | Weight | Treatment |
|---|---|---|
| Preview → Send | light | plain primary + caption "Reversible — you can come back and revise" |
| Send → (sent) | light | plain primary + a *stating* confirm modal (what the customer receives), no consequence list |
| Client Review → Mark Accepted | light | plain primary |
| Mark Accepted → (accepted) | light | plain primary; **rollback shown as a peer** once recorded |
| **Tier Selection → Complete** | **heavy** | dark ceremonial slab, lock glyph, 2px top rule on the bar, consequence list, **typed `FINALIZE` confirmation** |

Two supporting devices carry the same idea:

- **Lock threshold** — a dashed vertical rule in the sub-tab strip between tab 4 and
  tab 5, captioned "lock threshold". The reversible region is visibly *a region*.
- **Reversibility legend** — one line under the strip: steps 1–4 reversible, step 5
  pushes a Sales Order. Present on every non-complete state; removed after Complete
  (replaced by the read-only note), because it no longer describes anything true.

---

## 1 · Sub-tab strip (2.1)

Five tabs, strict-sequential, order locked. Status derives from quote state + index:

| Status | Meaning | Treatment |
|---|---|---|
| `current` | quote is in this tab's state | accent underline, filled numeral, 600 label |
| `done` | passed, **still reachable** | green check numeral, `done · revisitable` sub-label |
| `upcoming` | not reachable yet | dashed numeral, muted, `disabled`, sub-label `awaiting sent`/`awaiting accepted` |
| `locked` | post-Complete | lock numeral, all tabs, no hover |

`done` deliberately reads *revisitable*, not merely *finished* — a checkmark alone
would imply "closed". The sub-label says so in words because the difference between
"done" and "done and you can go back" is the whole reversibility model.

**Client Review is styled as a logging tab, not a gate.** Two quiet signals, no new
colour: the numeral is a rounded *square* (a ledger, not a step in a sequence), and
the label carries a dotted underline. It also shows a live entry count. It reads as
a place to track rather than a threshold to pass — which is what the brief asked for
and what stops PMs treating it as a step they must "complete".

## 2 · Preview Quote (2.2)

Framing only — the PDF shipped in Slice 11 and is untouched here (rendered as a
labelled stand-in in the prototype).

**Version chooser:** a row-per-version *list*, not a dropdown. Each row carries
label, status tag (`sent` / `draft` / `superseded`), the change note, the date, and
the total. Rationale: four versions with different totals is a **comparison**, not a
pick-from-list. A dropdown hides exactly the information the PM needs (which one did
the customer actually see, and what does it cost) — and that same distinction is what
the mismatch banner depends on two tabs later. Newest first. Same quote number on all
of them, stated in the header.

## 3 · Send to Client (2.3)

- **Send confirm** is *stating*, not warning: recipient, attachment, `draft → sent`.
  No consequence list, no typed confirmation. Send is reversible; ceremony here would
  devalue the ceremony that matters.
- **Post-send waiting state** (the core gap — no such surface existed): pulse dot,
  "Sent — awaiting Beth", days elapsed, validity date, feed count, and actions
  (open Client Review, re-send, download). Its real job is to say **nothing is
  expected of you right now**, and point to the one place where something might be.
  Before this round the UI simply went quiet after a send.
- The **Revise** affordance appears here too (not only in Client Review), because
  "I need to change what I just sent" arrives most often immediately after sending.

## 4 · Client Review (2.4) — the new sub-tab

A log. Kept visually a log on purpose:

- **Hairline timeline** — 9px dot on a 1px spine, per-type dot colour, no cards.
- **Append-only, newest first**, each entry = type chip + author + timestamp + note.
- **Add-entry collapsed to a single line** ("+ Log customer activity…") until used.
  A permanently-open form turns a jotting surface into a task-shaped one.
- **Event type as chips, not a select** — three today (`responded`, `asked`,
  `revision_requested`), extensible, each with a one-line hint. Cheap to scan, and
  visible extensibility for CC.
- **Empty state:** "No customer activity logged yet." plus one line on what to log.
- A `revision_requested` entry grows **inline actions** — "↺ Revise quote → v4",
  "Mark handled" — so the response sits next to the trigger.
- Explicitly labelled in-surface as *not* customer-facing, *not* a thread, *not* a
  revision manager (right rail), so the next reader doesn't grow it into one.

## 5 · Revise + mismatch banner (2.4a)

**Revise** is styled as an ordinary secondary action inside a dashed container — never
a primary, never a destructive/danger treatment. Reversibility is *routine* in this
model; making Revise look like an emergency exit would contradict the whole design.
Copy always states the invariant: *same quote, same number, nothing is lost.*

**Sent-vs-draft mismatch banner** honours the IA-spec intent verbatim:

> You sent **v3** on Jul 14 · current draft is **v4**

…plus the consequence the PM actually needs: *the customer is responding to v3, and
acceptance records against the version the customer saw.* Four affordances: view sent,
compare, send the draft, dismiss. Warn-tinted, not error — a draft leading a sent
version is a normal working state, not a fault.

## 6 · Mark Accepted (2.5)

Reconciled with the existing IA-spec Mark-Accepted design: the **gates/verdict/tier
panels are gone from here** — tier selection has moved to its own sub-tab, and the
margin verdict belongs to Pricing. What remains is what this step actually is: record
acceptance, against a specific version, and push HubSpot once.

- **Records against the sent version**, stated explicitly (`v3 — the version the
  customer saw`), with the customer's tier signal shown as context (not selected here).
- **HubSpot push states:** pushing (spinner) → confirmed (`Closed Won`, amount, synced)
  → **error** (403, explicit *"acceptance not recorded"*, `quote.state` still `sent`,
  retry). **State never advances on failure** and the surface says so — the most
  important sentence in any integration error.
- **Rollback is a peer of the advance**, on the surface, once recorded: "↺ Roll back to
  Send to Client — reverses the HubSpot stage". Not buried in an admin menu. This is
  the last reversible step and the one most likely to be mis-clicked, so the way back
  is stated where the mistake happens.

## 7 · Tier Selection (2.6) — the lock

- **Per-tier compliance block reused from Pricing** (unit price · turnkey · margin ·
  status), read-only. Not redesigned.
- **Single-select, pre-filled from the customer's recorded signal** (T2, from review
  event ev2), with the provenance shown — "stated in review_event ev2 · 2026-07-19" —
  and PM override allowed. Recommended tier keeps its ★.
- **Below-floor tier blocked**: T4 is `disabled` with a `below floor · blocked` chip,
  the advance disables, and the R5 firm-policy-gate pattern supplies the admin-override
  path.
- **Finalization warning** — the heavy one. Dark header, action-specific copy naming the
  NetSuite SO and `Pending Fulfillment`, a five-item consequence list (two lock icons),
  and a **typed `FINALIZE`** gate. Cancel is labelled *"Cancel — keep it reversible"*,
  which is the entire model in three words.
- **NetSuite failure**: 502, *"quote NOT finalized"*, no SO created, state still
  `accepted` **and still reversible**, safe to retry.
- **Post-push confirmation**: SO id, timestamp, tier, turnkey total, link out.

## 8 · Post-Complete locked state (Pattern 52)

Dark ribbon leading with the SO number and the NetSuite link; every sub-tab `locked`;
one quiet read-only line; Revise disabled; no advance ("No advance — this is the end of
the lifecycle"). Tone is **"here is the record"**, not "you can no longer edit this" —
the same call as R3's locked state, kept consistent. Unlock is an admin request, and the
copy notes the SO must be cancelled in NetSuite separately (the lock is real, not a UI
convention).

## 9 · Stacked / narrow variant (deliverable 5)

Applied by `@media (max-width: 900px)` **and** by a forced `.r8-shell.narrow` class so
reviewers can see it at any width (Tweaks → *Stacked / narrow variant*). Changes:
strip wraps to 2 rows of ~44%; the lock threshold rotates from a vertical rule to a
horizontal one spanning the wrap; two-column body collapses to one; tier rows drop to
3 columns with left-aligned numbers; the advance bar stacks with the action full-width
and the status line last; definition rows go label-over-value.

## 10 · Pushback / things rejected

1. **Client Review as a threaded conversation.** Rejected — locked as a log, and the
   log framing is what keeps it cheap. Threading implies inbound sync we don't have;
   PMs would expect the customer's email to appear here.
2. **A "reversible" badge on every one of the first four advances.** Rejected as noise.
   One legend line under the strip plus the threshold rule carries it; per-button
   captions state it only where the PM is deciding.
3. **Colour-coding the whole strip by reversibility** (green tabs 1–4, red tab 5).
   Rejected — it fights the existing status colours (done/current/upcoming) and would
   make a normal working state look alarming. The threshold rule is structural instead.
4. **Skipping the typed confirmation** on finalization. Kept: it's the only
   irreversible act in the product, it pushes into an external system of record, and a
   misfire costs a cancelled SO in NetSuite. Typing six characters is proportionate.
5. **Tier selection inside Mark Accepted** (as the old IA-spec had it). The locked
   5-tab order separates them; keeping a tier picker in both places would create two
   sources of truth for the accepted tier.

## 11 · Named structure (Pattern 30 — implement verbatim)

Components (`app/r8/umbrella.jsx`): `QuoteUmbrella` · `SubTabStrip` · `Legend` ·
`AdvanceBar({weight, label, caption, mid, back})` · `PreviewTab` · `SendTab` ·
`SendConfirmModal` · `ReviewTab` · `MismatchBanner` · `AddEntry` · `AcceptedTab` ·
`TierTab` · `FinalizationModal` · `CompleteTab`.

Canonical classes (`app/r8/styles.css`): `r8-shell`(`.narrow`) `r8-topbar` `r8-crumb`
`r8-strip` `r8-tab`(`.done .current .upcoming .locked .log`) `r8-threshold` `r8-legend`
`r8-body` `r8-cols` `r8-card`(`.flush`) `r8-card-head` `r8-vpick` `r8-vrow` `r8-vtag`
`r8-pdfframe` `r8-wait` `r8-feed` `r8-fitem`(`.t-*`) `r8-etype` `r8-addentry`
`r8-typepick` `r8-empty` `r8-mismatch` `r8-revise` `r8-push`(`.ok .error`)
`r8-rollback` `r8-tier`(`.on .disabled`) `r8-signal` `r8-advance`(`.heavy`)
`r8-adv-btn`(`.heavy`) `r8-final-head` `r8-consequences` `r8-confirmtype`
`r8-locked-ribbon` `r8-solink` `r8-readonly-note` `r8-defs`.

`.r8-proto` / `.r8-dn` are prototype-only (state switcher, inline designer notes) —
**strip both in production.**
